"""The on-device bottom cut, checked by running it.

`prep/base.py` levels a curved bottom server-side, where trimesh does the
cutting and capping. `/local` has no trimesh, so `web/src/local/flatten.js`
clips the triangles and stitches the cap itself -- and every way that can go
wrong is silent. A cap that misses one loop leaves the bounding box perfect. A
cap wound the wrong way leaves the volume right too, and prints the bottom
inside out. Pulling low vertices up onto the plane instead of clipping looks
correct on a dense scan and is 60% wrong on a cone.

So `web/flatten-check.mjs` cuts shapes whose answers can be worked out by hand
-- a block, a cone, a torus, a ball -- and checks the volume, the area of the
new face, the winding, and whether every edge is still shared by exactly two
triangles. This hands its results to pytest one check at a time, so a failure
names what broke.

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
HARNESS = WEB / "flatten-check.mjs"

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

    line = next((ln for ln in result.stdout.splitlines()
                 if ln.startswith("RESULTS ")), None)
    if line is None:
        raise AssertionError(
            f"flatten-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 24


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)


def test_the_cut_model_is_still_closed(checks):
    """The check that a missing or doubled cap cannot survive.

    Called out on its own because it is the one that distinguishes "the cut
    worked" from "the cut looked like it worked": an opening left uncapped, or a
    hole filled in as though it were solid, both measure plausibly and both
    fail here.
    """
    closed = [c for c in checks if "closed" in c["label"]]
    assert len(closed) >= 5, "the harness stopped checking closedness"
    assert all(c["ok"] for c in closed)
