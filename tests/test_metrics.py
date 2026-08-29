"""The counting, and the shadowing bug that stopped it silently.

`web/src/metrics.js` exported a function called `note`. `LocalApp.jsx` also
calls its status line `note` -- `const [note, setNote] = useState('')` -- so the
local binding shadowed the import and every call tried to invoke a string.
Nothing failed at build time. In production it surfaced as "R is not a function"
under the colour swatches, *after* the file had been written, and no step was
ever counted.

Both halves of that are bad and only one is visible. A counter that stops
counting reports nothing, and nothing is exactly what "no visitors" looks like
-- so a broken funnel would have read as failed advertising rather than as a
bug.

`web/metrics-check.mjs` therefore checks the shape of metrics.js *and* that no
file importing from it redeclares any of those names. This hands its results to
pytest one check at a time.

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
HARNESS = WEB / "metrics-check.mjs"

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
            f"metrics-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 5


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)


def test_nothing_shadows_the_counting(checks):
    """The check this file exists for.

    Named on its own so a failure says what it means: some file has a local
    binding with the same name as something it imports from metrics.js, which
    is how the counting stopped last time without anything failing.
    """
    shadow = next((c for c in checks if "redeclares" in c["label"]), None)
    assert shadow is not None, "the harness stopped checking for shadowing"
    assert shadow["ok"], "\n".join(shadow["got"])
