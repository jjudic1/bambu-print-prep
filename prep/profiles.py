"""Printer, process and filament profiles, read from a slicer's vendor bundle.

Slicers ship the authoritative build volumes, nozzle diameters and bed exclusion
zones as JSON with an ``inherits`` chain. Resolving that chain is strictly better
than hand-typing bed sizes, and it keeps every printer the slicer knows about
available to us for free.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# Where OrcaSlicer keeps its bundled vendor profiles. Override with
# PREP_PROFILE_ROOT when running somewhere the slicer is not installed
# (a container, CI) after vendoring the JSON into the repo.
DEFAULT_ROOTS = [
    Path(r"C:/Program Files/OrcaSlicer/resources/profiles"),
    Path(r"C:/Program Files/Bambu Studio/resources/profiles"),
    Path("/usr/share/OrcaSlicer/resources/profiles"),
    Path.home() / ".local/share/OrcaSlicer/resources/profiles",
]

DEFAULT_VENDOR = "BBL"

# The Bambu Studio version we present ourselves as. Every genuine project file
# carries one (374 of 375 in the local corpus); ours carried none, which is a
# plausible reason Bambu Studio treated the config as unusable.
CLIENT_VERSION = "01.10.01.50"

# Settings Bambu Studio always writes that exist in no JSON on disk -- they are
# the slicer's compiled-in defaults, absent from both OrcaSlicer's and Bambu
# Studio's own profile bundles. Harvested from real project files by
# spikes/a1_harvest_baseline.py. Without them our config is ~60 keys short of
# what Bambu Studio produces.
_BASELINE_PATH = Path(__file__).with_name("data") / "bambu_baseline.json"


@lru_cache(maxsize=1)
def baseline_settings() -> dict:
    if not _BASELINE_PATH.is_file():
        return {}
    return json.loads(_BASELINE_PATH.read_text(encoding="utf-8"))


class ProfileError(RuntimeError):
    """A profile could not be found or resolved."""


def profile_root() -> Path:
    env = os.environ.get("PREP_PROFILE_ROOT")
    if env:
        root = Path(env)
        if not root.is_dir():
            raise ProfileError(f"PREP_PROFILE_ROOT is not a directory: {root}")
        return root
    for root in DEFAULT_ROOTS:
        if root.is_dir():
            return root
    raise ProfileError(
        "No slicer profile bundle found. Install OrcaSlicer or set PREP_PROFILE_ROOT "
        "to a directory containing <vendor>.json and its machine/ process/ filament/ folders."
    )


@lru_cache(maxsize=8)
def _index(vendor: str) -> dict:
    path = profile_root() / f"{vendor}.json"
    if not path.is_file():
        raise ProfileError(f"No vendor index at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=8)
def _sub_paths(vendor: str, kind: str) -> dict[str, str]:
    """Map profile name -> path within the bundle, for one of the *_list keys."""
    entries = _index(vendor).get(f"{kind}_list", [])
    return {e["name"]: e["sub_path"] for e in entries}


def _load_raw(vendor: str, kind: str, name: str) -> dict:
    sub = _sub_paths(vendor, kind).get(name)
    if sub is None:
        raise ProfileError(f"No {kind} profile named {name!r} in vendor {vendor!r}")
    return json.loads((profile_root() / vendor / sub).read_text(encoding="utf-8"))


def resolve(vendor: str, kind: str, name: str, _seen: tuple[str, ...] = ()) -> dict:
    """Flatten a profile and everything it inherits into a single dict.

    Child keys win over parent keys. ``inherits`` and ``from`` are dropped from
    the result — they describe the lookup, not the printer.
    """
    if name in _seen:
        raise ProfileError(f"Circular inherits chain: {' -> '.join((*_seen, name))}")

    raw = _load_raw(vendor, kind, name)
    parent_name = raw.get("inherits")
    merged = resolve(vendor, kind, parent_name, (*_seen, name)) if parent_name else {}
    merged.update(raw)
    merged.pop("inherits", None)
    merged.pop("from", None)
    return merged


def _parse_point(text: str) -> tuple[float, float]:
    x, _, y = text.partition("x")
    return float(x), float(y)


@dataclass(frozen=True)
class Printer:
    """Everything the pipeline needs to know about the target machine."""

    name: str                       # profile name, e.g. "Bambu Lab P1S 0.4 nozzle"
    model: str                      # e.g. "Bambu Lab P1S"
    bed_mm: tuple[float, float]     # usable X, Y
    height_mm: float
    nozzle_mm: float
    bed_type: str
    exclude_areas: list[list[tuple[float, float]]] = field(default_factory=list)
    settings: dict = field(default_factory=dict, repr=False)

    @property
    def bed_centre(self) -> tuple[float, float]:
        return self.bed_mm[0] / 2.0, self.bed_mm[1] / 2.0

    def fits(self, size_mm) -> bool:
        x, y, z = size_mm
        return x <= self.bed_mm[0] and y <= self.bed_mm[1] and z <= self.height_mm


def load_printer(name: str, vendor: str = DEFAULT_VENDOR) -> Printer:
    """Build a Printer from a machine profile name, resolving its inherits chain."""
    s = resolve(vendor, "machine", name)

    area = [_parse_point(p) for p in s["printable_area"]]
    xs = [p[0] for p in area]
    ys = [p[1] for p in area]

    nozzles = s.get("nozzle_diameter") or ["0.4"]
    exclude = s.get("bed_exclude_area") or []

    model = s.get("printer_model") or _model_from_name(name)
    return Printer(
        name=name,
        model=model,
        bed_mm=(max(xs) - min(xs), max(ys) - min(ys)),
        height_mm=float(s["printable_height"]),
        nozzle_mm=float(nozzles[0]),
        bed_type=s.get("default_bed_type") or _model_default_bed(vendor, model),
        exclude_areas=[[_parse_point(p) for p in exclude]] if exclude else [],
        settings=s,
    )


def _model_from_name(profile_name: str) -> str:
    return re.sub(r"\s+[\d.]+\s*nozzle$", "", profile_name).strip()


def _model_default_bed(vendor: str, model: str) -> str:
    try:
        return resolve(vendor, "machine_model", model).get("default_bed_type", "")
    except ProfileError:
        return ""


def list_printers(vendor: str = DEFAULT_VENDOR) -> list[str]:
    """User-selectable machine profiles — the concrete ones, not the common bases."""
    names = _sub_paths(vendor, "machine")
    return sorted(n for n in names if "common" not in n and "nozzle" in n)


def list_models(vendor: str = DEFAULT_VENDOR) -> list[str]:
    return sorted(_sub_paths(vendor, "machine_model"))


# --- process and filament selection -------------------------------------------------
#
# A process or filament profile declares which machines it suits via
# ``compatible_printers``. Bambu's P1S, for instance, shares the X1C process
# profiles, so matching on the name would pick the wrong file (or none).

def _compatible(vendor: str, kind: str, printer_profile: str) -> list[str]:
    out = []
    for name in _sub_paths(vendor, kind):
        if "common" in name:
            continue
        try:
            resolved = resolve(vendor, kind, name)
        except (ProfileError, json.JSONDecodeError, OSError):
            continue
        if printer_profile in (resolved.get("compatible_printers") or []):
            out.append(name)
    return sorted(out)


@lru_cache(maxsize=32)
def processes_for(printer_profile: str, vendor: str = DEFAULT_VENDOR) -> list[str]:
    return _compatible(vendor, "process", printer_profile)


@lru_cache(maxsize=32)
def filaments_for(printer_profile: str, vendor: str = DEFAULT_VENDOR) -> list[str]:
    return _compatible(vendor, "filament", printer_profile)


def default_process(printer_profile: str, vendor: str = DEFAULT_VENDOR) -> str:
    """The sane default: 0.20mm Standard. Never expose this choice to the user (spec §3)."""
    options = processes_for(printer_profile, vendor)
    for want in ("0.20mm Standard", "0.20mm"):
        for name in options:
            if name.startswith(want):
                return name
    if not options:
        raise ProfileError(f"No process profile is compatible with {printer_profile!r}")
    return options[0]


def default_filament(printer_profile: str, material: str = "PLA",
                     vendor: str = DEFAULT_VENDOR) -> str:
    options = filaments_for(printer_profile, vendor)
    preferred = [
        f"Bambu {material} Basic",
        f"Bambu {material}",
        f"Generic {material}",
    ]
    for want in preferred:
        for name in options:
            if name.startswith(want):
                return name
    if not options:
        raise ProfileError(f"No filament profile is compatible with {printer_profile!r}")
    return options[0]


# Keys that describe how a profile was looked up, not what it configures.
# They must not survive into a merged project settings blob.
_BOOKKEEPING = {
    "type", "setting_id", "instantiation", "compatible_printers",
    "compatible_printers_condition", "compatible_prints",
    "compatible_prints_condition", "renamed_from", "description",
}


# Supports are on by default, set to automatic. Bambu's stock profiles ship with
# enable_support = "0", which means an overhanging model silently prints into
# thin air -- the single most likely way a first print fails for someone who
# cannot inspect a preview. "tree(auto)" rather than "normal(auto)" because the
# target models are sculpted busts and figurines: tree supports scar the surface
# far less and come off by hand. Both are *auto*, so a model that needs no
# support still gets none.
SUPPORT_DEFAULTS = {
    "enable_support": "1",
    "support_type": "tree(auto)",
    "support_threshold_angle": "30",
    "support_on_build_plate_only": "0",
}


def project_settings(printer: Printer, process: str, filament: str,
                     vendor: str = DEFAULT_VENDOR, *,
                     supports: bool = True) -> dict:
    """Flatten machine + process + filament into the blob a project 3mf carries.

    Bambu Studio writes ``Metadata/project_settings.config`` as one flat JSON
    object of every resolved setting, with ``*_settings_id`` naming the profiles
    it came from. Filament settings are per-extruder and so are list-valued.
    """
    proc = resolve(vendor, "process", process)
    fil = resolve(vendor, "filament", filament)

    # Lowest priority first: compiled-in slicer defaults, then the resolved
    # profiles, then our own overrides.
    merged: dict = dict(baseline_settings())
    for source in (proc, fil, printer.settings):
        merged.update({k: v for k, v in source.items() if k not in _BOOKKEEPING})

    merged.pop("name", None)

    overrides = dict(SUPPORT_DEFAULTS) if supports else {}
    changed = sorted(k for k, v in overrides.items() if merged.get(k) != v)
    merged.update(overrides)

    merged.update({
        "from": "project",
        "name": "project_settings",
        "print_settings_id": process,
        "printer_settings_id": printer.name,
        "filament_settings_id": [filament],
        "curr_bed_type": printer.bed_type,
        "version": CLIENT_VERSION,
        # Per-extruder identity Bambu Studio always writes. filament_id comes
        # from the filament profile; the colour is only a swatch in the UI, and
        # §6.4 lets the user pick a real one from their own spool list later.
        "filament_ids": [fil.get("filament_id", "")],
        "filament_colour": ["#00AE42"],
        "default_filament_colour": [""],
        "different_settings_to_system": _override_manifest(changed, filaments=1),
    })
    return merged


def _override_manifest(changed_process_keys, *, filaments: int) -> list:
    """Declare which settings deviate from the named system profiles.

    Bambu Studio does not simply trust the values in project_settings.config.
    It reloads each named system profile and re-applies only the keys listed
    here, so an override that is not declared is silently reverted -- which is
    exactly what happened to enable_support: the file said "1", Bambu Studio
    showed supports off.

    The list is positional: [print settings, one slot per filament, printer].
    Observed across the corpus as len(filament_settings_id) + 2 entries.
    """
    return [";".join(changed_process_keys)] + [""] * (filaments + 1)
