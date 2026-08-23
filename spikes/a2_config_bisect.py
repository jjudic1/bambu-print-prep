"""Find why Bambu Studio calls our project config invalid.

Bambu Studio reports "The 3mf file has invalid config, load geometry data only"
and falls back to built-in defaults, which is why enable_support never stuck.
Its exe writes no console output, but it *does* write files, so
``bambu-studio.exe --slice`` is a usable oracle: if the config was accepted the
G-code header echoes our print_settings_id, and if it was rejected that field
comes back empty.

Strategy: take a config Bambu Studio accepts (harvested from a real project),
then move our keys onto it in halves until acceptance breaks. Geometry is a
20 mm cube so each slice takes seconds rather than a minute.

    python spikes/a2_config_bisect.py
"""

from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import trimesh  # noqa: E402

from prep.profiles import (  # noqa: E402
    default_filament,
    default_process,
    load_printer,
    project_settings,
)
from prep.write3mf import write_project_3mf  # noqa: E402

BAMBU = Path(r"C:/Program Files/Bambu Studio/bambu-studio.exe")
OUT = Path(__file__).resolve().parent / "out" / "bisect"
CORPUS = os.path.expanduser("~/Downloads/*.3mf")


def find_donor():
    """A real single-filament Bambu project whose config we know Bambu accepts."""
    for path in sorted(glob.glob(CORPUS)):
        try:
            z = zipfile.ZipFile(path)
            if "Metadata/project_settings.config" not in z.namelist():
                continue
            head = z.read("3D/3dmodel.model")[:3000].decode("utf-8", "replace")
            if "BambuStudio-" not in head:
                continue
            d = json.loads(z.read("Metadata/project_settings.config"))
        except Exception:
            continue
        if len(d.get("filament_settings_id", [])) == 1 and len(d) > 250:
            return path, d
    return None, None


def build(config: dict, path: Path):
    """Our 3mf container, with the given config swapped in."""
    base = OUT / "_base.3mf"
    shutil.copy(base, path)

    tmp = path.with_suffix(".tmp.3mf")
    zin = zipfile.ZipFile(path)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "Metadata/project_settings.config":
                data = json.dumps(config, indent=4, ensure_ascii=False).encode()
            zout.writestr(item, data)
    zin.close()
    tmp.replace(path)


def accepted(config: dict, label: str) -> bool:
    """True if Bambu Studio kept the config rather than falling back to defaults."""
    work = OUT / f"probe_{label}.3mf"
    outdir = OUT / f"slice_{label}"
    shutil.rmtree(outdir, ignore_errors=True)
    outdir.mkdir(parents=True, exist_ok=True)
    build(config, work)

    subprocess.run([str(BAMBU), "--slice", "0", "--outputdir", str(outdir), str(work)],
                   capture_output=True, timeout=900)

    gcode = outdir / "plate_1.gcode"
    if not gcode.is_file():
        return False
    for line in gcode.read_text(errors="replace").splitlines():
        if line.startswith("; print_settings_id ="):
            return line.split("=", 1)[1].strip() != ""
    return False


def main() -> int:
    if not BAMBU.is_file():
        sys.exit(f"Bambu Studio not found at {BAMBU}")
    OUT.mkdir(parents=True, exist_ok=True)

    printer = load_printer("Bambu Lab P1S 0.4 nozzle")
    cube = trimesh.creation.box(extents=(20, 20, 20))
    write_project_3mf(OUT / "_base.3mf", cube, printer, title="cube.stl")

    ours = project_settings(printer, default_process(printer.name),
                            default_filament(printer.name))
    donor_path, donor = find_donor()
    if donor is None:
        sys.exit("no single-filament donor config found in the corpus")

    print(f"donor: {Path(donor_path).name}  ({len(donor)} keys)")
    print(f"ours :  {len(ours)} keys\n")

    print("checking the two endpoints (about a minute each)...")
    ours_ok = accepted(ours, "ours")
    print(f"  ours  accepted: {ours_ok}")
    donor_ok = accepted(donor, "donor")
    print(f"  donor accepted: {donor_ok}")

    if ours_ok:
        print("\nOurs is already accepted -- nothing to bisect.")
        return 0
    if not donor_ok:
        print("\nEven a real Bambu config is rejected in our container, so the "
              "problem is NOT the settings -- look at the 3mf structure instead.")
        return 1

    # Move our keys onto the donor in halves until acceptance breaks.
    differing = sorted(k for k in set(ours) | set(donor) if ours.get(k) != donor.get(k))
    print(f"\nkeys differing between donor and ours: {len(differing)}")

    def apply(keys):
        merged = dict(donor)
        for k in keys:
            if k in ours:
                merged[k] = ours[k]
            else:
                merged.pop(k, None)
        return merged

    suspects = list(differing)
    round_no = 0
    while len(suspects) > 1:
        round_no += 1
        half = len(suspects) // 2
        first, second = suspects[:half], suspects[half:]
        ok = accepted(apply(first), f"r{round_no}")
        print(f"  round {round_no}: applying {len(first):3d} keys -> "
              f"{'accepted' if ok else 'REJECTED'}")
        suspects = second if ok else first

    print(f"\n=> the key Bambu Studio rejects: {suspects[0]!r}")
    print(f"   ours  = {json.dumps(ours.get(suspects[0]))[:200]}")
    print(f"   donor = {json.dumps(donor.get(suspects[0]))[:200]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
