"""Measure the orientation solver against orientations real people chose.

Milestone 2 asks the solver to beat naive axis-aligned placement. The corpus of
downloaded project files is the evidence: each one carries a build transform its
creator settled on before printing it, which is a label almost nobody else has.

Two things are being measured, and the second matters more than it sounds:

1. **Agreement** -- how often we pick the same way up as the creator did.
2. **Harm** -- how often we *rotate a model that was already right*. Most files
   arrive already oriented, so a solver that fiddles gratuitously is worse than
   one that does nothing, and plain agreement would hide that.

Usage:
    python bench/orient_bench.py [--limit N] [--tolerance-deg 15] [--verbose]
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
import time
import zipfile
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prep.orient import solve                       # noqa: E402
from prep.write3mf import transform_from_3mf        # noqa: E402

CORPUS = os.path.expanduser("~/Downloads/*.3mf")
DOWN = np.array([0.0, 0.0, -1.0])


def creator_down(build_matrix) -> np.ndarray:
    """Which local direction the creator put against the plate.

    The build transform takes local coordinates to plate coordinates, so the
    local direction that ends up pointing down is the inverse applied to -Z.
    """
    rotation = build_matrix[:3, :3]
    # Strip scale; only the rotation says anything about orientation.
    norms = np.linalg.norm(rotation, axis=0)
    if np.any(norms < 1e-9):
        return DOWN.copy()
    rotation = rotation / norms
    local = np.linalg.inv(rotation) @ DOWN
    return local / np.linalg.norm(local)


def angle_between(a, b) -> float:
    dot = float(np.clip(np.dot(a, b), -1.0, 1.0))
    return float(np.degrees(np.arccos(dot)))


def load_case(path):
    """Return (mesh in local coordinates, creator's down direction) or None."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if "3D/3dmodel.model" not in names:
            return None
        xml = z.read("3D/3dmodel.model").decode("utf-8", "replace")

    items = re.findall(r'<item objectid="(\d+)"[^>]*transform="([^"]+)"', xml)
    if len(items) != 1:
        return None                     # multi-object plates confuse the label

    try:
        matrix = transform_from_3mf(items[0][1])
    except ValueError:
        return None

    mesh = trimesh.load(path, force="mesh")
    if not isinstance(mesh, trimesh.Trimesh) or mesh.is_empty:
        return None
    if len(mesh.faces) < 12:
        return None

    # trimesh applies the build transform on load, so undo it to get back to the
    # frame the solver would see if the raw model had been handed to us.
    rotation = matrix[:3, :3]
    norms = np.linalg.norm(rotation, axis=0)
    if np.any(norms < 1e-9):
        return None
    local = mesh.copy()
    local.apply_transform(np.linalg.inv(matrix))

    return local, creator_down(matrix)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=60)
    ap.add_argument("--tolerance-deg", type=float, default=15.0)
    ap.add_argument("--max-faces", type=int, default=400_000)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    paths = sorted(glob.glob(CORPUS))
    if not paths:
        print(f"no corpus at {CORPUS}", file=sys.stderr)
        return 2

    agree = naive_agree = 0
    harmful = helpful = 0
    already_right = 0
    tested = 0
    durations = []

    for path in paths:
        if tested >= args.limit:
            break
        try:
            case = load_case(path)
        except Exception:
            continue
        if case is None:
            continue
        mesh, truth = case
        if len(mesh.faces) > args.max_faces:
            continue

        try:
            t0 = time.perf_counter()
            best, _ = solve(mesh)
            durations.append(time.perf_counter() - t0)
        except Exception as exc:
            if args.verbose:
                print(f"  solver failed on {Path(path).name}: "
                      f"{type(exc).__name__}: {exc}")
            continue

        ours = np.asarray(best.down, dtype=float)
        ours = ours / np.linalg.norm(ours)

        ours_off = angle_between(ours, truth)
        naive_off = angle_between(DOWN, truth)

        we_match = ours_off <= args.tolerance_deg
        naive_match = naive_off <= args.tolerance_deg

        tested += 1
        agree += we_match
        naive_agree += naive_match
        already_right += naive_match

        if naive_match and not we_match:
            harmful += 1
        elif not naive_match and we_match:
            helpful += 1

        if args.verbose:
            mark = "ok " if we_match else "XX "
            print(f"  {mark} {Path(path).name[:44]:44s} "
                  f"ours {ours_off:5.1f}deg  naive {naive_off:5.1f}deg")

    if not tested:
        print("no usable cases found", file=sys.stderr)
        return 2

    print(f"\ncases: {tested}   tolerance: {args.tolerance_deg:.0f} deg   "
          f"median solve {np.median(durations):.2f}s")
    print(f"  agrees with the creator : {agree:3d}/{tested}  ({agree / tested:.0%})")
    print(f"  naive 'leave it alone'  : {naive_agree:3d}/{tested}  ({naive_agree / tested:.0%})")
    print(f"  arrived already correct : {already_right:3d}/{tested}  "
          f"({already_right / tested:.0%})")
    print(f"  we fixed a wrong pose   : {helpful:3d}")
    print(f"  we broke a right pose   : {harmful:3d}   <-- the number that matters")

    delta = agree - naive_agree
    verdict = "beats" if delta > 0 else ("ties" if delta == 0 else "LOSES TO")
    print(f"\n  => solver {verdict} naive by {delta:+d} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
