"""Smoke-test ingest + analyze on the bundled test models."""
import time
from pathlib import Path

import trimesh

from prep.analyze import analyze
from prep.ingest import load

MODELS = Path(r"C:/Program Files/OrcaSlicer/resources/handy_models")

for name in ["Stanford_Bunny.3mf", "3DBenchy.3mf", "OrcaCube_v2.3mf", "torus.stl"]:
    path = MODELS / name
    if not path.is_file():
        print(f"{name}: missing"); continue
    t0 = time.perf_counter()
    ing = load(path)
    t1 = time.perf_counter()
    rep = analyze(ing.mesh, unit_guess=ing.unit_guess)
    t2 = time.perf_counter()

    print(f"\n{name}  ({t1-t0:.2f}s load, {t2-t1:.2f}s analyze)")
    print(f"  units guessed {ing.unit_guess} (x{ing.scale_applied})  bbox "
          f"{[round(v,1) for v in rep.bbox_mm]} mm")
    print(f"  watertight {rep.watertight}  manifold {rep.manifold}  holes {rep.hole_count} "
          f" bad edges {rep.non_manifold_edges}  shells {rep.shell_count}  inverted {rep.inverted_normals}")
    print(f"  tris {rep.triangle_count}  degenerate {rep.degenerate_faces} "
          f" dup verts {rep.duplicate_vertices}")
    print(f"  volume {rep.volume_mm3/1000:.1f} cm3  area {rep.surface_area_mm2/100:.1f} cm2")
    print(f"  min wall {rep.min_wall_mm and round(rep.min_wall_mm,2)} mm "
          f" thin frac {rep.thin_fraction:.1%}")
    print(f"  flat base {rep.flat_base_area_mm2:.0f} mm2  overhangs {rep.overhang_ratio:.1%}")
    print(f"  printable: {rep.printable}")
