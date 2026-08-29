"""The file picker, and the attribute it must not have.

On an iPad the one way in offers three: Photo Library, Take Photo or Video, and
Choose File. Two of those cannot produce a model, and the obvious fix is an
`accept` attribute listing the extensions. That fix does not work, and it does
not fail quietly -- WebKit does not implement extension specifiers, so the list
resolves to no types at all and the Files browser greys out **every file**,
including the .3mf the user is looking at. Measured on a real iPad on
2026-08-29: the app could not be used at all.

MIME types do not hide the photo entries either, and `capture` skips the menu by
opening the camera, which is the opposite of what is wanted. So the menu stays.
What we can do is name the wrong turn when someone takes it, which is why
readModel answers a photo differently from an unreadable file.

None of this is visible from a desktop browser -- Chrome and Safari on a Mac
show a plain file dialog either way, and `accept` there does the tidy thing it
is supposed to do. That asymmetry is exactly why this is a test and not a
comment.
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


def test_the_list_we_name_is_the_list_we_can_read():
    """A format added to the chain and not to READABLE parses perfectly and is
    never mentioned; one added to READABLE and not the chain is offered and then
    refused. Neither raises anything."""
    assert declared() == parsed()


def test_the_picker_has_no_accept_attribute():
    """The one that greyed out every file on the iPad. If a future change wants
    it back, it needs a real iPad and this docstring, not a desktop browser."""
    tag = re.search(r"<input\s(.*?)/>", APP.read_text("utf-8"), re.S).group(1)
    assert 'type="file"' in tag
    assert "accept" not in tag, (
        "accept with extensions makes iOS Safari greylist every file in the "
        "Files picker -- WebKit does not implement extension specifiers")


def test_the_picker_never_asks_for_the_camera():
    """`capture` would skip the menu by opening the camera app instead. Scoped
    to the tag, because the comment above it has to be free to say the word."""
    tag = re.search(r"<input\s(.*?)/>", APP.read_text("utf-8"), re.S).group(1)
    assert "capture" not in tag


def test_there_is_only_one_way_in():
    assert APP.read_text("utf-8").count('type="file"') == 1


def test_a_photo_is_answered_as_a_photo():
    """The camera roll is the top entry on iOS and cannot be removed, so the
    error for a photo has to point at the entry that would have worked."""
    source = MESH.read_text("utf-8")
    assert re.search(r"image\|video", source), "photos are not detected"
    assert "Choose File" in source, "the error does not name the way in"
