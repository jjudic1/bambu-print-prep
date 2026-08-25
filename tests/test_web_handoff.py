"""The JavaScript handoff page must keep agreeing with the Python one.

`web/src/local/handoff.js` is a port of `prep/handoff.py`, and a port is a
second copy of knowledge that was expensive to acquire. The content is not
invented: it is the delivery loop performed and verified end to end on
2026-08-23 (docs/transport-findings.md §A2), including both routes through
Bambu Handy and the fact that MakerWorld refuses our render as the listing
photo. Two copies drift, and when they do the on-device page will quietly start
telling users a version of the steps nobody has walked through -- with no
symptom except someone stuck in Safari who does not come back.

So this renders both and diffs them byte for byte. The date is pinned, because
the only legitimate difference between the two is which day it is.

Needs Node, and skips without it rather than failing.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from prep import handoff

ROOT = Path(__file__).resolve().parent.parent
HARNESS = ROOT / "spikes" / "handoff_compare.mjs"
PORT = ROOT / "web" / "src" / "local" / "handoff.js"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not HARNESS.is_file() or not PORT.is_file(),
    reason="needs Node and the JavaScript port",
)

# A pinned day, and strings that exercise the escaping: an ampersand, a quote,
# an angle bracket and the " -- " that both sides turn into an em dash.
PINNED_DATE = "2026-08-24"
CASES = {
    "plain": dict(
        modelName="dragon", fileName="dragon-80mm.3mf",
        printer="Bambu Lab P1S 0.4 nozzle", sizeText="80 mm - about a mug",
        material="PLA"),
    "needs_escaping": dict(
        modelName='Bob & "Alice" <one>', fileName="a'b&c.3mf",
        printer="Bambu Lab A1 mini 0.4 nozzle",
        sizeText="35 mm - keychain", material="PETG"),
    "no_facts": dict(
        modelName="thing", fileName="thing.3mf", printer="", sizeText="",
        material=""),
}


def _js(payload: dict, tmp_path: Path) -> str:
    src = tmp_path / "input.json"
    dst = tmp_path / "out.html"
    src.write_text(json.dumps(payload), encoding="utf-8")
    result = subprocess.run(
        ["node", str(HARNESS), str(src), str(dst)],
        cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    return dst.read_text(encoding="utf-8")


def _py(payload: dict, preview: Path | None) -> str:
    page = handoff.render(
        model_name=payload["modelName"], file_name=payload["fileName"],
        printer=payload["printer"], size_text=payload["sizeText"],
        material=payload["material"], preview=preview)
    # handoff.render stamps today; the port is handed a pinned date so that the
    # only difference the diff can show is a real one.
    import datetime
    return page.replace(datetime.date.today().isoformat(), PINNED_DATE)


@pytest.mark.parametrize("name", sorted(CASES))
def test_both_sides_render_the_same_page(name, tmp_path):
    payload = dict(CASES[name], date=PINNED_DATE)
    assert _js(payload, tmp_path) == _py(CASES[name], None)


def test_the_picture_is_inlined_identically(tmp_path):
    """The page has to survive AirDrop and mail, so the render travels in it."""
    png = ROOT / "tests" / "__pycache__" / "handoff_probe.png"
    png.parent.mkdir(parents=True, exist_ok=True)
    # A one-pixel PNG is enough: this is about the data URI, not the picture.
    raw = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
        "IQAAAABJRU5ErkJggg==")
    png.write_bytes(raw)

    payload = dict(CASES["plain"], date=PINNED_DATE,
                   preview=base64.b64encode(raw).decode("ascii"))
    assert _js(payload, tmp_path) == _py(CASES["plain"], png)


def test_the_port_carries_the_verified_copy():
    """The specific things that were checked against reality, not paraphrased."""
    page = handoff.render(model_name="x", file_name="x.3mf", printer="Bambu Lab P1S")
    source = PORT.read_text(encoding="utf-8")
    for phrase in ("Any real photo from your camera roll",
                   "My Creations",
                   "makerworld.com",
                   "Private"):
        assert phrase in page, f"python lost: {phrase}"
        assert phrase in source, f"the port lost: {phrase}"
