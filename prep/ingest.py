"""Bring a mesh in from a file, and work out what scale it is actually in.

Spec §5.1. AI generators and scanners disagree wildly about units -- a mesh may
arrive 0.08 units tall (metres), 2400 (a scan in millimetres), or unitless. We
guess, and §5.2 says never to confirm that guess with a number: the UI shows the
model beside a familiar object instead.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh

SUPPORTED = {".stl", ".obj", ".3mf", ".glb", ".gltf", ".ply"}

MAX_BYTES = 200 * 1024 * 1024     # §5.1
MAX_TRIANGLES = 5_000_000

# What an oversized model gets decimated to when the user accepts the offer.
# A 0.4 mm nozzle cannot resolve anything finer than this on a hand-sized print,
# so the detail being discarded was never going to survive the slicer anyway.
SIMPLIFY_TARGET_FACES = 500_000

# Printed objects live in a fairly narrow band. These bracket "plausible in mm"
# and drive the unit guess.
PLAUSIBLE_MM = (5.0, 400.0)


class IngestError(ValueError):
    """The file cannot be used, phrased for a person (spec §6 copy rules)."""


class TooLarge(IngestError):
    """Over the size ceiling. Callers should offer decimation, not an error."""

    def __init__(self, message, triangles=None, bytes_=None):
        super().__init__(message)
        self.triangles = triangles
        self.bytes = bytes_


@dataclass
class Ingested:
    mesh: trimesh.Trimesh
    source_name: str
    unit_guess: str                  # "mm" | "m" | "cm" | "inch" | "unknown"
    scale_applied: float             # what we multiplied by to reach millimetres
    native_extents_mm: tuple         # extents after that scaling
    shell_count: int
    simplified_from: int | None = None   # original triangle count, if decimated


def _largest_dimension(mesh) -> float:
    return float(max(mesh.extents))


def guess_units(mesh) -> tuple[str, float]:
    """Guess the mesh's units and return (name, factor-to-millimetres).

    Purely a heuristic on overall size: nothing in an STL says what a unit means.
    Ordered from most to least confident, and biased towards leaving a plausible
    mesh alone -- wrongly scaling a correct model is worse than not scaling.
    """
    largest = _largest_dimension(mesh)
    low, high = PLAUSIBLE_MM

    if largest <= 0:
        return "unknown", 1.0
    if low <= largest <= high:
        return "mm", 1.0
    if largest < 0.5:
        return "m", 1000.0            # 0.08 units tall is a metre-scale export
    if largest < low:
        return "cm", 10.0             # a few units tall is likelier centimetres
    if largest <= high * 25.4 / 10:
        return "inch", 25.4           # plausible once read as inches
    return "unknown", 1.0             # very large: probably mm from a scan


def load(path, *, assume_units: str | None = None,
         simplify: bool = False) -> Ingested:
    """Load a mesh file and normalise it to millimetres at the origin.

    ``assume_units`` overrides the guess, for when the user has told us.
    ``simplify`` accepts the decimation offer §5.1 makes for oversized files --
    without it, a model over the ceiling raises TooLarge rather than being
    silently reduced.
    """
    path = Path(path)
    if not path.is_file():
        raise IngestError(f"I can't find {path.name}.")

    if path.suffix.lower() not in SUPPORTED:
        supported = ", ".join(sorted(s.lstrip(".") for s in SUPPORTED))
        raise IngestError(
            f"I can't read {path.suffix or 'that kind of'} files. Try one of: {supported}."
        )

    size = path.stat().st_size
    if size > MAX_BYTES and not simplify:
        raise TooLarge(
            f"{path.name} is {size / 1e6:.0f} MB, which is too big to work with. "
            "I can simplify it first if you want.",
            bytes_=size,
        )

    try:
        loaded = trimesh.load(path, force="mesh")
    except Exception as exc:                       # trimesh raises many types
        raise IngestError(f"I couldn't open {path.name} -- it may be damaged.") from exc

    if not isinstance(loaded, trimesh.Trimesh) or loaded.is_empty:
        raise IngestError(f"There's no 3D shape inside {path.name}.")

    original_faces = len(loaded.faces)
    if original_faces > MAX_TRIANGLES and simplify:
        loaded = loaded.simplify_quadric_decimation(face_count=SIMPLIFY_TARGET_FACES)
    elif original_faces > MAX_TRIANGLES:
        raise TooLarge(
            f"{path.name} has {len(loaded.faces) / 1e6:.1f} million triangles, which is "
            "more detail than a printer can use. I can simplify it first.",
            triangles=len(loaded.faces),
        )

    shells = _count_shells(loaded)

    if assume_units:
        unit, factor = assume_units, _FACTORS[assume_units]
    else:
        unit, factor = guess_units(loaded)

    if factor != 1.0:
        loaded.apply_scale(factor)

    # Move to the origin so every later stage works in one frame.
    loaded.apply_translation(-loaded.bounds[0])

    return Ingested(
        mesh=loaded,
        source_name=path.name,
        unit_guess=unit,
        scale_applied=factor,
        native_extents_mm=tuple(float(v) for v in loaded.extents),
        shell_count=shells,
        simplified_from=original_faces if len(loaded.faces) < original_faces else None,
    )


_FACTORS = {"mm": 1.0, "cm": 10.0, "m": 1000.0, "inch": 25.4, "unknown": 1.0}


def _count_shells(mesh) -> int:
    """Disconnected pieces. Cheap here, and §5.3 needs it to drop stray fragments."""
    try:
        return int(mesh.body_count)
    except Exception:
        return 1
