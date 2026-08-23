"""Output file naming, §6.5: "recognizable, never a UUID".

This looks cosmetic and is not. The file's name is the only handle the user has
on it once it is sitting in Files on an iPad among the other things they have
prepared, and it is what they must match in MakerWorld's file picker. Two prints
of the same model at different sizes have to be tellable apart there.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from prep.cli import _output_path


def test_the_name_carries_the_model_and_the_size():
    out = _output_path(None, "/models/dragon.stl", 80.0)
    assert out.name == "dragon-80mm.3mf"


def test_the_size_is_rounded_because_nobody_reads_80_04mm():
    assert _output_path(None, "d.stl", 80.04).name == "d-80mm.3mf"
    assert _output_path(None, "d.stl", 79.6).name == "d-80mm.3mf"


def test_two_sizes_of_one_model_do_not_collide():
    small = _output_path(None, "d.stl", 35.0)
    large = _output_path(None, "d.stl", 120.0)
    assert small != large


def test_it_lands_beside_the_model_when_nothing_is_asked_for():
    out = _output_path(None, "/models/dragon.stl", 80.0)
    assert out.parent == Path("/models")


def test_a_directory_gets_the_recognisable_name_inside_it(tmp_path):
    # What the launcher passes: it knows the folder, not the finished size.
    out = _output_path(str(tmp_path), "/models/dragon.stl", 80.0)
    assert out == tmp_path / "dragon-80mm.3mf"


@pytest.mark.parametrize("suffix", ["/", "\\"])
def test_a_trailing_separator_means_directory_even_if_it_does_not_exist_yet(suffix):
    out = _output_path("out" + suffix, "dragon.stl", 80.0)
    assert out == Path("out") / "dragon-80mm.3mf"


def test_an_explicit_filename_is_still_honoured_exactly(tmp_path):
    # The API and the tests both pin exact paths; only the human-facing default
    # is being made friendlier.
    target = tmp_path / "whatever-i-said.3mf"
    assert _output_path(str(target), "dragon.stl", 80.0) == target


def test_a_model_named_with_dots_keeps_its_whole_name():
    out = _output_path(None, "v2.1.dragon.stl", 80.0)
    assert out.name == "v2.1.dragon-80mm.3mf"
