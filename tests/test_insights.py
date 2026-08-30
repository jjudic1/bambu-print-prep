"""The usage endpoint, checked by running it.

`api/insights.js` is the one piece of server-side code left after the Cloud Run
compute came down, and it holds a Vercel token. Two things about it are worth
guarding, and neither is about JSON:

* **Shut unless switched on.** No INSIGHTS_KEY and it must refuse -- including
  refusing a request that sends no key at all, which is the one an accidental
  deploy gets hit with first.
* **Partly working is a real answer.** Eight queries go upstream and any one can
  be refused on its own: a dimension Vercel does not offer for that dataset, a
  plan limit, analytics switched off. If one failure took the whole call down,
  the dashboard would show an error on the day a single dimension changed name.

`web/insights-check.mjs` runs the handler with `fetch` replaced, so nothing here
reaches Vercel and nothing here needs a token. This hands its results to pytest
one check at a time, so a failure names what broke -- the same arrangement as
the parts, flatten and framing harnesses.

Needs Node, and skips without it rather than failing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
HARNESS = WEB / "insights-check.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not HARNESS.is_file(),
    reason="needs Node",
)


@pytest.fixture(scope="module")
def checks():
    """Every check the harness ran, by label."""
    result = subprocess.run(
        ["node", str(HARNESS)],
        cwd=WEB, capture_output=True, text=True, timeout=120)

    line = next((ln for ln in result.stdout.splitlines()
                 if ln.startswith("RESULTS ")), None)
    if line is None:
        raise AssertionError(
            f"insights-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 20


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)


def test_it_is_still_shut_by_default(checks):
    """Called out on its own because it is the check whose failure would be
    invisible: the endpoint would keep working, and simply work for everybody."""
    shut = [c for c in checks if "refuses" in c["label"]]
    assert len(shut) >= 4, "the harness stopped checking that it refuses"
    assert all(c["ok"] for c in shut)
