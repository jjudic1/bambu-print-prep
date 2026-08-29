"""The only way into this app is a file, and the picker has to say so.

An <input type="file"> with no `accept` makes iOS Safari offer "Photo Library"
and "Take Photo or Video" above "Choose File". Neither can produce a model, and
the failure is invisible from a desktop browser -- the menu does not exist
there, so nothing looks wrong to whoever removes the attribute.

The extensions live in one place (mesh.js READABLE) because three things say
them: the picker, the label under it, and the error for a file we cannot read.
This checks that list against the parser that actually has to handle them.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MESH = ROOT / "web" / "src" / "local" / "mesh.js"
APP = ROOT / "web" / "src" / "local" / "LocalApp.jsx"


def declared() -> list[str]:
    """The READABLE list, as mesh.js declares it."""
    body = re.search(r"export const READABLE = \[(.*?)\]", MESH.read_text("utf-8"),
                     re.S).group(1)
    return re.findall(r"'([^']+)'", body)


def parsed() -> list[str]:
    """The extensions readModel's dispatch chain actually branches on."""
    return re.findall(r"name\.endsWith\('([^']+)'\)", MESH.read_text("utf-8"))


def test_the_list_offered_is_the_list_that_can_be_read():
    """A format added to the chain and not to READABLE parses perfectly and can
    never be chosen; one added to READABLE and not the chain is offered and then
    refused. Neither raises anything."""
    assert declared() == parsed()


def test_the_picker_is_restricted_to_those_files():
    source = APP.read_text("utf-8")
    tag = re.search(r"<input\s(.*?)/>", source, re.S).group(1)
    assert "type=\"file\"" in tag
    assert "accept={READABLE.join(',')}" in tag, (
        "without accept, iOS offers the camera and the photo library for a "
        "model file")


def test_the_picker_never_asks_for_the_camera():
    """`capture` would send an iPad straight to the camera app."""
    assert "capture" not in APP.read_text("utf-8")


def test_there_is_only_one_way_in():
    """One input. A second one added without accept would be the same bug in a
    place this test was not looking."""
    assert APP.read_text("utf-8").count('type="file"') == 1
