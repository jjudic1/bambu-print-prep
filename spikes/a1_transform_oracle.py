"""A1 spike, part 3: settle the transform convention with a spec-compliant reader.

Bounding boxes cannot tell a rotation from its transpose. So: take an asymmetric
mesh, apply a known asymmetric rotation, and write the same file twice --
once emitting the rows of our column-vector matrix, once its transpose. Hand both
to PrusaSlicer (an independent 3MF reader) and see which one comes back as the
rotation we actually asked for.
"""
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np
import trimesh

PRUSA = Path(r"C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe")
OUT = Path(__file__).resolve().parent / "out"

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
"""

RELS = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
"""


def asymmetric_mesh():
    """A shape with no symmetry in any axis, so orientation is unambiguous."""
    m = trimesh.creation.box(extents=(10, 20, 30))
    notch = trimesh.creation.box(extents=(6, 6, 6))
    notch.apply_translation((5, 10, 15))          # bite one corner
    m = trimesh.boolean.difference([m, notch])
    m.apply_translation(-m.bounds[0])             # sit on the origin
    return m


def model_xml(mesh, twelve):
    v = "\n".join(f'     <vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>'
                  for x, y, z in mesh.vertices)
    t = "\n".join(f'     <triangle v1="{a}" v2="{b}" v3="{c}"/>'
                  for a, b, c in mesh.faces)
    xf = " ".join(f"{n:.8g}" for n in twelve)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">prep-spike</metadata>
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
{v}
    </vertices>
    <triangles>
{t}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="1" transform="{xf}" printable="1"/>
 </build>
</model>
"""


def write_3mf(path, mesh, twelve):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("3D/3dmodel.model", model_xml(mesh, twelve))


def main():
    if not PRUSA.is_file():
        sys.exit(f"PrusaSlicer console not found at {PRUSA}")
    OUT.mkdir(parents=True, exist_ok=True)

    mesh = asymmetric_mesh()

    # A deliberately asymmetric rotation: 35 deg about Z, then 25 deg about X.
    M = (trimesh.transformations.rotation_matrix(np.radians(25), (1, 0, 0))
         @ trimesh.transformations.rotation_matrix(np.radians(35), (0, 0, 1)))
    M[:3, 3] = (128.0, 128.0, 0.0)
    R, t = M[:3, :3], M[:3, 3]

    want = trimesh.Trimesh(mesh.vertices @ R.T + t, mesh.faces, process=False)

    variants = {
        "rows":    np.concatenate([R.reshape(-1), t]),      # emit our matrix as-is
        "columns": np.concatenate([R.T.reshape(-1), t]),    # emit its transpose
    }

    print(f"mesh {len(mesh.vertices)} verts | intended bbox after transform:")
    print("   ", np.round(want.bounds, 3).tolist(), "\n")

    results = {}
    for label, twelve in variants.items():
        src = OUT / f"convention_{label}.3mf"
        dst = OUT / f"convention_{label}_readback.stl"
        write_3mf(src, mesh, twelve)
        dst.unlink(missing_ok=True)
        proc = subprocess.run([str(PRUSA), "--export-stl", "--output", str(dst), str(src)],
                              capture_output=True, text=True, timeout=180)
        if not dst.is_file():
            print(f"  {label}: PrusaSlicer produced nothing\n"
                  f"    stdout {proc.stdout.strip()[:200]}\n    stderr {proc.stderr.strip()[:200]}")
            continue

        back = trimesh.load(dst, process=False)
        # Compare extents, not vertices: the exporter re-tessellates and is free
        # to re-centre, but the oriented bounding size is invariant.
        dev = float(np.abs(np.asarray(back.extents) - np.asarray(want.extents)).max())
        results[label] = dev
        print(f"  {label:8s} read back {len(back.vertices):5d} verts | "
              f"extents {np.round(back.extents, 3).tolist()} | deviation {dev:.4f} mm")

    print(f"\n  intended extents {np.round(want.extents, 3).tolist()}")
    if results:
        best = min(results, key=results.get)
        print(f"\n=> write the transform as {best.upper()} "
              f"({results[best]:.4g} mm vs {max(results.values()):.4g} mm)")


if __name__ == "__main__":
    main()
