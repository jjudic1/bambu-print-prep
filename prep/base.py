"""Give the model a flat bottom to stand on.

Spec §1 lists "does it need a cut, a flat base, a pin?" as part of the judgement
gap, and it is the most common thing wrong with a generated bust or figurine:
the model is sculpted resting on a curve, so it touches the plate at a point and
either topples or prints its first layers into thin air.

The cut is deliberately the *smallest* one that produces a real footprint. Taking
more than necessary throws away the bottom of somebody's model, which is not a
decision this tool gets to make casually -- so there is a hard ceiling on how
much height it will remove, and it reports exactly how much it took.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import trimesh

from .orient import ADEQUATE_CONTACT_FRACTION, MIN_CONTACT_MM2, _contact_area

# Never remove more than this share of the model's height. A bust that needs a
# deeper cut than this is a model the user should look at, not one we silently
# amputate.
MAX_CUT_FRACTION = 0.08

# Candidate cut heights tested between the base and that ceiling.
CUT_SAMPLES = 14

# If the best cut within the ceiling still cannot reach an adequate footprint,
# take it anyway only when it is at least this much better than doing nothing.
WORTHWHILE_GAIN = 3.0


@dataclass
class FlattenResult:
    cut: bool
    removed_mm: float
    contact_before_mm2: float
    contact_after_mm2: float
    adequate: bool                 # did we reach a real footprint?
    note: str | None               # plain language, or None if nothing was done


def adequate_contact(mesh) -> float:
    """How much bed contact this model's footprint deserves."""
    size = mesh.extents
    footprint = float(size[0] * size[1])
    return max(footprint * ADEQUATE_CONTACT_FRACTION, MIN_CONTACT_MM2)


def _section_area(mesh, z: float) -> float:
    """Area of the horizontal cross-section at height z -- the cap a cut would make."""
    section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if section is None:
        return 0.0
    try:
        planar, _ = section.to_2D()
        return float(abs(planar.area))
    except ValueError:
        return 0.0


def _cut(mesh, z: float):
    """Slice everything below z away and cap the opening."""
    sliced = mesh.slice_plane(plane_origin=[0, 0, z], plane_normal=[0, 0, 1], cap=True)
    if sliced is None or sliced.is_empty or len(sliced.faces) == 0:
        return None
    return sliced


def flatten_base(mesh, *, max_fraction: float = MAX_CUT_FRACTION,
                 samples: int = CUT_SAMPLES, proxy=None):
    """Cut a flat base if the model needs one. Returns (mesh, FlattenResult).

    ``mesh`` must already be in its final orientation, sitting with its lowest
    point at the bottom -- "flat" only means anything once we know which way is
    down.
    """
    target = adequate_contact(mesh)
    before = _contact_area(mesh)

    if before >= target:
        return mesh, FlattenResult(False, 0.0, before, before, True, None)

    search = proxy if proxy is not None else mesh
    z_min = float(mesh.bounds[0][2])
    height = float(mesh.extents[2])
    if height <= 0:
        return mesh, FlattenResult(False, 0.0, before, before, False, None)

    ceiling = z_min + height * max_fraction

    # Walk up from the base and stop at the first height that gives a real
    # footprint. Searching upward rather than optimising means we never remove
    # more than we have to.
    best_z = None
    for z in np.linspace(z_min + height * 0.002, ceiling, samples):
        if _section_area(search, float(z)) >= target:
            best_z = float(z)
            break

    reached = best_z is not None
    if best_z is None:
        # Nothing within the ceiling is adequate. Take the largest section
        # available, but only if it is a real improvement on doing nothing.
        areas = [(float(z), _section_area(search, float(z)))
                 for z in np.linspace(z_min + height * 0.002, ceiling, samples)]
        z, area = max(areas, key=lambda pair: pair[1])
        if area < max(before, 1e-9) * WORTHWHILE_GAIN:
            return mesh, FlattenResult(False, 0.0, before, before, False, None)
        best_z = z

    cut_mesh = _cut(mesh, best_z)
    if cut_mesh is None:
        return mesh, FlattenResult(False, 0.0, before, before, False, None)

    cut_mesh.apply_translation([0, 0, -float(cut_mesh.bounds[0][2])])
    after = _contact_area(cut_mesh)

    # A cut that did not actually help is not worth the geometry it destroyed.
    if after <= before:
        return mesh, FlattenResult(False, 0.0, before, before, False, None)

    removed = best_z - z_min
    return cut_mesh, FlattenResult(
        cut=True,
        removed_mm=removed,
        contact_before_mm2=before,
        contact_after_mm2=after,
        adequate=reached,
        note=_describe(removed, reached),
    )


def _describe(removed_mm: float, adequate: bool) -> str:
    """Say what was done, without the word 'mesh' (spec §6 copy rules)."""
    amount = f"{removed_mm:.1f} mm" if removed_mm >= 0.1 else "a sliver"
    if adequate:
        return f"levelled the bottom, taking off {amount}, so it stands flat on the plate"
    return (f"levelled the bottom as far as I sensibly could, taking off {amount} - "
            "it may still need a brim to hold")
