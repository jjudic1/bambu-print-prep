"""The software rasteriser, prep/render.py.

It exists because dropping Bambu Studio drops its renderer too, and something
has to draw the gallery image. A GL-based renderer could not be tested at all
in CI; this one is deterministic, so the tests can be about what it draws rather
than merely that it did not crash.
"""

from __future__ import annotations

import struct
import zipfile

import numpy as np
import pytest
import trimesh

from prep import render


@pytest.fixture
def box():
    return trimesh.creation.box(extents=(40, 30, 20))


def png_size(data: bytes) -> tuple:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    return struct.unpack(">II", data[16:24])


# --- the PNG encoder --------------------------------------------------------

def test_the_encoder_produces_a_png_a_real_reader_accepts():
    # Written with zlib by hand, so an independent reader is the only honest
    # check that the CRCs and the IDAT stream are right.
    rgba = np.zeros((8, 8, 4), dtype=np.uint8)
    rgba[..., 0] = 255
    rgba[..., 3] = 255
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(render.write_png(rgba)))
    assert img.size == (8, 8)
    assert img.convert("RGBA").getpixel((0, 0)) == (255, 0, 0, 255)


def test_alpha_survives_the_encoder():
    rgba = np.zeros((4, 4, 4), dtype=np.uint8)
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(render.write_png(rgba))).convert("RGBA")
    assert img.getpixel((0, 0))[3] == 0


# --- the five plate images --------------------------------------------------

def test_all_five_thumbnails_are_the_sizes_bambu_writes(box):
    t = render.thumbnails(box)
    assert png_size(t.plate) == (512, 512)
    assert png_size(t.plate_small) == (128, 128)
    assert png_size(t.plate_no_light) == (512, 512)
    assert png_size(t.top) == (512, 512)
    assert png_size(t.pick) == (512, 512)


def test_it_actually_draws_the_model(box):
    # An empty render is the failure mode that would sail past a size check and
    # land a blank gallery image on the user's listing.
    from PIL import Image
    import io
    img = np.array(Image.open(io.BytesIO(render.preview_png(box))).convert("RGBA"))
    covered = (img[..., 3] > 0).mean()
    assert 0.15 < covered < 0.95, f"model covers {covered:.0%} of the frame"


def test_the_background_is_transparent_not_black(box):
    from PIL import Image
    import io
    img = np.array(Image.open(io.BytesIO(render.preview_png(box))).convert("RGBA"))
    assert img[0, 0, 3] == 0


def test_the_top_view_is_a_different_picture(box):
    t = render.thumbnails(box)
    assert t.top != t.plate


def test_shading_makes_a_difference(box):
    t = render.thumbnails(box)
    assert t.plate != t.plate_no_light


def test_rendering_is_deterministic(box):
    # Two runs of the same model must be byte-identical, or the container stops
    # being reproducible and diffing two outputs tells you nothing.
    assert render.preview_png(box) == render.preview_png(box)


def test_rendering_one_model_does_not_disturb_the_next(box):
    """The camera was once a module-level array that the top view mutated.

    In a worker rendering two jobs at once that puts one model's picture on
    another model's listing, which is invisible in tests that render one thing.
    """
    before = render.preview_png(box)
    render.thumbnails(trimesh.creation.icosphere(radius=10))
    assert render.preview_png(box) == before


def test_a_dense_mesh_is_still_rendered_promptly():
    dense = trimesh.creation.icosphere(subdivisions=5)      # ~20k faces
    assert len(dense.faces) > render.MAX_FACES
    assert png_size(render.preview_png(dense)) == (512, 512)


def test_a_degenerate_mesh_does_not_crash_the_render():
    flat = trimesh.Trimesh(vertices=[[0, 0, 0], [1, 0, 0], [2, 0, 0]],
                           faces=[[0, 1, 2]], process=False)
    assert png_size(render.preview_png(flat)) == (512, 512)
