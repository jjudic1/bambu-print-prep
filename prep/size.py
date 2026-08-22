"""How big should this be?

Spec §5.4 and §6.2. The geometry here is trivial -- one scale factor. The work
is making the choice describable without numbers: the user picks against a
familiar object and a few named intents, and mm appear only as secondary text.

This module owns the two hard edges §6.2 asks for: the slider cannot exceed the
build volume, and shrinking must warn *at the moment* a wall drops below what
the nozzle can lay down.
"""

from __future__ import annotations

from dataclasses import dataclass

from .analyze import MeshReport
from .profiles import Printer

# Familiar objects, longest dimension in millimetres, for the side-by-side
# comparison in §6.2. Deliberately things people own, not printing references.
REFERENCES = {
    "credit card": 85.6,
    "coffee mug": 95.0,
    "adult hand": 190.0,
    "sheet of paper": 297.0,
}

# Named intents from §6.2's snap points, as a target for the longest dimension.
INTENTS = {
    "keychain": 35.0,
    "desk size": 100.0,
    "as big as it'll print": None,      # resolved against the printer
}

# A wall must be at least this many nozzle widths to survive handling. Two
# perimeters is the practical floor -- one is fragile, and slicers often drop it.
MIN_WALL_NOZZLES = 2.0


@dataclass
class SizeChoice:
    scale: float
    size_mm: tuple
    longest_mm: float
    fits: bool
    min_wall_mm: float | None
    too_thin: bool
    warning: str | None            # plain language, or None
    comparison: str                # "about as tall as a coffee mug"


def _longest(size) -> float:
    return float(max(size))


def scale_for_longest(current_size, target_longest_mm: float) -> float:
    longest = _longest(current_size)
    if longest <= 0:
        raise ValueError("model has no size")
    return target_longest_mm / longest


def max_scale(current_size, printer: Printer) -> float:
    """The largest scale that still fits the build volume, per axis."""
    x, y, z = (float(v) for v in current_size)
    if min(x, y, z) <= 0:
        raise ValueError("model has no size")
    return min(printer.bed_mm[0] / x, printer.bed_mm[1] / y, printer.height_mm / z)


def describe(size_mm) -> str:
    """Compare the model to something the user owns (§6.2)."""
    longest = _longest(size_mm)
    name, reference = min(REFERENCES.items(), key=lambda kv: abs(kv[1] - longest))
    ratio = longest / reference

    if 0.9 <= ratio <= 1.1:
        return f"about the size of a {name}"
    if ratio < 0.9:
        return f"about {_fraction(ratio)} the size of a {name}"
    return f"about {ratio:.1f} times the size of a {name}"


def _fraction(ratio: float) -> str:
    for value, word in ((0.75, "three quarters"), (0.5, "half"),
                        (0.33, "a third"), (0.25, "a quarter")):
        if ratio >= value * 0.85:
            return word
    return "a small fraction of"


def apply(mesh, report: MeshReport, printer: Printer, *,
          target_longest_mm: float | None = None,
          intent: str | None = None,
          scale: float | None = None) -> SizeChoice:
    """Work out the scale and everything the UI needs to say about it.

    Exactly one of ``target_longest_mm``, ``intent`` or ``scale`` should be
    given. Nothing is mutated -- callers apply the scale when the user confirms,
    which is also what keeps §10's "debounce, only slice on confirm" honest.
    """
    current = tuple(float(v) for v in mesh.extents)
    ceiling = max_scale(current, printer)

    if intent is not None:
        if intent not in INTENTS:
            raise ValueError(f"unknown intent {intent!r}")
        target = INTENTS[intent]
        chosen = ceiling if target is None else scale_for_longest(current, target)
    elif target_longest_mm is not None:
        chosen = scale_for_longest(current, target_longest_mm)
    elif scale is not None:
        chosen = scale
    else:
        chosen = 1.0

    # §6.2: the slider physically cannot exceed the build volume.
    clamped = min(chosen, ceiling)
    hit_ceiling = clamped < chosen - 1e-9

    size = tuple(v * clamped for v in current)
    min_wall = report.min_wall_mm * clamped if report.min_wall_mm is not None else None
    floor = printer.nozzle_mm * MIN_WALL_NOZZLES
    too_thin = min_wall is not None and min_wall < floor

    warning = None
    if too_thin:
        warning = ("At this size the thinnest parts get too fine to print — "
                   "they'd come out fragile or not at all.")
    elif hit_ceiling:
        warning = "This is as big as your printer can make it."

    return SizeChoice(
        scale=clamped,
        size_mm=size,
        longest_mm=_longest(size),
        fits=printer.fits(size),
        min_wall_mm=min_wall,
        too_thin=too_thin,
        warning=warning,
        comparison=describe(size),
    )


def smallest_safe_scale(report: MeshReport, printer: Printer) -> float | None:
    """The scale below which walls stop being printable.

    §6.2 wants the warning at the moment it happens, which means knowing the
    threshold rather than discovering it after the fact.
    """
    if not report.min_wall_mm:
        return None
    return (printer.nozzle_mm * MIN_WALL_NOZZLES) / report.min_wall_mm
