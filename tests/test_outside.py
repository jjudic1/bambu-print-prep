"""Links that leave the app, from the Home Screen app they leave it from.

Added to the Home Screen this runs standalone -- no address bar, no tabs -- and
a plain link tapped in there opens a stripped browser sheet inside our own app
instead of the user's Safari. Every outward link here is somewhere somebody is
meant to arrive at and sign in to, so the sheet is the wrong shape for all of
them. `web/src/local/outside.js` swaps the scheme for `x-safari-https:`, which
iOS hands to Safari itself, and does it only when `navigator.standalone` says
this is that case.

Both ways of getting it wrong are silent:

  * the rewrite reaching a browser that has never heard of the scheme, where
    every outward link becomes a tap that does nothing;
  * a link added later the plain way, which is just the old behaviour, in one
    place, for the one audience this app is for.

`web/outside-check.mjs` exercises the module against a fake navigator in both
modes and then reads LocalApp.jsx for an href that skipped it. This hands the
results to pytest one at a time.

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
HARNESS = WEB / "outside-check.mjs"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not HARNESS.is_file(),
    reason="needs Node",
)


@pytest.fixture(scope="module")
def checks():
    """Every check the harness ran."""
    result = subprocess.run(
        ["node", str(HARNESS)],
        cwd=WEB, capture_output=True, text=True, timeout=120)

    line = next((ln for ln in result.stdout.splitlines()
                 if ln.startswith("RESULTS ")), None)
    if line is None:
        raise AssertionError(
            f"outside-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 9


def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)


def test_the_rewrite_stays_in_the_home_screen_case(checks):
    """The half that would break the app for everybody else.

    `x-safari-https://` means nothing to a desktop browser or to Android. If
    the rewrite ever applies outside a Home Screen app, every outward link on
    the landing screen is dead, with no error to say so.
    """
    outside = [c for c in checks if "is not the Home Screen case" in c["label"]
               or "left alone" in c["label"]]
    assert len(outside) >= 4, "the harness stopped checking the ordinary case"
    assert all(c["ok"] for c in outside), "\n".join(
        c["label"] for c in outside if not c["ok"])


def test_no_outward_link_skips_it(checks):
    """The half that would quietly put one link back in the sheet."""
    guards = [c for c in checks if "href" in c["label"]
              or "literal address" in c["label"]
              or "handed the page as written" in c["label"]]
    assert len(guards) >= 3, "the harness stopped reading LocalApp.jsx"
    assert all(c["ok"] for c in guards), "\n".join(
        f"{c['label']}: {json.dumps(c['got'])}" for c in guards if not c["ok"])
