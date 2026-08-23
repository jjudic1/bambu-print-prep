"""Rewriting output through Bambu Studio so MakerWorld will take it.

Our own container is a valid project 3mf -- Bambu Studio opens it and honours
every setting -- but MakerWorld's upload form rejects it outright. Rewriting the
same file through Bambu Studio produces one it accepts, with our geometry and
settings intact. Confirmed against the live site on 2026-08-23.

The round-trip test costs about a minute, so it runs only when
PREP_SLOW_TESTS is set. The rest of the file is fast.
"""

import os
import zipfile

import pytest
import trimesh

from prep import bambu
from prep.profiles import load_printer
from prep.write3mf import write_project_3mf

pytestmark = pytest.mark.skipif(
    not bambu.available(),
    reason="Bambu Studio is not installed; MakerWorld-ready output is unavailable")

SLOW = pytest.mark.skipif(
    not os.environ.get("PREP_SLOW_TESTS"),
    reason="set PREP_SLOW_TESTS=1 to run the Bambu Studio round-trip")


def test_finds_the_executable():
    exe = bambu.find_bambu_studio()
    assert exe is not None and exe.is_file()


def test_explicit_override_wins(monkeypatch, tmp_path):
    fake = tmp_path / "elsewhere.exe"
    fake.write_bytes(b"")
    monkeypatch.setenv("PREP_BAMBU_STUDIO", str(fake))
    assert bambu.find_bambu_studio() == fake


def test_missing_override_reports_unavailable(monkeypatch, tmp_path):
    monkeypatch.setenv("PREP_BAMBU_STUDIO", str(tmp_path / "nope.exe"))
    assert bambu.find_bambu_studio() is None
    assert not bambu.available()


def test_unavailable_raises_a_plain_language_error(monkeypatch, tmp_path):
    monkeypatch.setenv("PREP_BAMBU_STUDIO", str(tmp_path / "nope.exe"))
    with pytest.raises(bambu.BambuStudioUnavailable, match="MakerWorld"):
        bambu.rewrite_for_makerworld(tmp_path / "whatever.3mf")


@SLOW
def test_rewrite_preserves_geometry_and_settings(tmp_path):
    """The whole point: MakerWorld's container, but still our model."""
    import json

    printer = load_printer("Bambu Lab P1S 0.4 nozzle")
    mesh = trimesh.creation.box(extents=(30, 20, 10))
    path = tmp_path / "model.3mf"
    write_project_3mf(path, mesh, printer, title="model.stl")

    before = trimesh.load(path, force="mesh")
    before_members = len(zipfile.ZipFile(path).namelist())

    bambu.rewrite_for_makerworld(path)

    after = trimesh.load(path, force="mesh")
    settings = json.loads(zipfile.ZipFile(path).read("Metadata/project_settings.config"))
    model = zipfile.ZipFile(path).read("3D/3dmodel.model").decode("utf-8")

    assert after.extents == pytest.approx(before.extents, abs=1e-3)
    assert after.bounds[0][2] == pytest.approx(0.0, abs=1e-3)
    assert settings["enable_support"] == "1"
    assert settings["support_type"] == "tree(auto)"
    assert settings["printer_model"] == "Bambu Lab P1S"
    # Bambu Studio writes a much richer container than we do -- that difference
    # is exactly what MakerWorld was rejecting.
    assert len(zipfile.ZipFile(path).namelist()) > before_members
    assert '<metadata name="Application">BambuStudio-' in model
