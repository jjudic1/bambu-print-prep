"""Bake the printer profiles into something a browser can hold.

The container `prep/write3mf.py` builds needs exactly one thing that is not a
constant or a template: the resolved settings blob for the chosen printer. On
the server that comes from resolving 6.9 MB of vendor JSON through an inherits
chain. In a browser it does not have to -- the answer is the same every time
for a given printer and material, so it can be resolved once, here, and
shipped.

Measured: 14 printers, one material each, 342 KB of JSON that gzips to under
16 KB. The bulky-looking member turns out to be nothing.

    python spikes/export_web_profiles.py

Writes web/src/data/printers.json. Re-run it when the vendored profiles change,
which is the same moment `prep/data/profiles` is updated and no more often.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prep.profiles import (                                    # noqa: E402
    ProfileError,
    default_filament,
    default_process,
    list_printers,
    load_printer,
    project_settings,
)

DEFAULT_NOZZLE_MM = 0.4

# What a user can actually be handed. Kept short on purpose: §6.4 says pick from
# what the user told you they have, not from a catalogue.
MATERIALS = ["PLA", "PETG", "ABS", "TPU"]


def build() -> dict:
    printers: dict[str, dict] = {}

    for name in sorted(list_printers()):
        try:
            printer = load_printer(name)
        except ProfileError:
            continue
        if printer.nozzle_mm != DEFAULT_NOZZLE_MM:
            continue
        if printer.model in printers:
            continue

        process = default_process(printer.name)
        materials = {}
        for material in MATERIALS:
            try:
                filament = default_filament(printer.name, material=material)
                materials[material] = {
                    "filament": filament,
                    "settings": project_settings(printer, process, filament,
                                                 supports=True),
                }
            except ProfileError:
                # Not every machine has every material. Skipping is right --
                # the UI should offer what exists, not what we hoped for.
                continue

        if not materials:
            continue

        printers[printer.model] = {
            "id": printer.name,
            "model": printer.model,
            "bed_mm": [printer.bed_mm[0], printer.bed_mm[1]],
            "height_mm": printer.height_mm,
            "nozzle_mm": printer.nozzle_mm,
            "bed_type": printer.bed_type,
            "process": process,
            "materials": materials,
        }

    return {
        "printers": sorted(printers.values(),
                           key=lambda p: (p["bed_mm"][0] * p["bed_mm"][1],
                                          p["model"])),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/src/data/printers.json")
    args = ap.parse_args(argv)

    data = build()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    # Not sorted. Python preserves insertion order and so does JSON.stringify,
    # so leaving the order alone is what lets the browser's settings blob come
    # out byte-identical to the server's -- which is the thing this spike is
    # trying to prove. Sorting here would quietly make that impossible.
    raw = json.dumps(data, separators=(",", ":"))
    out.write_text(raw, encoding="utf-8")

    encoded = raw.encode()
    print(f"printers            : {len(data['printers'])}")
    print(f"materials per printer: "
          f"{sorted({len(p['materials']) for p in data['printers']})}")
    print(f"raw                 : {len(encoded) / 1024:.1f} KB")
    print(f"gzipped             : {len(gzip.compress(encoded, 9)) / 1024:.1f} KB")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
