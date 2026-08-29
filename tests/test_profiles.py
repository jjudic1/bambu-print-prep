"""Profile resolution against the slicer's own vendor bundle.

These assert facts about real printers. If a slicer update changes them, this
should fail loudly -- silently shipping a wrong build volume means every model
gets clamped to the wrong size.
"""

import pytest

from prep import profiles
from prep.profiles import (
    ProfileError,
    default_filament,
    default_process,
    list_models,
    list_printers,
    load_printer,
    project_settings,
    resolve,
)

P1S = "Bambu Lab P1S 0.4 nozzle"
A1_MINI = "Bambu Lab A1 mini 0.4 nozzle"

# What Bambu sells, and what the browser now offers. Every machine in the
# vendored tree has a profile for all four.
NOZZLES_MM = [0.2, 0.4, 0.6, 0.8]


def test_known_models_are_listed():
    models = list_models()
    assert "Bambu Lab P1S" in models
    assert "Bambu Lab X1 Carbon" in models


def test_printer_profiles_exclude_the_common_bases():
    names = list_printers()
    assert P1S in names
    assert not any("common" in n for n in names)


@pytest.mark.parametrize("name,bed,height,nozzle", [
    (P1S, (256.0, 256.0), 250.0, 0.4),
    (A1_MINI, (180.0, 180.0), 180.0, 0.4),
])
def test_build_volumes_match_the_published_specs(name, bed, height, nozzle):
    p = load_printer(name)
    assert p.bed_mm == bed
    assert p.height_mm == height
    assert p.nozzle_mm == nozzle


def test_nozzle_variants_resolve_separately():
    assert load_printer("Bambu Lab P1S 0.8 nozzle").nozzle_mm == 0.8
    assert load_printer("Bambu Lab P1S 0.2 nozzle").nozzle_mm == 0.2


def test_inherits_chain_is_flattened():
    """printable_area lives on a common ancestor, not on the leaf profile."""
    leaf = profiles._load_raw("BBL", "machine", P1S)
    assert "printable_area" not in leaf
    assert "printable_area" in resolve("BBL", "machine", P1S)


def test_resolution_drops_lookup_bookkeeping():
    resolved = resolve("BBL", "machine", P1S)
    assert "inherits" not in resolved
    assert "from" not in resolved


def test_bed_exclusion_zone_is_carried():
    """The P1S has a purge area at the origin corner; placement must know about it."""
    assert load_printer(P1S).exclude_areas


def test_bed_centre():
    assert load_printer(P1S).bed_centre == (128.0, 128.0)


@pytest.mark.parametrize("size,expected", [
    ((100, 100, 100), True),
    ((255, 255, 249), True),
    ((257, 100, 100), False),
    ((100, 100, 251), False),
])
def test_fits(size, expected):
    assert load_printer(P1S).fits(size) is expected


def test_unknown_printer_is_a_clear_error():
    with pytest.raises(ProfileError, match="No machine profile"):
        load_printer("Definitely Not A Printer")


def test_process_selection_uses_compatibility_not_name():
    """The P1S shares the X1C process profiles -- matching on name finds nothing."""
    chosen = default_process(P1S)
    assert chosen.startswith("0.20mm Standard")
    assert "P1S" not in chosen


def test_every_machine_has_a_profile_for_every_nozzle():
    """The nozzle picker offers all four for every machine, and each is its own
    machine profile. A slicer update that drops one takes the option with it."""
    by_model = {}
    for name in list_printers():
        try:
            printer = load_printer(name)
        except ProfileError:
            continue                      # a G-code template, not a machine
        by_model.setdefault(printer.model, set()).add(printer.nozzle_mm)

    for model in ("Bambu Lab P1S", "Bambu Lab A1 mini", "Bambu Lab H2D"):
        assert set(NOZZLES_MM) <= by_model[model], model


@pytest.mark.parametrize("nozzle_mm", NOZZLES_MM)
def test_the_process_is_the_one_the_machine_asks_for(nozzle_mm):
    """Only the 0.4 profiles carry a "0.20mm Standard" -- a 0.2 mm nozzle
    cannot lay a 0.2 mm layer -- so the name search alone used to fall through
    to whatever sorted first. The machine names its own default; take that."""
    name = f"Bambu Lab P1S {nozzle_mm} nozzle"
    chosen = default_process(name)

    assert chosen == resolve("BBL", "machine", name)["default_print_profile"]
    # A quarter to three quarters of the tip is the printable range; Bambu's
    # own defaults all sit at half.
    layer = float(resolve("BBL", "process", chosen)["layer_height"])
    assert nozzle_mm * 0.25 <= layer <= nozzle_mm * 0.75


def test_the_0_4_process_is_the_one_that_has_always_shipped():
    """Every file this project has ever written was for a 0.4 mm nozzle. Asking
    the machine instead of searching by name must not have moved any of them."""
    for name in list_printers():
        try:
            printer = load_printer(name)
        except ProfileError:
            continue
        if printer.nozzle_mm != 0.4:
            continue
        assert default_process(name).startswith("0.20mm Standard"), name


def test_default_filament_prefers_bambu_pla():
    assert default_filament(P1S).startswith("Bambu PLA Basic")


def test_a_material_the_machine_has_no_profile_for_is_refused():
    """It used to fall through to options[0] -- every filament the printer
    knows, of every material -- so asking an A1 mini for ABS returned a PETG
    profile and the file said ABS on it. The A1 family is open-frame and has no
    ABS at all; no 0.2 mm nozzle has TPU. Saying so is the only honest answer,
    and it is what lets the picker offer only what exists."""
    with pytest.raises(ProfileError, match="No ABS filament profile"):
        default_filament(A1_MINI, material="ABS")
    with pytest.raises(ProfileError, match="No TPU filament profile"):
        default_filament("Bambu Lab P1S 0.2 nozzle", material="TPU")


def test_the_filament_chosen_is_actually_that_material():
    """Matched on what the profile says it is, not on what it is called."""
    for name in (P1S, "Bambu Lab P1S 0.6 nozzle", A1_MINI):
        for material in ("PLA", "PETG"):
            chosen = default_filament(name, material=material)
            assert profiles.filament_type(chosen) == material, (name, material)


def test_material_choice_is_honoured():
    assert "PETG" in default_filament(P1S, material="PETG")


def test_project_settings_merge_carries_all_three_sources():
    p = load_printer(P1S)
    s = project_settings(p, default_process(p.name), default_filament(p.name))

    assert s["printer_model"] == "Bambu Lab P1S"          # machine
    assert s["layer_height"] == "0.2"                      # process
    assert s["filament_type"] == ["PLA"]                   # filament
    assert s["printable_area"] == ["0x0", "256x0", "256x256", "0x256"]


def test_project_settings_identifies_its_source_profiles():
    p = load_printer(P1S)
    proc, fil = default_process(p.name), default_filament(p.name)
    s = project_settings(p, proc, fil)

    assert s["print_settings_id"] == proc
    assert s["printer_settings_id"] == p.name
    assert s["filament_settings_id"] == [fil]
    assert s["name"] == "project_settings"
    assert s["from"] == "project"


def test_project_settings_drops_bookkeeping_keys():
    p = load_printer(P1S)
    s = project_settings(p, default_process(p.name), default_filament(p.name))
    for key in ("compatible_printers", "instantiation", "setting_id", "type"):
        assert key not in s
