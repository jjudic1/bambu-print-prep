"""A1 pass condition, part 1: write a project 3mf and read it straight back."""
import numpy as np
import trimesh

from prep.profiles import load_printer
from prep.write3mf import transform_from_3mf, transform_to_3mf, write_project_3mf

BUNNY = r"C:/Program Files/OrcaSlicer/resources/handy_models/Stanford_Bunny.3mf"

M = np.eye(4)
M[:3, :3] = trimesh.transformations.rotation_matrix(np.radians(35), (0, 0, 1))[:3, :3]
M[:3, 3] = (1, 2, 3)
assert np.allclose(transform_from_3mf(transform_to_3mf(M)), M)
print("transform roundtrip ok")

mesh = trimesh.load(BUNNY, force="mesh")
printer = load_printer("Bambu Lab P1S 0.4 nozzle")
print(f"bunny: {len(mesh.vertices)} verts, extents {np.round(mesh.extents, 2).tolist()}")

tilt = trimesh.transformations.rotation_matrix(np.radians(20), (1, 0, 0))
result = write_project_3mf("spikes/out/bunny.3mf", mesh, printer,
                           title="bunny.stl", orientation=tilt)
print(f"wrote {result.path}")
print(f"  printer  {result.printer}")
print(f"  process  {result.process}")
print(f"  filament {result.filament}")
print(f"  size     {np.round(result.size_mm, 2).tolist()} mm   fits={result.fits}")
