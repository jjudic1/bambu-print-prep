"""The advanced drawer, and the override that reverts itself.

Bambu Studio does not take project_settings.config at its word. It reloads the
system profiles named in the file and re-applies only the keys declared in
``different_settings_to_system``, so a setting written into the blob and not
declared there is thrown away on load -- the file says gyroid, the slicer
prints grid, and nothing anywhere says so. That already cost this project once,
with ``enable_support`` (see ``_override_manifest`` in prep/profiles.py), and
every control in the drawer is a fresh chance to pay it again.

The other silent one: ``printer-settings.json`` is fetched once and held for
the session, so an override applied in place would follow the user into every
later file, including after they put the drawer back to Standard.

``web/advanced-check.mjs`` runs the real choice logic against all 202 baked
blobs and this hands its results to pytest one check at a time.

Needs Node. No node_modules: advanced.js imports nothing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
HARNESS = WEB / "advanced-check.mjs"

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

    line = next((ln for ln in result.stdout.splitlines()
                 if ln.startswith("RESULTS ")), None)
    if line is None:
        raise AssertionError(
            f"advanced-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 25


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)


def test_an_override_is_declared_as_well_as_written(checks):
    """The check this file exists for.

    Named on its own so a failure says what it means: a setting the user chose
    is in the file but not in the list Bambu Studio reads overrides from, which
    means the slicer will quietly use the profile's value instead.
    """
    declared = next((c for c in checks if "declared where Bambu Studio" in c["label"]),
                    None)
    assert declared is not None, "the harness stopped checking the declaration"
    assert declared["ok"], f"declared {declared['got']}, wanted {declared['want']}"


def test_leaving_the_drawer_alone_changes_nothing(checks):
    """Everyone who never opens it must keep getting the file they had."""
    same = next((c for c in checks if "leave every profile untouched" in c["label"]),
                None)
    assert same is not None, "the harness stopped checking the default path"
    assert same["ok"], "\n".join(same["got"])
