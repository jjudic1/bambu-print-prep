"""The guided handoff page, §6.5.

Two things are worth pinning here and they are different in kind. One is that
the page carries the *verified* loop -- private, the photo check, both routes
through Handy -- because those were expensive to establish and a plausible
rewrite could quietly drop one. The other is §6's copy rules, which are the sort
of thing that decays one helpful edit at a time; a test is cheaper than noticing.

Note that the photo step reversed on 2026-08-23: the page used to say no photo
was needed, on a finding that a render was accepted. It is not. When a fact here
flips, the test flips with it and says why -- these are the project's memory of
what MakerWorld actually does, and a stale one is worse than none.
"""

from __future__ import annotations

import re

import pytest

from prep import handoff


BASE = dict(
    model_name="dragon",
    file_name="dragon-80mm.3mf",
    printer="Bambu Lab P1S 0.4 nozzle",
    size_text="80.0 x 42.1 x 61.3 mm - about the size of a coffee mug",
    material="PLA",
)


@pytest.fixture
def page():
    return handoff.render(**BASE)


# --- the loop it describes must stay the loop that was verified -------------

def test_it_names_the_actual_file_the_user_will_look_for(page):
    assert "dragon-80mm.3mf" in page


def test_it_tells_them_to_keep_the_model_private(page):
    # A public upload is a different act with different terms (§A3). The word
    # has to be there, and emphasised, or the user picks whatever is default.
    assert "<b>Private</b>" in page


def test_it_prepares_the_user_for_the_photo_check(page):
    """MakerWorld rejects our render as "not a real photo" (2026-08-23).

    This reverses what the page used to say, and the reversal is the point:
    §2A's circularity is real after all. A user who reaches this step believing
    no photo is wanted stalls on a print they have not made yet, which is the
    failure §2A called potentially fatal. The page has to warn them *before*
    they get there and name a way through.
    """
    assert "will not take the picture" in page
    assert "camera roll" in page


def test_it_tells_them_to_replace_it_with_the_real_thing(page):
    # The placeholder is a way past a check on a listing nobody can see, not a
    # thing to leave lying around. If the page stops saying this, it stops
    # being a workaround and becomes a habit.
    assert "swap in a photo of the real" in page


def test_it_offers_both_routes_through_handy(page):
    # The short route is the profile picture; the long one is My Creations
    # behind a horizontally-scrolling row. Both were verified, and the fallback
    # is what saves the user when the short one is not where they expect.
    assert "3D Models" in page
    assert "My Creations" in page
    assert "slide that row to the right" in page


def test_it_says_the_clunkiness_is_not_the_user_s_fault(page):
    assert "not you" in page
    assert "no computer is involved" in page


def test_it_links_only_to_a_url_that_was_actually_visited(page):
    # A guessed deep link that 404s is worse than a sentence naming the button.
    links = re.findall(r'href="([^"]+)"', page)
    assert links == ["https://makerworld.com"]


# --- whose job is whose ------------------------------------------------------
#
# Nobody at this end has printed the file, and MakerWorld will not let an
# unprinted model go public. Both facts belong to the user and both are easy to
# edit out of a page that is otherwise all encouragement, so they are pinned.

def test_it_says_the_user_has_to_check_the_print_themselves(page):
    assert "You are the one at the printer" in page
    assert "Nobody has printed this file" in page
    assert "yours to check" in page


def test_it_puts_damage_to_the_printer_on_the_user(page):
    assert "Any damage to your printer" in page
    assert "your responsibility" in page


def test_it_says_a_model_may_not_go_public_unprinted(page):
    # Verified at §A2: MakerWorld refuses a render as the listing photo, and its
    # terms want the real thing. Publishing without one is a breach, not a
    # preference -- if that ever changes, change this test and say so here.
    assert "Keep it private until you have printed it" in page
    assert "photo of the real thing" in page
    assert "breaks the terms" in page


# --- §6 copy rules ----------------------------------------------------------

BANNED = ["mesh", "manifold", "topology", "normals", "infill",
          "brim", "raft", "gcode", "slice", "3mf file", "extrude"]


def test_no_jargon_anywhere_on_the_page(page):
    low = page.lower()
    assert [word for word in BANNED if word in low] == []


def test_the_file_name_may_still_contain_3mf(page):
    # The ban is on saying "3mf" *at* the user, not on showing them the name of
    # their own file -- which they have to recognise in Files to get anywhere.
    assert "dragon-80mm.3mf" in page


@pytest.mark.parametrize("raw,plain", [
    ("Bambu Lab P1S 0.4 nozzle", "Bambu Lab P1S"),
    ("Bambu Lab A1 mini 0.4 nozzle", "Bambu Lab A1 mini"),
    ("Bambu Lab X1 Carbon 0.6mm nozzle", "Bambu Lab X1 Carbon"),
    ("Bambu Lab P1S", "Bambu Lab P1S"),
    ("", ""),
])
def test_the_printer_is_named_the_way_the_user_would_name_it(raw, plain):
    assert handoff.plain_printer(raw) == plain


def test_no_raw_double_dashes_survive_into_the_page(page):
    # Sources stay ASCII so nothing here is at the mercy of a code page, but
    # the rendered page should read like prose, not like a diff.
    assert " -- " not in page


# --- robustness -------------------------------------------------------------

def test_a_missing_picture_does_not_cost_the_instructions(tmp_path):
    page = handoff.render(preview=tmp_path / "nope.png", **BASE)
    assert "Set it to Private" in page
    assert "<img" not in page


def test_the_picture_is_inlined_so_the_page_survives_being_moved(tmp_path):
    shot = tmp_path / "p.png"
    shot.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 40)
    page = handoff.render(preview=shot, **BASE)
    assert "data:image/png;base64," in page
    assert str(shot) not in page      # no path that breaks on another device


def test_a_hostile_model_name_cannot_inject_markup():
    page = handoff.render(**{**BASE, "model_name": "<script>x</script>"})
    assert "<script>" not in page


def test_write_puts_the_page_where_it_says_it_did(tmp_path):
    dest = tmp_path / "sub" / "dragon-80mm - how to print this.html"
    result = handoff.write(dest, **BASE)
    assert result.path == dest
    assert dest.read_text(encoding="utf-8").startswith("<!doctype html>")
