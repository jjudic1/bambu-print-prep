"""The camera framing for the plate, checked by running it.

Both viewers used to put the camera at a distance fixed to the bed's size,
which frames the plate correctly for exactly one shape of viewport. Anything
else lost corners off an edge -- and a phone, which gets a short wide strip
above the controls, lost them off two. Nothing raises; the plate is simply half
off the screen on a device nobody had open at the time.

So `web/framing-check.mjs` projects the bed's corners through the camera
`frameBed` gives, for every bed this ships for against a spread of viewport
shapes, and this hands its results to pytest one check at a time. It checks the
bed fills the frame as well as fits in it, because "fits" is satisfied by
standing far enough away.

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
HARNESS = WEB / "framing-check.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None
    or not HARNESS.is_file()
    or not (WEB / "node_modules" / "three").is_dir(),
    reason="needs Node and web/node_modules (npm install --prefix web)",
)


@pytest.fixture(scope="module")
def checks():
    """Every check the harness ran."""
    result = subprocess.run(
        ["node", str(HARNESS)],
        cwd=WEB, capture_output=True, text=True, timeout=180)

    line = next((ln for ln in result.stdout.splitlines()
                 if ln.startswith("RESULTS ")), None)
    if line is None:
        raise AssertionError(
            f"framing-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 6


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)
