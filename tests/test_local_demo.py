"""The test model on the landing screen, and the walk-through it starts.

The landing screen asks for a file before it will show anything, and the person
this app is for has not got one -- getting one means an account on a model site
and a download, and that is where most of them stop. So there is a model built
on the device, and a list of seven things to try on it.

Everything about that is a claim on geometry, and every one of those claims
fails silently. A model that will not come apart makes step one look like a
broken button. A shape already sitting flat makes the flatten step look like a
slider that does nothing. A model wider than the smallest bed here opens the
walk-through with a warning about the model instead of a first step. None of it
raises, and none of it is visible from reading the file.

`web/demo-check.mjs` runs the real splitter and the real printer index against
the model and reports each claim; this hands them to pytest one at a time. What
is checked here in Python instead is the seam between the two files: demo.js
names the steps, LocalApp.jsx decides when each is done, and a key renamed in
one and not the other is a step that can never tick.

Needs Node and web/node_modules, and skips without them rather than failing.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
HARNESS = WEB / "demo-check.mjs"
DEMO = WEB / "src" / "local" / "demo.js"
APP = WEB / "src" / "local" / "LocalApp.jsx"


def test_the_walk_through_names_the_steps_the_app_can_tick():
    """demo.js writes the list, LocalApp works out which of them are done. A key
    in one and not the other is a step that never ticks off, or a tick with
    nothing to tick -- and both look like the app having lost track of you."""
    named = re.findall(r"key: '([a-z]+)'", DEMO.read_text("utf-8"))
    body = re.search(r"const tourDone = useMemo\(\(\) => \((\{.*?\})\), \[",
                     APP.read_text("utf-8"), re.S).group(1)
    answered = re.findall(r"^\s{4}([a-z]+):", body, re.M)
    assert named, "demo.js declares no steps"
    assert named == answered


def test_the_test_model_is_offered_on_the_landing_screen():
    """The button is the whole point: without it the model exists and nobody can
    reach it."""
    source = APP.read_text("utf-8")
    assert "Try it with a test model" in source
    assert "onClick={loadDemo}" in source


def test_the_demo_is_counted_as_a_model_opened():
    """Not a step of its own -- it is a model being opened, and the funnel in
    metrics.js is deliberately five events long. The kind is what separates a
    practice run from a real file, so the numbers can still be read."""
    source = APP.read_text("utf-8")
    assert "countStep(OPENED, ON_DEVICE, { kind: 'demo' })" in source


def test_nothing_is_fetched_to_build_it():
    """A demo that needs the network is broken on the aeroplane, in the room
    with the printer and behind the school firewall -- all places this app is
    supposed to work, and the only reason it has no server at all."""
    source = DEMO.read_text("utf-8")
    for reach in ("fetch(", "XMLHttpRequest", "http://", "https://"):
        assert reach not in source, f"demo.js reaches out with {reach}"


pytestmark_node = pytest.mark.skipif(
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
            f"demo-check.mjs did not finish\n{result.stdout}\n{result.stderr}")
    return json.loads(line[len("RESULTS "):])


@pytestmark_node
def test_the_harness_ran_every_check(checks):
    assert len(checks) >= 14


@pytestmark_node
def test_every_check_passed(checks):
    failed = [
        f"{c['label']}: got {json.dumps(c['got'])}, want {json.dumps(c['want'])}"
        for c in checks if not c["ok"]
    ]
    assert not failed, "\n".join(failed)
