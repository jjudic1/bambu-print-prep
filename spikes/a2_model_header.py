"""Which part of our 3dmodel.model header makes Bambu Studio disown the config?

The container bisect pinned the fault to 3D/3dmodel.model. The obvious suspect is
the Application metadata: ours says "print-prep", every real file says
"BambuStudio-<version>". "Load geometry data only" is precisely how a slicer
treats a file written by somebody else's tool.

Tests header variants against our own container, so there is no donor to confound
the result.

    python spikes/a2_model_header.py
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import trimesh  # noqa: E402

from prep.profiles import CLIENT_VERSION, load_printer  # noqa: E402
from prep.write3mf import write_project_3mf  # noqa: E402

BAMBU = Path(r"C:/Program Files/Bambu Studio/bambu-studio.exe")
OUT = Path(__file__).resolve().parent / "out" / "header"

# The metadata block real Bambu files carry, in their order.
FULL_METADATA = """ <metadata name="Application">BambuStudio-{version}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="CopyRight"></metadata>
 <metadata name="CreationDate">2026-08-22</metadata>
 <metadata name="Description"></metadata>
 <metadata name="Designer"></metadata>
 <metadata name="DesignerCover"></metadata>
 <metadata name="DesignerUserId"></metadata>
 <metadata name="License"></metadata>
 <metadata name="ModificationDate">2026-08-22</metadata>
 <metadata name="Origin"></metadata>
 <metadata name="Title"></metadata>
"""


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


def variant(base: Path, dest: Path, transform):
    zin = zipfile.ZipFile(base)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "3D/3dmodel.model":
                data = transform(data.decode("utf-8")).encode("utf-8")
            zout.writestr(item.filename, data)
    zin.close()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    printer = load_printer("Bambu Lab P1S 0.4 nozzle")
    base = OUT / "_base.3mf"
    write_project_3mf(base, trimesh.creation.box(extents=(20, 20, 20)),
                      printer, title="cube.stl")

    def as_is(xml):
        return xml

    def rename_app(xml):
        return xml.replace('<metadata name="Application">print-prep</metadata>',
                           f'<metadata name="Application">BambuStudio-{CLIENT_VERSION}</metadata>')

    def slic3r_namespace(xml):
        return rename_app(xml).replace(
            'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021"',
            'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06"')

    def full_header(xml):
        xml = slic3r_namespace(xml)
        # Replace our whole metadata block with the one Bambu writes.
        start = xml.index(' <metadata name="Application">')
        end = xml.index(" <resources>")
        return xml[:start] + FULL_METADATA.format(version=CLIENT_VERSION) + xml[end:]

    tests = [
        ("as-is (control)", as_is),
        ("Application renamed", rename_app),
        ("+ slic3rpe namespace", slic3r_namespace),
        ("+ full metadata block", full_header),
    ]

    for label, fn in tests:
        path = OUT / f"probe_{label.replace(' ', '_').replace('+', 'p')}.3mf"
        variant(base, path, fn)
        ok = accepted(path, label.replace(" ", "_").replace("+", "p"))
        print(f"  {label:26s} -> {'ACCEPTED' if ok else 'rejected'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
