"""The 3mf writer, and above all the transform convention.

A transposed rotation matrix produces a file that opens fine and prints wrong.
Nothing downstream can catch that, so it is pinned here against a hand-computed
expectation rather than against the writer's own output.
"""

import zipfile

import numpy as np
import pytest
import trimesh

from prep.profiles import load_printer
from prep.write3mf import (
    place_on_bed,
    transform_from_3mf,
    transform_to_3mf,
    write_project_3mf,
)


@pytest.fixture(scope="module")
def printer():
    return load_printer("Bambu Lab P1S 0.4 nozzle")


@pytest.fixture
def wedge():
    """An asymmetric mesh: every axis distinguishable, no accidental symmetry."""
    mesh = trimesh.creation.box(extents=(10, 20, 30))
    mesh.apply_translation((5, 10, 15))
    return mesh


def test_identity_transform_serialises_to_identity():
    assert transform_to_3mf(np.eye(4)) == "1 0 0 0 1 0 0 0 1 0 0 0"


def test_transform_is_written_as_the_transpose():
    """3MF uses row-vector convention: the 3x3 is our matrix transposed.

    Verified against an independent reader in spikes/a1_transform_oracle.py.
    A 90 deg rotation about Z maps +X to +Y; under our column-vector matrix that
    is M[1][0] == 1, and 3MF must therefore emit it in the second slot.
    """
    m = trimesh.transformations.rotation_matrix(np.radians(90), (0, 0, 1))
    values = [float(v) for v in transform_to_3mf(m).split()]

    assert values[:3] == pytest.approx([0, 1, 0], abs=1e-9)   # image of +X
    assert values[3:6] == pytest.approx([-1, 0, 0], abs=1e-9)  # image of +Y
    assert values[6:9] == pytest.approx([0, 0, 1], abs=1e-9)   # image of +Z


def test_transform_roundtrip():
    m = trimesh.transformations.rotation_matrix(np.radians(35), (1, 2, 3))
    m[:3, 3] = (12.5, -3.25, 7.0)
    assert np.allclose(transform_from_3mf(transform_to_3mf(m)), m)


def test_transform_rejects_wrong_shape():
    with pytest.raises(ValueError):
        transform_to_3mf(np.eye(3))
    with pytest.raises(ValueError):
        transform_from_3mf("1 0 0")


def test_place_on_bed_centres_and_grounds(printer, wedge):
    matrix = place_on_bed(wedge, printer)
    placed = wedge.copy()
    placed.apply_transform(matrix)

    low, high = placed.bounds
    assert low[2] == pytest.approx(0.0, abs=1e-9)
    assert ((low[:2] + high[:2]) / 2.0) == pytest.approx(printer.bed_centre, abs=1e-9)


def test_place_on_bed_grounds_after_rotation(printer, wedge):
    """The object must sit on the plate in its *oriented* pose, not its original one."""
    tilt = trimesh.transformations.rotation_matrix(np.radians(37), (1, 0, 0))

    placed = wedge.copy()
    placed.apply_transform(place_on_bed(wedge, printer, tilt))

    tilted_only = wedge.copy()
    tilted_only.apply_transform(tilt)

    assert placed.bounds[0][2] == pytest.approx(0.0, abs=1e-9)
    # Placement must not change the shape, only where it sits.
    assert placed.extents == pytest.approx(tilted_only.extents, abs=1e-6)


def test_written_file_has_the_required_members(printer, wedge, tmp_path):
    out = tmp_path / "wedge.3mf"
    write_project_3mf(out, wedge, printer, title="wedge.stl")

    names = set(zipfile.ZipFile(out).namelist())
    assert {"[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"} <= names
    assert "Metadata/project_settings.config" in names
    assert "Metadata/model_settings.config" in names


def test_written_file_reads_back_with_the_intended_geometry(printer, wedge, tmp_path):
    """trimesh is an unrelated 3MF implementation -- a good independent check."""
    tilt = (trimesh.transformations.rotation_matrix(np.radians(20), (1, 0, 0))
            @ trimesh.transformations.rotation_matrix(np.radians(40), (0, 0, 1)))
    out = tmp_path / "wedge.3mf"
    write_project_3mf(out, wedge, printer, title="wedge.stl", orientation=tilt)

    intended = wedge.copy()
    intended.apply_transform(place_on_bed(wedge, printer, tilt))
    back = trimesh.load(out, force="mesh")

    assert len(back.faces) == len(wedge.faces)
    assert back.extents == pytest.approx(intended.extents, abs=1e-3)
    assert back.bounds[0][2] == pytest.approx(0.0, abs=1e-3)


def test_result_reports_size_and_fit(printer, wedge, tmp_path):
    result = write_project_3mf(tmp_path / "w.3mf", wedge, printer)
    assert result.size_mm == pytest.approx((10, 20, 30), abs=1e-6)
    assert result.fits


def test_oversized_model_is_reported_as_not_fitting(printer, tmp_path):
    """Spec §5.6: validate against the build volume before writing, do not error out."""
    huge = trimesh.creation.box(extents=(400, 400, 400))
    result = write_project_3mf(tmp_path / "huge.3mf", huge, printer)
    assert not result.fits


def test_title_with_quotes_does_not_corrupt_the_xml(printer, wedge, tmp_path):
    out = tmp_path / "q.3mf"
    write_project_3mf(out, wedge, printer, title='a "quoted" & <odd> name.stl')

    import xml.etree.ElementTree as ET

    z = zipfile.ZipFile(out)
    ET.fromstring(z.read("Metadata/model_settings.config"))
    ET.fromstring(z.read("3D/3dmodel.model"))
