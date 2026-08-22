"""Does the orientation solver make sane calls on shapes with obvious answers?"""
import time
from pathlib import Path

import numpy as np
import trimesh

from prep.orient import solve

MODELS = Path(r"C:/Program Files/OrcaSlicer/resources/handy_models")


def tall_pin():
    """A thin spire on a small base: should be laid down, not stood up."""
    base = trimesh.creation.box(extents=(30, 30, 4))
    spire = trimesh.creation.cylinder(radius=2.5, height=80)
    spire.apply_translation((0, 0, 42))
    return "tall thin spire on a base", trimesh.util.concatenate([base, spire])


def flat_plaque():
    return "flat plaque", trimesh.creation.box(extents=(80, 50, 4))


def tilted_box():
    """A box arriving rotated off-axis: should be squared back up."""
    m = trimesh.creation.box(extents=(40, 30, 20))
    m.apply_transform(trimesh.transformations.rotation_matrix(np.radians(31), (1, 0.4, 0)))
    return "box arriving at a 31 degree tilt", m


def teapot_ish():
    m = trimesh.creation.cylinder(radius=25, height=40)
    spout = trimesh.creation.cylinder(radius=5, height=40)
    spout.apply_transform(trimesh.transformations.rotation_matrix(np.radians(70), (0, 1, 0)))
    spout.apply_translation((28, 0, 8))
    return "cylinder with a jutting spout", trimesh.util.concatenate([m, spout])


cases = [tall_pin(), flat_plaque(), tilted_box(), teapot_ish()]
for name in ("Stanford_Bunny.3mf", "3DBenchy.3mf"):
    p = MODELS / name
    if p.is_file():
        cases.append((name, trimesh.load(p, force="mesh")))

for label, mesh in cases:
    t0 = time.perf_counter()
    best, alts = solve(mesh)
    dt = time.perf_counter() - t0
    print(f"\n{label}   ({dt:.2f}s, {len(mesh.faces)} tris)")
    print(f"  original size {[round(v,1) for v in mesh.extents]} mm")
    print(f"  chosen  size  {[round(v,1) for v in best.size_mm]} mm   height {best.height_mm:.1f}")
    print(f"    down {tuple(round(v,2) for v in best.down)}  score {best.score:.3f}")
    print(f"    contact {best.contact_mm2:.0f} mm2  support {best.support_index:.0f}  "
          f"detail-down {best.detail_down:.1%}  stress {best.stress_index and round(best.stress_index,1)}")
    parts = " ".join(f"{k}={v:.2f}" for k, v in best.sub_scores.items() if v is not None)
    print(f"    sub-scores: {parts}")
    print(f"    \"{best.reason}\"")
    for a in alts:
        print(f"  alt: height {a.height_mm:6.1f}  contact {a.contact_mm2:7.0f}  "
              f"support {a.support_index:9.0f}  score {a.score:.3f}")
