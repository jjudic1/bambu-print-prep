"""Bake the printer profiles into something a browser can hold.

The container `prep/write3mf.py` builds needs exactly one thing that is not a
constant or a template: the resolved settings blob for the chosen printer. On
the server that comes from resolving 6.9 MB of vendor JSON through an inherits
chain. In a browser it does not have to -- the answer is the same every time
for a given printer and material, so it can be resolved once, here, and
shipped.

It is written as two files, and the split is about what the page pays for on
load. The index -- bed, height, nozzle, which materials exist -- is what the
pickers read, and it is 6 KB. The settings blobs are 5.4 MB across 14 models x
4 nozzles x 4 materials, and nothing needs them until the user asks for a file.
So they go in their own module, loaded on demand: the main bundle carries the
index, and the blobs arrive as a separate chunk (117 KB over the wire). Baked
into the bundle instead, they took it from 1.9 MB to 5.9 MB of JavaScript to
parse before anything appears -- on an iPad, which is the whole target.

    python spikes/export_web_profiles.py

Writes web/src/data/printers.json and web/src/data/printer-settings.json.
Re-run it when the vendored profiles change, which is the same moment
`prep/data/profiles` is updated and no more often.
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

# The nozzles Bambu sells, and the one that comes on the machine. Every model
# in the vendored tree has a profile for all four -- checked, not assumed -- so
# the browser can be handed the lot and the user can say which is fitted.
#
# It costs what you would expect: four times the settings blobs. Still under
# 150 KB over the wire, which is less than one of the hero images, and it buys
# the one machine fact the file cannot be right without.
NOZZLES_MM = [0.2, 0.4, 0.6, 0.8]

# What a user can actually be handed. Kept short on purpose: §6.4 says pick from
# what the user told you they have, not from a catalogue.
MATERIALS = ["PLA", "PETG", "ABS", "TPU"]


def build() -> tuple[dict, dict]:
    """(index, settings) -- the small thing every page load reads, and the big
    one only a file needs."""
    # Keyed by (model, nozzle): one machine profile per nozzle, and the vendor
    # tree has more than one profile naming the same pair.
    printers: dict[tuple[str, float], dict] = {}
    blobs: dict[str, dict] = {}

    for name in sorted(list_printers()):
        try:
            printer = load_printer(name)
        except ProfileError:
            continue
        if printer.nozzle_mm not in NOZZLES_MM:
            continue
        if (printer.model, printer.nozzle_mm) in printers:
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

        printers[printer.model, printer.nozzle_mm] = {
            "id": printer.name,
            "model": printer.model,
            "bed_mm": [printer.bed_mm[0], printer.bed_mm[1]],
            "height_mm": printer.height_mm,
            "nozzle_mm": printer.nozzle_mm,
            "bed_type": printer.bed_type,
            "process": process,
            # Names only. What each one resolves to lives in the other file.
            "materials": sorted(materials, key=MATERIALS.index),
        }
        blobs[printer.name] = materials

    # Smallest bed first, then by model, then by nozzle -- the order the two
    # pickers read in. Adding the nozzle to the key leaves the models in the
    # order they were already in.
    index = sorted(printers.values(),
                   key=lambda p: (p["bed_mm"][0] * p["bed_mm"][1],
                                  p["model"], p["nozzle_mm"]))
    return ({"printers": index},
            {p["id"]: blobs[p["id"]] for p in index})


def _write(path: Path, data: dict) -> bytes:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Not sorted. Python preserves insertion order and so does JSON.stringify,
    # so leaving the order alone is what lets the browser's settings blob come
    # out byte-identical to the server's -- which is the thing this spike is
    # trying to prove. Sorting here would quietly make that impossible.
    raw = json.dumps(data, separators=(",", ":"))
    path.write_text(raw, encoding="utf-8")
    return raw.encode()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/src/data/printers.json")
    ap.add_argument("--settings-out", default=None,
                    help="default: printer-settings.json beside --out")
    args = ap.parse_args(argv)

    index, settings = build()
    out = Path(args.out)
    settings_out = (Path(args.settings_out) if args.settings_out
                    else out.with_name("printer-settings.json"))

    encoded = _write(out, index)
    settings_encoded = _write(settings_out, settings)

    print(f"printers            : {len(index['printers'])}")
    print(f"models              : {len({p['model'] for p in index['printers']})}")
    print(f"nozzles             : "
          f"{sorted({p['nozzle_mm'] for p in index['printers']})}")
    print(f"materials per printer: "
          f"{sorted({len(p['materials']) for p in index['printers']})}")
    for label, path, blob in (("index", out, encoded),
                              ("settings", settings_out, settings_encoded)):
        print(f"{label:20}: {len(blob) / 1024:.1f} KB raw, "
              f"{len(gzip.compress(blob, 9)) / 1024:.1f} KB gzipped -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
