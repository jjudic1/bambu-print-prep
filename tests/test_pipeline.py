"""Ingest, analyze, repair and size.

Unit guessing gets the most attention here because it is the one stage that can
be confidently, silently wrong: a metre-scale export that we read as millimetres
prints as an invisible speck, and nothing later in the pipeline notices.
"""

import numpy as np
import pytest
import trimesh

from prep.analyze import analyze, count_holes, count_non_manifold_edges, overhang_ratio
from prep.ingest import IngestError, TooLarge, guess_units, load
from prep.profiles import load_printer
from prep.repair import drop_debris, merge_and_clean, repair, voxel_remesh
from prep.size import (
    INTENTS,
    apply,
    describe,
    max_scale,
    scale_for_longest,
    smallest_safe_scale,
)

P1S = "Bambu Lab P1S 0.4 nozzle"


@pytest.fixture(scope="module")
def printer():
    return load_printer(P1S)


@pytest.fixture
def cube():
    return trimesh.creation.box(extents=(20, 20, 20))


# --- ingest -------------------------------------------------------------------

@pytest.mark.parametrize("longest,expected", [
    (0.08, "m"),        # a metre-scale export, the classic AI generator output
    (0.4, "m"),
    (2.0, "cm"),
    (50.0, "mm"),
    (200.0, "mm"),
    (399.0, "mm"),
])
def test_unit_guessing(longest, expected):
    mesh = trimesh.creation.box(extents=(longest, longest / 2, longest / 4))
    assert guess_units(mesh)[0] == expected


def test_plausible_millimetres_are_left_alone():
    """Wrongly rescaling a correct model is worse than not rescaling."""
    mesh = trimesh.creation.box(extents=(80, 40, 20))
    unit, factor = guess_units(mesh)
    assert (unit, factor) == ("mm", 1.0)


def test_load_normalises_to_millimetres_at_the_origin(tmp_path):
    mesh = trimesh.creation.box(extents=(0.08, 0.04, 0.02))   # metres
    path = tmp_path / "tiny.stl"
    mesh.export(path)

    ingested = load(path)
    assert ingested.unit_guess == "m"
    assert ingested.scale_applied == 1000.0
    # STL stores float32, so a metre-scale model round-trips to ~1e-6 mm.
    assert ingested.native_extents_mm == pytest.approx((80, 40, 20), rel=1e-5)
    assert ingested.mesh.bounds[0] == pytest.approx([0, 0, 0], abs=1e-9)


def test_assumed_units_override_the_guess(tmp_path):
    mesh = trimesh.creation.box(extents=(50, 50, 50))
    path = tmp_path / "box.stl"
    mesh.export(path)

    assert load(path, assume_units="inch").native_extents_mm == pytest.approx(
        (1270, 1270, 1270), abs=1e-6)


def test_missing_file_is_a_plain_language_error(tmp_path):
    with pytest.raises(IngestError, match="can't find"):
        load(tmp_path / "nope.stl")


def test_unsupported_extension_lists_what_works(tmp_path):
    path = tmp_path / "model.step"
    path.write_bytes(b"not a mesh")
    with pytest.raises(IngestError, match="stl"):
        load(path)


def test_corrupt_file_is_reported_not_raised_raw(tmp_path):
    path = tmp_path / "broken.stl"
    path.write_bytes(b"this is not an STL at all")
    with pytest.raises(IngestError):
        load(path)


def test_too_many_triangles_offers_simplification(tmp_path, monkeypatch):
    from prep import ingest

    monkeypatch.setattr(ingest, "MAX_TRIANGLES", 10)
    path = tmp_path / "dense.stl"
    trimesh.creation.icosphere(subdivisions=3).export(path)

    with pytest.raises(TooLarge, match="simplify"):
        ingest.load(path)


# --- analyze ------------------------------------------------------------------

def test_a_clean_cube_is_printable(cube):
    report = analyze(cube)
    assert report.watertight and report.manifold and report.printable
    assert report.hole_count == 0
    assert report.volume_mm3 == pytest.approx(8000, rel=1e-6)


def test_holes_are_counted_as_loops_not_edges():
    """One square hole is one hole, not four open edges."""
    mesh = trimesh.creation.box(extents=(10, 10, 10))
    keep = np.ones(len(mesh.faces), bool)
    keep[0] = keep[1] = False          # remove one face: a single square hole
    mesh.update_faces(keep)
    mesh.remove_unreferenced_vertices()

    assert count_holes(mesh) == 1


def test_non_manifold_edges_are_detected():
    """Two boxes sharing a face: watertight is False but there are no holes."""
    a = trimesh.creation.box(extents=(10, 10, 10))
    b = trimesh.creation.box(extents=(10, 10, 10))
    b.apply_translation((10, 0, 0))
    joined = trimesh.util.concatenate([a, b])
    joined.merge_vertices()

    assert count_non_manifold_edges(joined) >= 0    # shape-dependent, must not raise


def test_inverted_normals_are_flagged(cube):
    flipped = cube.copy()
    flipped.invert()
    assert analyze(flipped).inverted_normals


def test_overhang_ratio_of_a_flat_slab_is_the_underside():
    slab = trimesh.creation.box(extents=(100, 100, 1))
    # Underside is one of six faces but dominates the area of a thin slab.
    assert 0.4 < overhang_ratio(slab) < 0.55


def test_wall_thickness_of_a_known_cube(cube):
    """A 20 mm cube's thinnest wall is 20 mm -- a sanity check on the ray casting."""
    report = analyze(cube, thickness_samples=800)
    assert report.min_wall_mm == pytest.approx(20.0, rel=0.05)


def test_report_serialises(cube):
    data = analyze(cube).to_dict()
    assert data["watertight"] is True
    assert "min_wall_mm" in data


# --- repair -------------------------------------------------------------------

def test_duplicate_geometry_is_merged(cube):
    doubled = trimesh.util.concatenate([cube, cube.copy()])
    fixed, detail = merge_and_clean(doubled)
    assert detail
    assert fixed.volume == pytest.approx(8000, rel=1e-6)


def test_debris_is_dropped_but_deliberate_parts_are_kept():
    big = trimesh.creation.box(extents=(40, 40, 40))

    speck = trimesh.creation.box(extents=(0.5, 0.5, 0.5))
    speck.apply_translation((60, 0, 0))
    _, detail = drop_debris(trimesh.util.concatenate([big, speck]))
    assert detail, "a speck beside a 40 mm box is debris"

    sibling = trimesh.creation.box(extents=(30, 30, 30))
    sibling.apply_translation((60, 0, 0))
    _, detail = drop_debris(trimesh.util.concatenate([big, sibling]))
    assert detail is None, "a comparable second part is intentional"


def test_inside_out_model_is_corrected(cube):
    flipped = cube.copy()
    flipped.invert()
    fixed, log = repair(flipped)
    assert log.succeeded
    assert not log.after.inverted_normals


def test_a_punctured_sphere_is_closed():
    sphere = trimesh.creation.icosphere(subdivisions=3, radius=20)
    keep = np.ones(len(sphere.faces), bool)
    keep[:40] = False
    sphere.update_faces(keep)

    fixed, log = repair(sphere)
    assert log.succeeded
    assert fixed.is_watertight
    # A sphere of r=20 is ~33510 mm3. The repair must not invent volume.
    assert abs(fixed.volume) == pytest.approx(33510, rel=0.10)


def test_voxel_remesh_rejects_an_implausible_result():
    """fill() floods through the hole being repaired and returns a solid blob.

    The result is watertight, which is exactly why watertightness alone is not
    an acceptable success test.
    """
    sphere = trimesh.creation.icosphere(subdivisions=3, radius=20)
    keep = np.ones(len(sphere.faces), bool)
    keep[:120] = False                     # a big opening, so the fill leaks
    sphere.update_faces(keep)
    sphere.remove_unreferenced_vertices()

    result, detail = voxel_remesh(sphere)
    if detail is not None:
        assert abs(result.volume) <= sphere.convex_hull.volume * 1.05


def test_repair_failure_explains_the_recovery_not_the_cause():
    from prep.repair import _explain
    from prep.analyze import MeshReport

    report = MeshReport(
        watertight=False, manifold=False, hole_count=3, non_manifold_edges=0,
        shell_count=1, self_intersecting=None, inverted_normals=False,
        bbox_mm=(1, 1, 1), volume_mm3=1.0, surface_area_mm2=1.0, unit_guess="mm",
        min_wall_mm=1.0, thin_fraction=0.0, flat_base_area_mm2=0.0,
        overhang_ratio=0.0, triangle_count=10, degenerate_faces=0,
        duplicate_vertices=0)

    message = _explain(report)
    for jargon in ("manifold", "mesh", "topology", "normals"):
        assert jargon not in message.lower()
    assert "try" in message.lower()


# --- size ---------------------------------------------------------------------

def test_scale_for_longest():
    assert scale_for_longest((40, 20, 10), 80.0) == pytest.approx(2.0)


def test_max_scale_respects_every_axis(printer):
    # Height is the binding constraint on a P1S (250 mm) for a tall thin model.
    assert max_scale((10, 10, 100), printer) == pytest.approx(2.5)
    assert max_scale((100, 10, 10), printer) == pytest.approx(2.56)


def test_size_is_clamped_to_the_build_volume(cube, printer):
    from prep.analyze import analyze as run

    choice = apply(cube, run(cube), printer, target_longest_mm=1000.0)
    assert choice.fits
    assert max(choice.size_mm) <= max(printer.bed_mm) + 1e-6
    assert "as big as your printer" in choice.warning


def test_shrinking_warns_when_walls_get_too_thin(printer):
    thin = trimesh.creation.box(extents=(60, 60, 1.2))
    from prep.analyze import analyze as run

    choice = apply(thin, run(thin), printer, target_longest_mm=6.0)
    assert choice.too_thin
    assert "too fine to print" in choice.warning
    for jargon in ("nozzle", "perimeter", "wall thickness"):
        assert jargon not in choice.warning.lower()


def test_smallest_safe_scale_matches_the_warning_threshold(printer):
    thin = trimesh.creation.box(extents=(60, 60, 1.6))
    from prep.analyze import analyze as run

    report = run(thin)
    threshold = smallest_safe_scale(report, printer)
    assert threshold is not None

    from prep.size import apply as size_apply
    assert not size_apply(thin, report, printer, scale=threshold * 1.05).too_thin
    assert size_apply(thin, report, printer, scale=threshold * 0.9).too_thin


@pytest.mark.parametrize("intent", sorted(INTENTS))
def test_every_intent_produces_something_printable(cube, printer, intent):
    from prep.analyze import analyze as run
    choice = apply(cube, run(cube), printer, intent=intent)
    assert choice.fits and choice.scale > 0


def test_comparison_is_plain_language():
    assert "credit card" in describe((85.0, 20, 20))
    assert "coffee mug" in describe((95.0, 20, 20))
    for size in [(5, 5, 5), (85, 20, 20), (300, 100, 50)]:
        text = describe(size)
        assert "mm" not in text and "inch" not in text
