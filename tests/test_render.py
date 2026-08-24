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


# --- which side of the plate the camera is on -------------------------------
#
# Every render was made from *underneath* the plate for the life of this module,
# looking up at the bottom of the model. It survived because the shape it was
# checked against -- a box with a cylinder centred on top -- is nearly
# symmetrical about the plate and reads as plausible either way up.
#
# So these test the asymmetry directly, and one of them tests the vector itself,
# because a sign error here produces a picture that looks like a picture.

def test_the_camera_looks_down_at_the_plate_not_up_at_it():
    """EYE_DIR points from the model towards the eye, so a positive Z there has
    to come out as a negative Z in the direction the camera faces."""
    verts = np.array([[0.0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])
    basis = render._camera(verts, render.EYE_DIR, render.UP)

    assert render.EYE_DIR[2] > 0, "the eye belongs above the plate"
    forward = basis[2]
    assert forward[2] < 0, "the camera is looking up from underneath the plate"


def test_something_sitting_on_top_is_visible_from_the_camera():
    """The behavioural version, which does not care how the basis is built.

    A small block on a wide slab is visible from above -- it sits inside the
    slab's outline and changes those pixels. From below it is entirely hidden
    behind the slab, and the two renders come out all but identical.
    """
    slab = trimesh.creation.box(extents=(60, 60, 4)).apply_translation([0, 0, 2])
    block = trimesh.creation.box(extents=(16, 16, 16)).apply_translation([0, 0, 12])

    from PIL import Image
    import io

    def pixels(mesh):
        png = render.preview_png(mesh)
        return np.array(Image.open(io.BytesIO(png)).convert("RGB"), dtype=int)

    bare = pixels(slab)
    stacked = pixels(trimesh.util.concatenate([slab, block]))

    differing = int((np.abs(bare - stacked).sum(axis=2) > 12).sum())
    assert differing > 2000, (
        f"only {differing} pixels changed -- the block on top is not being "
        f"seen, which means the camera is under the plate")


def test_the_top_view_looks_straight_down():
    slab = trimesh.creation.box(extents=(60, 40, 4))
    verts, faces = render._proxy(slab)
    basis = render._camera(verts, render.TOP_DOWN, render.UP)

    assert render.TOP_DOWN[2] > 0
    assert basis[2] == pytest.approx([0, 0, -1], abs=1e-9)
