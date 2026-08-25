"""The on-device splitter and per-part pose, checked by running them.

`/local` is the half of this project with no Python behind it: the browser
splits an assembly into parts, turns each onto whatever face the user picks,
lays them across plates and writes the container. The failures that path can
have are the quiet kind -- a piece dropped by the split, a part mirrored by its
own rotation, a layout computed on the shape a part used to be -- and none of
them raise anything. They surface as a bad print on someone else's printer.

So `web/parts-check.mjs` runs the same maths LocalApp does against geometry
whose answers are known, and this hands its results to pytest one check at a
time. Signed volume is checked as well as size, because a mirror leaves the
bounding box alone -- the same trap `read3mf.js` has.

Needs Node and web/node_modules, and skips without them rather than failing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
HARNESS = WEB / "parts-check.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None
    or not HARNESS.is_file()
    or not (WEB / "node_modules" / "three").is_dir(),
    reason="needs Node and web/node_modules (npm install --prefix web)",
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
            f"parts-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 16


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)
