"""A1 pass condition: is the 3mf we write a real, correct project file?

Three independent checks, none of which need a GUI:

1. Read it back with trimesh (an unrelated 3MF implementation) and confirm the
   geometry lands where we intended -- right size, right orientation, centred on
   the bed, sitting on z=0.
2. Hand it to PrusaSlicer, which parses 3MF strictly, and confirm it round-trips.
3. Diff our project_settings.config against a real Bambu-written one, so we learn
   which keys Bambu emits that we do not.

The remaining half of the pass condition -- "Bambu Studio opens it and slices
without a repair prompt" -- needs a human at the GUI. This script prints the file
to open.
"""

import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prep.profiles import load_printer                    # noqa: E402
from prep.write3mf import transform_from_3mf, write_project_3mf  # noqa: E402

PRUSA = Path(r"C:/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe")
BUNNY = Path(r"C:/Program Files/OrcaSlicer/resources/handy_models/Stanford_Bunny.3mf")
REFERENCE = Path(os.path.expanduser("~/Downloads/ptfe_tool.3mf"))
OUT = Path(__file__).resolve().parent / "out"

TOL = 0.01  # mm


def check(label, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  -- {detail}" if detail else ""))
    return ok


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    printer = load_printer("Bambu Lab P1S 0.4 nozzle")
    mesh = trimesh.load(BUNNY, force="mesh")

    # A tilt that is asymmetric in two axes, so a transpose bug cannot hide.
    tilt = (trimesh.transformations.rotation_matrix(np.radians(20), (1, 0, 0))
            @ trimesh.transformations.rotation_matrix(np.radians(40), (0, 0, 1)))

    path = OUT / "validate_bunny.3mf"
    written = write_project_3mf(path, mesh, printer, title="bunny.stl", orientation=tilt)

    intended = mesh.copy()
    intended.apply_transform(
        __import__("prep.write3mf", fromlist=["place_on_bed"]).place_on_bed(mesh, printer, tilt))

    ok = True
    print(f"\n1. read back with trimesh  ({path.name})")
    back = trimesh.load(path, force="mesh")
    ok &= check("triangle count preserved", len(back.faces) == len(mesh.faces),
                f"{len(back.faces)} vs {len(mesh.faces)}")
    ok &= check("extents match intent",
                np.allclose(back.extents, intended.extents, atol=TOL),
                f"{np.round(back.extents, 3).tolist()} vs {np.round(intended.extents, 3).tolist()}")

    low, high = back.bounds
    ok &= check("sits on the bed (z min == 0)", abs(low[2]) < TOL, f"z min {low[2]:.4f}")
    centre = ((low[:2] + high[:2]) / 2.0)
    ok &= check("centred on the plate",
                np.allclose(centre, printer.bed_centre, atol=TOL),
                f"{np.round(centre, 3).tolist()} vs {list(printer.bed_centre)}")
    ok &= check("inside the build volume", printer.fits(back.extents),
                f"{np.round(back.extents, 1).tolist()} in "
                f"{printer.bed_mm[0]}x{printer.bed_mm[1]}x{printer.height_mm}")

    print("\n2. parsed by PrusaSlicer")
    if not PRUSA.is_file():
        print("  [SKIP] PrusaSlicer console not installed")
    else:
        stl = OUT / "validate_bunny_readback.stl"
        stl.unlink(missing_ok=True)
        proc = subprocess.run([str(PRUSA), "--export-stl", "--output", str(stl), str(path)],
                              capture_output=True, text=True, timeout=300)
        if stl.is_file():
            ext = trimesh.load(stl, process=False).extents
            ok &= check("PrusaSlicer agrees on size",
                        np.allclose(ext, intended.extents, atol=0.05),
                        f"{np.round(ext, 3).tolist()}")
        else:
            ok &= check("PrusaSlicer parsed the file", False,
                        (proc.stderr or proc.stdout).strip()[:160])

    print("\n3. settings coverage vs a real Bambu project file")
    if not REFERENCE.is_file():
        print("  [SKIP] no reference file")
    else:
        ours = json.loads(zipfile.ZipFile(path).read("Metadata/project_settings.config"))
        theirs = json.loads(zipfile.ZipFile(REFERENCE).read("Metadata/project_settings.config"))
        missing = sorted(set(theirs) - set(ours))
        extra = sorted(set(ours) - set(theirs))
        print(f"  ours {len(ours)} keys | reference {len(theirs)} keys")
        print(f"  missing {len(missing)}: {missing[:14]}{' ...' if len(missing) > 14 else ''}")
        print(f"  extra   {len(extra)}: {extra[:8]}{' ...' if len(extra) > 8 else ''}")
        for key in ("printer_model", "printable_area", "printable_height",
                    "nozzle_diameter", "layer_height", "filament_type", "curr_bed_type"):
            ok &= check(f"carries {key}", key in ours, repr(ours.get(key))[:60])

    print(f"\n{'ALL AUTOMATED CHECKS PASSED' if ok else 'SOME CHECKS FAILED'}")
    print(f"\nManual step remaining -- open in Bambu Studio and slice:\n  {path.resolve()}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
