"""The orientation solver.

§10 calls this the moat and the failure mode. These tests pin the properties
that made it stop being wrong, each of which was a real regression:

- contact area is a threshold, not a gradient (a 3DBenchy balanced on 43 mm2)
- scores are absolute, not min-max normalised across candidates
- an already-correct pose is left alone unless beating it is clearly worth it
"""

import numpy as np
import pytest
import trimesh

from prep import orient
from prep.orient import angle_between_directions, candidate_directions, solve

DOWN = (0.0, 0.0, -1.0)


def down_angle(candidate) -> float:
    return angle_between_directions(candidate.down, DOWN)


@pytest.fixture
def plaque():
    """Obvious answer: a thin slab lies flat."""
    return trimesh.creation.box(extents=(80, 50, 4))


@pytest.fixture
def lollipop():
    """A heavy head on a thin stick -- the classic snap risk."""
    stick = trimesh.creation.cylinder(radius=2.0, height=60)
    head = trimesh.creation.icosphere(radius=15)
    head.apply_translation((0, 0, 42))
    return trimesh.util.concatenate([stick, head])


def test_candidate_directions_include_the_axes(plaque):
    directions = candidate_directions(plaque)
    for axis in [(0, 0, -1), (0, 0, 1), (0, -1, 0), (1, 0, 0)]:
        assert any(angle_between_directions(d, axis) < 1e-6 for d in directions)


def test_candidate_directions_are_deduplicated():
    sphere = trimesh.creation.icosphere(subdivisions=3, radius=10)
    directions = candidate_directions(sphere)
    for i, a in enumerate(directions):
        for b in directions[i + 1:]:
            assert angle_between_directions(a, b) > orient.DIRECTION_TOLERANCE_DEG - 1e-6


def test_flat_slab_is_laid_flat(plaque):
    best, _ = solve(plaque)
    assert best.height_mm == pytest.approx(4.0, abs=0.01)


def test_a_tilted_box_is_squared_up():
    box = trimesh.creation.box(extents=(40, 30, 20))
    box.apply_transform(trimesh.transformations.rotation_matrix(np.radians(31), (1, 0.4, 0)))

    best, _ = solve(box)
    posed = box.copy()
    posed.apply_transform(best.matrix)
    assert sorted(round(v, 1) for v in posed.extents) == [20.0, 30.0, 40.0]


def test_contact_is_a_threshold_not_a_gradient():
    """Past an adequate footprint, extra area must not keep buying score.

    Scoring contact linearly let a pose resting on 43 mm2 outrank the one a
    3DBenchy is designed for, because its small advantages elsewhere added up.
    """
    generous = _candidate(contact_mm2=5000.0, size=(50, 50, 20))
    adequate = _candidate(contact_mm2=250.0, size=(50, 50, 20))
    poor = _candidate(contact_mm2=20.0, size=(50, 50, 20))

    assert orient._sub_scores(generous)["contact"] == 1.0
    assert orient._sub_scores(adequate)["contact"] == 1.0
    assert orient._sub_scores(poor)["contact"] < 0.2


def test_scores_do_not_depend_on_the_rest_of_the_candidate_set():
    """Absolute scoring: a pose's score is a property of that pose alone.

    Under min-max normalisation the same pose scored differently depending on
    what it was compared against, which is how noise beat signal.
    """
    candidate = _candidate(contact_mm2=800.0, size=(40, 40, 20))
    first = orient._sub_scores(candidate)

    others = [_candidate(contact_mm2=v, size=(40, 40, 20)) for v in (1.0, 10.0, 90000.0)]
    for other in others:
        orient._sub_scores(other)

    assert orient._sub_scores(candidate) == first


def test_an_already_correct_model_is_left_alone():
    """A slab authored lying flat must come back unrotated, not flipped."""
    slab = trimesh.creation.box(extents=(60, 40, 5))
    best, _ = solve(slab)
    assert down_angle(best) < orient.DIRECTION_TOLERANCE_DEG


def test_author_bias_requires_a_real_margin(monkeypatch):
    """With no bias the solver may re-pose on a hairline; with it, it must not."""
    a = _candidate(contact_mm2=500.0, size=(40, 40, 20))
    a.down, a.score = (0.0, 0.0, -1.0), 0.700
    b = _candidate(contact_mm2=500.0, size=(40, 40, 20))
    b.down, b.score = (0.0, -1.0, 0.0), 0.704

    monkeypatch.setattr(orient, "AUTHOR_BIAS", 0.08)
    assert orient._prefer_as_authored([b, a]) is a       # hairline: keep as authored

    monkeypatch.setattr(orient, "AUTHOR_BIAS", 0.0)
    assert orient._prefer_as_authored([b, a]) is b       # no bias: take the winner


def test_a_clearly_better_pose_still_wins(monkeypatch):
    a = _candidate(contact_mm2=500.0, size=(40, 40, 20))
    a.down, a.score = (0.0, 0.0, -1.0), 0.40
    b = _candidate(contact_mm2=500.0, size=(40, 40, 20))
    b.down, b.score = (0.0, -1.0, 0.0), 0.90

    monkeypatch.setattr(orient, "AUTHOR_BIAS", 0.08)
    assert orient._prefer_as_authored([b, a]) is b


def test_stress_index_flags_a_thin_neck(lollipop):
    """A heavy head on a thin stick must score worse standing than lying down."""
    upright = lollipop.copy()
    lying = lollipop.copy()
    lying.apply_transform(trimesh.transformations.rotation_matrix(np.radians(90), (1, 0, 0)))

    assert orient._stress_index(upright) > orient._stress_index(lying)


def test_alternates_are_distinct_from_the_winner(plaque):
    best, alternates = solve(plaque, alternates=2)
    for alternate in alternates:
        assert not orient._alike(best, alternate)


def test_winner_always_carries_a_reason(plaque):
    best, _ = solve(plaque)
    assert best.reason
    assert best.reason[0].isupper() and best.reason.endswith(".")


@pytest.mark.parametrize("word", ["manifold", "mesh", "normals", "infill",
                                  "gcode", "slice", "topology", "brim"])
def test_reasons_contain_no_jargon(plaque, lollipop, word):
    """Spec §6 copy rules, enforced rather than hoped for."""
    for model in (plaque, lollipop):
        best, alternates = solve(model)
        for candidate in (best, *alternates):
            assert word not in candidate.reason.lower()


def _candidate(*, contact_mm2, size):
    return orient.Candidate(
        matrix=np.eye(4), down=DOWN, contact_mm2=contact_mm2,
        support_index=100.0, detail_down=0.1, height_mm=float(size[2]),
        size_mm=tuple(float(v) for v in size), volume_mm3=10000.0,
        stress_index=5.0, score=0.0)
