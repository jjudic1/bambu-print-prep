"""Which part of our 3mf makes Bambu Studio reject the config?

a2_config_bisect established that a genuine Bambu config is *also* rejected when
placed in our container, so the settings content was never the problem. The
fault is structural.

Take a real Bambu project that Bambu Studio accepts, and swap our version of one
part in at a time. Whichever swap flips acceptance to rejection is the culprit.
Acceptance is read from the sliced G-code header: an accepted config echoes
print_settings_id, a rejected one leaves it empty.

    python spikes/a2_container_bisect.py
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import trimesh  # noqa: E402

from prep.profiles import load_printer  # noqa: E402
from prep.write3mf import write_project_3mf  # noqa: E402

BAMBU = Path(r"C:/Program Files/Bambu Studio/bambu-studio.exe")
OUT = Path(__file__).resolve().parent / "out" / "container"
CORPUS = os.path.expanduser("~/Downloads/*.3mf")

PARTS = [
    "[Content_Types].xml",
    "_rels/.rels",
    "Metadata/slice_info.config",
    "Metadata/model_settings.config",
    "3D/3dmodel.model",
]


def find_donor():
    for path in sorted(glob.glob(CORPUS)):
        try:
            z = zipfile.ZipFile(path)
            names = z.namelist()
            if "Metadata/project_settings.config" not in names:
                continue
            head = z.read("3D/3dmodel.model")[:3000].decode("utf-8", "replace")
            if "BambuStudio-" not in head:
                continue
            d = json.loads(z.read("Metadata/project_settings.config"))
        except Exception:
            continue
        if len(d.get("filament_settings_id", [])) == 1 and len(d) > 250:
            return Path(path)
    return None


def rebuild(base_zip: Path, replacements: dict, dest: Path):
    """Copy base_zip, overriding the named members with the given bytes."""
    zin = zipfile.ZipFile(base_zip)
    written = set()
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = replacements.get(item.filename, zin.read(item.filename))
            if data is None:
                continue                       # deliberately dropped
            zout.writestr(item.filename, data)
            written.add(item.filename)
        for name, data in replacements.items():
            if name not in written and data is not None:
                zout.writestr(name, data)
    zin.close()


def accepted(path: Path, label: str) -> bool:
    outdir = OUT / f"slice_{label}"
    shutil.rmtree(outdir, ignore_errors=True)
    outdir.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(BAMBU), "--slice", "0", "--outputdir", str(outdir), str(path)],
                   capture_output=True, timeout=1200)
    gcode = outdir / "plate_1.gcode"
    if not gcode.is_file():
        return False
    for line in gcode.read_text(errors="replace").splitlines():
        if line.startswith("; print_settings_id ="):
            return line.split("=", 1)[1].strip() != ""
    return False


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    donor = find_donor()
    if donor is None:
        sys.exit("no donor found")

    printer = load_printer("Bambu Lab P1S 0.4 nozzle")
    mine = OUT / "_mine.3mf"
    write_project_3mf(mine, trimesh.creation.box(extents=(20, 20, 20)),
                      printer, title="cube.stl")

    print(f"donor: {donor.name}")
    dz, mz = zipfile.ZipFile(donor), zipfile.ZipFile(mine)
    dnames, mnames = set(dz.namelist()), set(mz.namelist())

    print(f"\ndonor members ({len(dnames)}): {sorted(dnames)}")
    print(f"our members   ({len(mnames)}): {sorted(mnames)}")
    print(f"\nin donor, absent from ours: {sorted(dnames - mnames)}")

    baseline = OUT / "probe_donor.3mf"
    shutil.copy(donor, baseline)
    print("\nbaseline (untouched donor)...")
    if not accepted(baseline, "donor"):
        print("  donor itself is rejected -- the oracle is unreliable, stop.")
        return 1
    print("  accepted\n")

    for part in PARTS:
        if part not in mnames:
            continue
        probe = OUT / f"probe_{part.replace('/', '_').replace('[', '').replace(']', '')}.3mf"
        rebuild(donor, {part: mz.read(part)}, probe)
        ok = accepted(probe, part.replace("/", "_").replace("[", "").replace("]", ""))
        print(f"  donor + OUR {part:34s} -> {'accepted' if ok else 'REJECTED  <-- culprit'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
