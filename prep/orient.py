"""Which way up should this print?

Spec §5.5. This is the product's judgement, and §10 is blunt that it is both the
moat and the way the whole thing becomes worse than nothing. So: score honestly,
explain the choice in one sentence, and never pretend to more confidence than the
geometry supports.

Candidates are the convex hull's faces (every way an object can physically rest)
plus the six axis-aligned poses, which are what a human would try first and are
often right for anything modelled rather than sculpted.

Scoring runs in two stages because the useful signals are not equally cheap:
area, support and height are vectorised and run over every candidate; the
cross-section stress test needs real slicing and only runs on the finalists.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field

import numpy as np
import trimesh

# Two candidate directions closer than this are the same resting pose.
DIRECTION_TOLERANCE_DEG = 8.0

# A face is "on the plate" within this distance of the lowest point.
CONTACT_TOLERANCE_MM = 0.35

# Overhang threshold, matching analyze.OVERHANG_DEGREES.
OVERHANG_DEGREES = 45.0

# How many candidates survive stage one and get the expensive treatment.
FINALISTS = 5

# Cross-sections taken up the model to find its weakest layer.
SECTION_SAMPLES = 16

# Every score here is statistical -- areas, ratios, section areas. None of them
# need a quarter-million triangles, and scoring ~30 candidates on the full mesh
# took 40s on a 3DBenchy. Score a decimated proxy instead.
PROXY_FACES = 25_000

# What counts as a solid footprint: a tenth of the model's shadow, but never
# less than this in absolute terms. A print resting on less than roughly a
# 7 mm square is a print that comes loose.
ADEQUATE_CONTACT_FRACTION = 0.10
MIN_CONTACT_MM2 = 50.0

# How much better than the as-authored pose an alternative must be before we
# rotate the model at all. Most files arrive already oriented -- their creator
# thought about it -- so a solver that re-poses on a hairline margin does more
# harm than good. Benchmarked in bench/orient_bench.py; see AUTHOR_BIAS notes.
AUTHOR_BIAS = float(os.environ.get("PREP_AUTHOR_BIAS", "0.08"))

WEIGHTS = {
    "contact": 0.30,       # bed adhesion -- the most common cause of a failed print
    "support": 0.30,       # support volume, which is waste, scarring and time
    "detail": 0.15,        # keep detail-dense surfaces off the support interface
    "height": 0.10,        # fewer layers, fewer chances to fail
    "stress": 0.15,        # a thin neck printed vertically snaps along the layers
}


@dataclass
class Candidate:
    """One way up, with the numbers behind its score."""

    matrix: np.ndarray = field(repr=False)
    down: tuple                    # the direction that ends up facing the plate
    contact_mm2: float
    support_index: float           # proxy volume of support material, mm3-ish
    detail_down: float             # share of detail-dense area facing down
    height_mm: float
    size_mm: tuple
    volume_mm3: float
    stress_index: float | None     # None until the finalist stage
    score: float
    reason: str = ""
    sub_scores: dict = field(default_factory=dict)


def _rotation_bringing_down(direction) -> np.ndarray:
    """Rotate so ``direction`` ends up pointing at the plate (-Z)."""
    d = np.asarray(direction, dtype=float)
    d /= np.linalg.norm(d)
    target = np.array([0.0, 0.0, -1.0])

    if np.allclose(d, target):
        return np.eye(4)
    if np.allclose(d, -target):
        return trimesh.transformations.rotation_matrix(math.pi, (1.0, 0.0, 0.0))

    axis = np.cross(d, target)
    angle = math.acos(float(np.clip(np.dot(d, target), -1.0, 1.0)))
    return trimesh.transformations.rotation_matrix(angle, axis)


def _align_yaw(mesh) -> np.ndarray:
    """Spin the model about Z so its footprint is as small as possible.

    Bringing a face down leaves the rotation about Z free, and the arbitrary
    axis that falls out of the cross product can leave a 40x30 box sprawling
    across 50x49 of plate. That wastes bed, changes whether the model fits at
    all, and makes two candidates for the *same* face score differently.
    """
    points = np.asarray(mesh.vertices, dtype=float)[:, :2]
    if len(points) < 3:
        return np.eye(4)

    try:
        to_2d, _extents = trimesh.bounds.oriented_bounds_2D(points)
    except Exception:
        return np.eye(4)                 # degenerate footprint: leave it alone

    angle = math.atan2(to_2d[1, 0], to_2d[0, 0])
    return trimesh.transformations.rotation_matrix(angle, (0.0, 0.0, 1.0))


def candidate_directions(mesh, tolerance_deg: float = DIRECTION_TOLERANCE_DEG):
    """Every direction the object could plausibly rest on, largest facet first.

    Convex hull faces are the physically stable poses. Axis-aligned directions
    are added because modelled parts are usually authored square to an axis, and
    a hull facet a fraction of a degree off would print visibly skewed.
    """
    axis_aligned = [(0, 0, -1), (0, 0, 1), (0, -1, 0), (0, 1, 0), (-1, 0, 0), (1, 0, 0)]

    hull = mesh.convex_hull
    order = np.argsort(-hull.area_faces)
    hull_dirs = [(tuple(hull.face_normals[i]), float(hull.area_faces[i])) for i in order]

    chosen: list[tuple] = []
    weights: list[float] = []
    limit = math.cos(math.radians(tolerance_deg))

    for direction, area in [*((d, float("inf")) for d in axis_aligned), *hull_dirs]:
        vector = np.asarray(direction, dtype=float)
        norm = np.linalg.norm(vector)
        if norm == 0:
            continue
        vector /= norm
        if any(float(np.dot(vector, np.asarray(c))) > limit for c in chosen):
            continue
        chosen.append(tuple(vector))
        weights.append(area)

    return chosen


def _contact_area(mesh) -> float:
    z_min = mesh.bounds[0][2]
    face_z = mesh.vertices[mesh.faces][:, :, 2]
    on_plate = (np.abs(face_z - z_min) < CONTACT_TOLERANCE_MM).all(axis=1)
    downward = mesh.face_normals[:, 2] < -0.9
    return float(mesh.area_faces[on_plate & downward].sum())


def _support_index(mesh) -> float:
    """Proxy for how much support material this pose needs.

    Each overhanging face needs roughly a column of support beneath it, so its
    area times its height above the plate approximates that volume. It ignores
    self-sheltering, which makes it an overestimate -- but consistently so, and
    we only ever compare candidates against each other.
    """
    limit = -math.cos(math.radians(90.0 - OVERHANG_DEGREES))
    steep = mesh.face_normals[:, 2] < limit
    if not steep.any():
        return 0.0

    z_min = mesh.bounds[0][2]
    centroid_z = mesh.triangles_center[steep][:, 2] - z_min
    # Horizontal footprint of each face, which is what a support column supports.
    footprint = mesh.area_faces[steep] * np.abs(mesh.face_normals[steep][:, 2])
    return float((footprint * centroid_z).sum())


def _detail_downward(mesh) -> float:
    """Share of *detail-dense* area pointing at the plate.

    Detail density is triangles per unit area: a sculpted face is finely
    tessellated, a flat back is two triangles. §5.5 wants the detailed side kept
    off the supports, and this is a cheap stand-in for curvature.
    """
    areas = mesh.area_faces
    total = areas.sum()
    if total <= 0:
        return 0.0

    # Small faces are detailed faces. Weight each face by how far below the
    # median its area sits, so a uniformly tessellated model scores flat.
    median = np.median(areas)
    if median <= 0:
        return 0.0
    detail = np.clip(1.0 - areas / (median * 2.0), 0.0, 1.0)

    limit = -math.cos(math.radians(90.0 - OVERHANG_DEGREES))
    downward = mesh.face_normals[:, 2] < limit
    weighted = detail * areas
    if weighted.sum() <= 0:
        return 0.0
    return float(weighted[downward].sum() / weighted.sum())


def _stress_index(mesh, samples: int = SECTION_SAMPLES) -> float:
    """Find the weakest layer: least cross-section carrying the most above it.

    A figurine's ankles printed vertically are a classic snap. We slice the
    model at intervals and look for the worst ratio of mass above a layer to the
    area of that layer -- high means a thin section holding up a lot.
    """
    z_min, z_max = mesh.bounds[0][2], mesh.bounds[1][2]
    height = z_max - z_min
    if height <= 0:
        return 0.0

    total_volume = abs(mesh.volume)
    if total_volume <= 0:
        return 0.0

    worst = 0.0
    # Skip the very bottom and top, where a vanishing section is expected.
    for fraction in np.linspace(0.1, 0.85, samples):
        z = z_min + height * fraction
        section = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        if section is None:
            continue
        # A plane can miss the mesh entirely or produce an open path; those are
        # expected. Anything else is a real failure and should not be silenced.
        try:
            planar, _ = section.to_2D()
            area = float(abs(planar.area))
        except ValueError:
            continue
        if area <= 1e-6:
            continue

        # Everything above this height has to be carried by this cross-section.
        above = total_volume * (1.0 - fraction)
        worst = max(worst, above / area)

    return worst


def _sub_scores(c: "Candidate") -> dict:
    """Turn one candidate's raw metrics into 0..1 scores, where 1 is better.

    Deliberately *absolute* rather than min-max across the candidate set.
    Min-max looks reasonable and is actively harmful here: it stretches whatever
    spread happens to exist, so when every pose is nearly equal on support it
    manufactures a large difference out of noise, and a weak signal like height
    can then outvote the two that matter. On a 3DBenchy that elected a tilted
    pose which was worse on *both* contact area and support volume.

    Each score below is a ratio against something physical -- footprint, volume,
    the model's own size -- so a mediocre pose scores mediocre on its own terms.
    """
    footprint = max(c.size_mm[0] * c.size_mm[1], 1e-9)
    span = max(sum(c.size_mm), 1e-9)

    # Contact is a threshold, not a gradient. Past a solid footprint, more area
    # buys almost nothing; below it, the print lifts off the plate or topples,
    # and no amount of virtue elsewhere makes that acceptable. Scoring it
    # linearly let a 3DBenchy balanced on 43 mm2 of hull outscore the upright
    # pose it is actually designed for.
    adequate = max(footprint * ADEQUATE_CONTACT_FRACTION, MIN_CONTACT_MM2)
    contact = min(c.contact_mm2 / adequate, 1.0)

    # support_index has units of volume, so comparing it to the model's own
    # volume asks "how much support relative to the object itself?"
    support = 1.0 / (1.0 + c.support_index / max(c.volume_mm3, 1e-9))

    detail = 1.0 - c.detail_down
    height = 1.0 - min(c.height_mm / span, 1.0)

    # stress_index is volume/area, i.e. a length; scale it by the model's height.
    if c.stress_index is None:
        stress = None
    else:
        stress = 1.0 / (1.0 + c.stress_index / max(c.height_mm, 1e-9))

    return {"contact": contact, "support": support, "detail": detail,
            "height": height, "stress": stress}


def _reason(best: Candidate, mesh) -> str:
    """One sentence, in the voice of a person standing at the printer (§5.5).

    The reason is the feature: it is what teaches the user why, and it is what
    makes an automated choice feel like advice rather than a black box.
    """
    footprint = best.size_mm[0] * best.size_mm[1]
    broad = best.contact_mm2 > footprint * 0.25

    if best.support_index <= 1e-6:
        return "Stood this way it needs no supports at all."
    if broad and best.detail_down < 0.15:
        return ("Laid on its flattest side, so it sticks to the plate and the "
                "detailed surfaces aren't printed against supports.")
    if broad:
        return "Laid on its flattest side so it sticks to the plate properly."
    if best.detail_down < 0.15:
        return "Turned so the detailed surfaces don't end up resting on supports."
    if best.height_mm < max(best.size_mm) * 0.9:
        return "Laid down rather than stood up, so there are fewer layers to go wrong."
    return "This way up needs the least support material."


def solve(mesh, *, alternates: int = 2, finalists: int = FINALISTS) -> tuple[Candidate, list]:
    """Pick an orientation. Returns the winner and up to ``alternates`` runners-up.

    §6.3 shows the winner plus at most two alternate thumbnails, and every one of
    them must remain choosable -- the user can always overrule us.
    """
    scoring_mesh = _proxy(mesh)
    directions = candidate_directions(scoring_mesh)
    if not directions:
        identity = Candidate(np.eye(4), (0, 0, -1), 0.0, 0.0, 0.0,
                             float(mesh.extents[2]), tuple(mesh.extents),
                             abs(float(mesh.volume)), None, 0.0,
                             "Left the way it came.")
        return identity, []

    volume = abs(float(scoring_mesh.volume))
    candidates = []
    for direction in directions:
        matrix = _rotation_bringing_down(direction)
        posed = scoring_mesh.copy()
        posed.apply_transform(matrix)

        yaw = _align_yaw(posed)
        matrix = yaw @ matrix
        posed.apply_transform(yaw)
        posed.apply_translation([0, 0, -posed.bounds[0][2]])

        candidates.append(Candidate(
            matrix=matrix,
            down=tuple(round(float(v), 6) for v in direction),
            contact_mm2=_contact_area(posed),
            support_index=_support_index(posed),
            detail_down=_detail_downward(posed),
            height_mm=float(posed.extents[2]),
            size_mm=tuple(float(v) for v in posed.extents),
            volume_mm3=volume,
            stress_index=None,
            score=0.0,
        ))

    _score(candidates, use_stress=False)
    candidates.sort(key=lambda c: -c.score)

    # Stage two: only the finalists pay for sectioning.
    short_list = candidates[:max(finalists, alternates + 1)]
    for candidate in short_list:
        posed = scoring_mesh.copy()
        posed.apply_transform(candidate.matrix)
        candidate.stress_index = _stress_index(posed)

    _score(short_list, use_stress=True)
    short_list.sort(key=lambda c: -c.score)

    winner = _prefer_as_authored(short_list)
    winner.reason = _reason(winner, mesh)

    runners_up = _distinct(winner, [c for c in short_list if c is not winner], alternates)
    for other in runners_up:
        other.reason = _reason(other, mesh)

    return winner, runners_up


def _prefer_as_authored(ranked):
    """Keep the model as it arrived unless rotating is clearly worth it.

    The corpus says roughly 70% of real files are already oriented correctly by
    whoever made them. Against that prior, a solver that acts on a 0.004 score
    difference mostly converts right answers into wrong ones -- measured, it
    broke about as many poses as it fixed. Requiring a real margin before
    overriding a human keeps the wins and drops most of the damage.
    """
    best = ranked[0]
    as_authored = next(
        (c for c in ranked
         if angle_between_directions(c.down, (0.0, 0.0, -1.0)) <= DIRECTION_TOLERANCE_DEG),
        None)

    if as_authored is None or as_authored is best:
        return best
    if as_authored.score >= best.score - AUTHOR_BIAS:
        return as_authored
    return best


def angle_between_directions(a, b) -> float:
    va = np.asarray(a, dtype=float)
    vb = np.asarray(b, dtype=float)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    if na < 1e-12 or nb < 1e-12:
        return 180.0
    dot = float(np.clip(np.dot(va / na, vb / nb), -1.0, 1.0))
    return float(math.degrees(math.acos(dot)))


def _proxy(mesh):
    """A cheaper stand-in for scoring. Shape is preserved; triangle count is not."""
    if len(mesh.faces) <= PROXY_FACES:
        return mesh
    # Needs fast_simplification. If it is absent we would silently score the
    # full mesh and take ~40s on a detailed model, so say so rather than crawl.
    return mesh.simplify_quadric_decimation(face_count=PROXY_FACES)


def _distinct(winner, others, limit: int):
    """Drop alternates that would look and behave identically to one already shown.

    Symmetric models produce several directions with the same pose. Offering the
    user two thumbnails of the same thing wastes the only two slots §6.3 gives us.
    """
    chosen = []
    seen = [winner]
    for candidate in others:
        if any(_alike(candidate, other) for other in seen):
            continue
        chosen.append(candidate)
        seen.append(candidate)
        if len(chosen) >= limit:
            break
    return chosen


def _alike(a, b) -> bool:
    return (math.isclose(a.height_mm, b.height_mm, rel_tol=0.02)
            and math.isclose(a.contact_mm2, b.contact_mm2, rel_tol=0.05, abs_tol=1.0)
            and math.isclose(a.support_index, b.support_index, rel_tol=0.05, abs_tol=1.0))


def _score(candidates, *, use_stress: bool):
    scored = use_stress and all(c.stress_index is not None for c in candidates)

    if scored:
        weights = dict(WEIGHTS)
    else:
        # Redistribute the stress weight rather than letting every score shrink.
        total = sum(v for k, v in WEIGHTS.items() if k != "stress")
        weights = {k: v / total for k, v in WEIGHTS.items() if k != "stress"}
        weights["stress"] = 0.0

    for candidate in candidates:
        parts = _sub_scores(candidate)
        candidate.sub_scores = parts
        candidate.score = float(sum(
            weights[key] * value
            for key, value in parts.items()
            if value is not None and weights[key]
        ))
