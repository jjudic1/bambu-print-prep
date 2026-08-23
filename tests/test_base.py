"""Levelling the bottom, and supports being on by default.

Both exist because of the same failure: a sculpted bust arrives resting on a
curve. It touches the plate at a point, so it topples or prints its first layers
into thin air, and the person holding the iPad has no way to see that coming.

The cut is destructive, so the tests care as much about restraint as effect:
it must not fire on a model that is already flat, and it must never take more
than the ceiling allows.
"""

import json
import zipfile

import pytest
import trimesh

from prep.base import MAX_CUT_FRACTION, adequate_contact, flatten_base
from prep.orient import _contact_area
from prep.profiles import (
    SUPPORT_DEFAULTS,
    default_filament,
    default_process,
    load_printer,
    project_settings,
)
from prep.write3mf import write_project_3mf

P1S = "Bambu Lab P1S 0.4 nozzle"


@pytest.fixture(scope="module")
def printer():
    return load_printer(P1S)


@pytest.fixture(scope="module")
def bust():
    """Head and shoulders resting on a curve -- the shape this feature is for."""
    body = trimesh.creation.icosphere(subdivisions=4, radius=30)
    body.apply_scale((1.0, 0.8, 1.6))
    head = trimesh.creation.icosphere(subdivisions=4, radius=18)
    head.apply_translation((0, 0, 46))
    mesh = trimesh.boolean.union([body, head])
    mesh.apply_translation(-mesh.bounds[0])
    return mesh


# --- flat base ----------------------------------------------------------------

def test_a_curved_bottom_gets_levelled(bust):
    before = _contact_area(bust)
    assert before < adequate_contact(bust), "fixture should start with a point contact"

    cut, result = flatten_base(bust)

    assert result.cut
    assert result.adequate
    assert result.contact_after_mm2 > result.contact_before_mm2 * 10
    assert result.contact_after_mm2 >= adequate_contact(cut) * 0.9


def test_the_cut_stays_watertight(bust):
    """A cut that opens the model would be worse than the problem it solves."""
    cut, result = flatten_base(bust)
    assert result.cut
    assert cut.is_watertight


def test_the_cut_is_small(bust):
    cut, result = flatten_base(bust)
    assert result.removed_mm <= bust.extents[2] * MAX_CUT_FRACTION + 1e-6
    # It should take barely any volume -- this is levelling, not amputation.
    assert abs(cut.volume) > abs(bust.volume) * 0.99


def test_the_cut_result_sits_on_the_plate(bust):
    cut, _ = flatten_base(bust)
    assert cut.bounds[0][2] == pytest.approx(0.0, abs=1e-9)


def test_an_already_flat_model_is_left_alone():
    """A box has a perfect base. Cutting it would be pure damage."""
    box = trimesh.creation.box(extents=(40, 40, 40))
    cut, result = flatten_base(box)

    assert not result.cut
    assert result.removed_mm == 0.0
    assert result.note is None
    assert cut is box


def test_a_sphere_is_not_amputated():
    """A sphere can never reach an adequate footprint within the ceiling.

    It must still refuse to take more than the cap, rather than slicing away
    a third of the model chasing the target.
    """
    sphere = trimesh.creation.icosphere(subdivisions=4, radius=25)
    sphere.apply_translation(-sphere.bounds[0])

    cut, result = flatten_base(sphere)
    assert result.removed_mm <= sphere.extents[2] * MAX_CUT_FRACTION + 1e-6
    if result.cut:
        assert result.contact_after_mm2 > result.contact_before_mm2


def test_the_note_avoids_jargon(bust):
    _, result = flatten_base(bust)
    for word in ("mesh", "manifold", "slice", "plane", "boolean", "z-axis"):
        assert word not in result.note.lower()


def test_max_cut_fraction_is_respected_when_lowered(bust, monkeypatch):
    cut, result = flatten_base(bust, max_fraction=0.01)
    assert result.removed_mm <= bust.extents[2] * 0.01 + 1e-6


# --- supports -----------------------------------------------------------------

def test_supports_are_on_by_default(printer):
    """Bambu's stock profiles ship supports off, which fails overhanging models."""
    settings = project_settings(printer, default_process(printer.name),
                                default_filament(printer.name))
    assert settings["enable_support"] == "1"


def test_supports_are_automatic_not_forced(printer):
    """Auto means a model with no overhangs still gets no support material."""
    settings = project_settings(printer, default_process(printer.name),
                                default_filament(printer.name))
    assert "auto" in settings["support_type"]


def test_supports_can_be_turned_off(printer):
    settings = project_settings(printer, default_process(printer.name),
                                default_filament(printer.name), supports=False)
    assert settings["enable_support"] == "0"


def test_support_defaults_are_all_real_profile_keys(printer):
    """A typo here would be silent -- the key would just sit in the file unused."""
    stock = project_settings(printer, default_process(printer.name),
                             default_filament(printer.name), supports=False)
    for key in SUPPORT_DEFAULTS:
        assert key in stock, f"{key} is not a key the slicer profiles define"


def test_written_file_carries_the_support_setting(printer, tmp_path):
    box = trimesh.creation.box(extents=(20, 20, 20))

    on = tmp_path / "on.3mf"
    write_project_3mf(on, box, printer)
    settings = json.loads(zipfile.ZipFile(on).read("Metadata/project_settings.config"))
    assert settings["enable_support"] == "1"

    off = tmp_path / "off.3mf"
    write_project_3mf(off, box, printer, supports=False)
    settings = json.loads(zipfile.ZipFile(off).read("Metadata/project_settings.config"))
    assert settings["enable_support"] == "0"


# --- what makes Bambu Studio actually honour the settings ---------------------

def test_settings_declare_a_client_version(printer):
    """374 of 375 real Bambu project files carry one; ours carried none.

    A config Bambu Studio cannot version is a config it may discard, falling
    back to the system profile -- which is how "supports on" silently became
    "supports off".
    """
    settings = project_settings(printer, default_process(printer.name),
                                default_filament(printer.name))
    assert "version" in settings
    assert settings["version"].count(".") == 3


def test_every_override_is_declared_to_the_slicer(printer):
    """Bambu Studio re-applies only the keys named in different_settings_to_system.

    An override missing from that manifest is reverted to the system profile,
    so the manifest must name every key whose value we changed.
    """
    process, filament = default_process(printer.name), default_filament(printer.name)
    stock = project_settings(printer, process, filament, supports=False)
    ours = project_settings(printer, process, filament, supports=True)

    declared = set(ours["different_settings_to_system"][0].split(";")) - {""}
    ignored = {"different_settings_to_system"}
    actually_changed = {
        k for k in SUPPORT_DEFAULTS
        if k not in ignored and stock.get(k) != ours.get(k)
    }
    assert actually_changed == declared


def test_the_manifest_has_one_slot_per_filament_plus_printer(printer):
    """Positional list: [print settings, one per filament, printer]."""
    settings = project_settings(printer, default_process(printer.name),
                                default_filament(printer.name))
    manifest = settings["different_settings_to_system"]
    assert len(manifest) == len(settings["filament_settings_id"]) + 2
    assert all(entry == "" for entry in manifest[1:])


def test_settings_are_roughly_as_complete_as_bambus(printer):
    """Bambu writes ~320 keys; resolving profiles alone gave only 235.

    The gap is the slicer's compiled-in defaults, which appear in no JSON on
    disk and are vendored in prep/data/bambu_baseline.json instead.
    """
    settings = project_settings(printer, default_process(printer.name),
                                default_filament(printer.name))
    assert len(settings) >= 290
