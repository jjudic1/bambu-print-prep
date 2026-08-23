"""What a publicly reachable URL needs that a localhost one does not.

None of this matters while the only caller is you. All of it matters the moment
the address is reachable, because every one of these is a way for an ordinary
day to take the service down:

* **Uploads are unauthenticated.** Anyone with the URL can spend the CPU.
* **Jobs never expired.** Every upload was kept for ever, so disk filled at
  whatever rate people used it.
* **Mesh work blocked the event loop.** The orientation solver takes ~9s on a
  20k-face mesh (measured, not guessed) and it ran inside an `async def`, so a
  single upload froze the whole process -- other requests, health checks, all
  of it. On a one-instance deploy that reads as an outage.

The rate limiter and the concurrency guard are per-process and deliberately so.
A shared limiter needs Redis, which is another service to pay for and keep up,
and the thing being defended here is one container's CPU -- which is also
per-process. If this ever runs behind more than one instance, the limits become
per-instance and the numbers need revisiting; that is a real limitation and not
a subtle one, so it is written down rather than discovered.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import time
from collections import defaultdict, deque
from pathlib import Path

# Big enough for anything a phone camera scan or a generation site produces;
# prep.ingest already refuses >5M triangles with a decimation offer, so this is
# the cruder guard that stops the body being read at all.
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Long enough to leave a browser tab open over lunch and come back to it, short
# enough that disk does not accumulate. §7 wants artifacts kept so re-printing
# at a new size needs no re-upload -- that is what this window is for, and a
# durable store is what it would take to keep them for longer.
JOB_TTL_SECONDS = 6 * 60 * 60
SWEEP_EVERY_SECONDS = 30 * 60

# Uploads per window per address. Generous for a person -- they would have to
# prepare a model every thirty seconds for ten minutes straight to notice.
RATE_LIMIT = 20
RATE_WINDOW_SECONDS = 10 * 60

# How many meshes may be worked on at once. Mesh work is CPU-bound, so more
# concurrency than cores buys nothing and makes every request slower at the
# same time -- which is the failure that looks like a hang rather than a queue.
MAX_CONCURRENT_JOBS = max(1, min(4, (os.cpu_count() or 2) // 2))

_mesh_slots = asyncio.Semaphore(MAX_CONCURRENT_JOBS)

log = logging.getLogger("print-prep.limits")


class TooManyRequests(Exception):
    """Raised with a plain-language message, per §6: name the recovery."""


class RateLimiter:
    """A fixed window per client address, held in memory."""

    def __init__(self, limit: int = RATE_LIMIT, window: int = RATE_WINDOW_SECONDS):
        self.limit = limit
        self.window = window
        self._seen: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self._seen[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            wait = int((self.window - (now - hits[0])) / 60) + 1
            raise TooManyRequests(
                f"That's a lot of models at once. Try again in about "
                f"{wait} minute{'s' if wait != 1 else ''}.")
        hits.append(now)

        # Without this the dict grows one entry per address, for ever, which is
        # the same leak as never expiring jobs wearing different clothes.
        if len(self._seen) > 4096:
            for addr in [a for a, h in self._seen.items() if not h]:
                del self._seen[addr]

    def reset(self) -> None:
        """Forget every caller. For tests, which upload far more than a person
        would and would otherwise rate-limit themselves halfway through."""
        self._seen.clear()


async def run_mesh_work(fn, *args, **kwargs):
    """Run blocking mesh work off the event loop, and not too much at once.

    `asyncio.to_thread` is what keeps the process answering while the solver
    runs; the semaphore is what stops ten uploads becoming ten threads fighting
    over the same cores.
    """
    async with _mesh_slots:
        return await asyncio.to_thread(fn, *args, **kwargs)


def sweep(root: Path, ttl: int = JOB_TTL_SECONDS) -> int:
    """Delete jobs older than the window. Returns how many went."""
    if not root.is_dir():
        return 0

    cutoff = time.time() - ttl
    removed = 0
    for directory in root.iterdir():
        if not directory.is_dir():
            continue
        try:
            # mtime of the job directory: prepare() rewrites `out/` and touches
            # it, so a job someone is still working on stays alive.
            if directory.stat().st_mtime < cutoff:
                shutil.rmtree(directory, ignore_errors=True)
                removed += 1
        except OSError:
            # A job that cannot be statted is not a reason to stop sweeping the
            # rest. Narrow on purpose -- anything else should surface.
            continue
    return removed


async def sweep_forever(root: Path) -> None:
    """The background sweep. Failures are logged, never swallowed.

    A dead sweeper is invisible -- the service keeps answering and the disk
    keeps filling -- so the one thing this must not do is fail quietly. Narrow
    to OSError because that is what a filesystem sweep can actually raise;
    anything else is a bug in `sweep` and should crash the task loudly rather
    than be caught here. Three real bugs in this project hid in a broad except.
    """
    while True:
        try:
            gone = sweep(root)
            if gone:
                log.info("swept %d expired job(s) from %s", gone, root)
        except OSError:
            log.exception("job sweep failed; disk will grow until this is fixed")
        await asyncio.sleep(SWEEP_EVERY_SECONDS)
