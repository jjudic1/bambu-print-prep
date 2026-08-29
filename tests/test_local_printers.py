"""Which machine, and which nozzle is in it -- checked by running the picker.

The nozzle is not a preference. It is a fact about the machine that decides the
machine profile, the layer height and every line width in the file, and the two
selects that set it are halves of one value. Getting that wrong is silent: the
container opens, the plate looks right, and the printer is asked to push 0.8 mm
of plastic through a 0.4 mm hole in someone else's room, days later.

`web/printers-check.mjs` runs the choice logic against the real baked profiles
-- half of it is really about the data being complete for all four nozzles --
and this hands its results to pytest one check at a time.

Needs Node. No node_modules: printers.js imports nothing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
HARNESS = WEB / "printers-check.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not HARNESS.is_file(),
    reason="needs Node",
)


@pytest.fixture(scope="module")
def checks():
    """Every check the harness ran, by label."""
    result = subprocess.run(
        ["node", str(HARNESS)],
        cwd=WEB, capture_output=True, text=True, timeout=180)

    # The harness exits non-zero when a check fails; that is reported per check
    # below rather than here, so a failure names what broke instead of just
    # saying node returned 1. A crash has no RESULTS line and is raised as-is.
    line = next((ln for ln in result.stdout.splitlines()
                 if ln.startswith("RESULTS ")), None)
    if line is None:
        raise AssertionError(
            f"printers-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 16


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)
