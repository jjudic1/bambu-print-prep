"""Exercise the repair ladder on deliberately broken meshes and a real bad model."""
import time
from pathlib import Path

import numpy as np
import trimesh

from prep.analyze import analyze
from prep.repair import repair

MODELS = Path(r"C:/Program Files/OrcaSlicer/resources/handy_models")


def holed():
    m = trimesh.creation.icosphere(subdivisions=3, radius=20)
    keep = np.ones(len(m.faces), bool); keep[:40] = False
    m.update_faces(keep)
    return "sphere with a hole punched in it", m


def inverted():
    m = trimesh.creation.box(extents=(20, 20, 20))
    m.invert()
    return "box turned inside out", m


def debris():
    big = trimesh.creation.box(extents=(40, 40, 40))
    speck = trimesh.creation.box(extents=(0.6, 0.6, 0.6)); speck.apply_translation((60, 0, 0))
    return "box with a floating speck", trimesh.util.concatenate([big, speck])


def duplicated():
    m = trimesh.creation.box(extents=(10, 10, 10))
    return "box with doubled geometry", trimesh.util.concatenate([m, m.copy()])


cases = [holed(), inverted(), debris(), duplicated()]
cube = MODELS / "OrcaCube_v2.3mf"
if cube.is_file():
    cases.append(("OrcaCube_v2 (2 shells, 4 bad edges)", trimesh.load(cube, force="mesh")))

for label, mesh in cases:
    t0 = time.perf_counter()
    fixed, log = repair(mesh)
    dt = time.perf_counter() - t0
    b, a = log.before, log.after
    print(f"\n{label}   ({dt:.2f}s)")
    print(f"  before: watertight {b.watertight}  holes {b.hole_count}  "
          f"bad edges {b.non_manifold_edges}  shells {b.shell_count}  "
          f"inverted {b.inverted_normals}  tris {b.triangle_count}")
    for s in log.steps:
        print(f"    - {s}")
    if not log.steps:
        print("    - (nothing to do)")
    print(f"  after:  watertight {a.watertight}  holes {a.hole_count}  "
          f"bad edges {a.non_manifold_edges}  shells {a.shell_count}  "
          f"inverted {a.inverted_normals}  tris {a.triangle_count}")
    print(f"  succeeded: {log.succeeded}"
          + (f"   reason: {log.failure_reason}" if log.failure_reason else ""))
    print(f"  volume {b.volume_mm3:.0f} -> {a.volume_mm3:.0f} mm3")
