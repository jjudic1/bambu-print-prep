"""Harvest the settings Bambu Studio always writes but the profile JSONs omit.

Bambu Studio's project_settings.config carries ~320 keys. Resolving OrcaSlicer's
vendor profiles gives us only ~235: the rest are the slicer's compiled-in
defaults, which live in C++ and appear in no JSON on disk -- not OrcaSlicer's
bundle and not Bambu Studio's own.

An incomplete config is a plausible reason Bambu Studio ignored our settings and
fell back to the system profile, which is what made "supports on" not stick.

So take the values empirically: for every key present in essentially every real
Bambu-written project file but missing from ours, record the most common value.
Restricted to single-extruder files, because list-valued keys are per-extruder
and a mode taken across four-filament projects would have the wrong arity.

Output: prep/data/bambu_baseline.json, vendored so the pipeline does not depend
on anyone's Downloads folder.

    python spikes/a1_harvest_baseline.py [--out prep/data/bambu_baseline.json]
"""

from __future__ import annotations

import argparse
import collections
import glob
import json
import os
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prep.profiles import (                        # noqa: E402
    default_filament,
    default_process,
    load_printer,
    project_settings,
)

CORPUS = os.path.expanduser("~/Downloads/*.3mf")

# A key must appear in at least this share of real files to count as a default.
PRESENCE = 0.98

# Keys that describe one specific project rather than a default, and must never
# be baked into a baseline.
PROJECT_SPECIFIC = {
    "version", "print_settings_id", "printer_settings_id", "filament_settings_id",
    "from", "name", "different_settings_to_system", "print_compatible_printers",
    "curr_bed_type", "printer_model", "printable_area", "printable_height",
    "nozzle_diameter", "printer_variant", "first_layer_print_sequence",
    "filament_colour", "default_filament_colour", "filament_ids",
    "wipe_tower_x", "wipe_tower_y", "flush_volumes_matrix", "flush_volumes_vector",
    "bed_custom_model", "bed_custom_texture", "post_process",
    "template_custom_gcode", "time_lapse_gcode", "thumbnail_size",
}


def is_genuine(z) -> bool:
    try:
        head = z.read("3D/3dmodel.model")[:3000].decode("utf-8", "replace")
    except KeyError:
        return False
    return "BambuStudio-" in head


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="prep/data/bambu_baseline.json")
    ap.add_argument("--corpus", default=CORPUS)
    args = ap.parse_args(argv)

    printer = load_printer("Bambu Lab P1S 0.4 nozzle")
    ours = set(project_settings(printer, default_process(printer.name),
                                default_filament(printer.name)))

    values: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    total = 0

    for path in sorted(glob.glob(args.corpus)):
        try:
            z = zipfile.ZipFile(path)
            if "Metadata/project_settings.config" not in z.namelist():
                continue
            if not is_genuine(z):
                continue
            d = json.loads(z.read("Metadata/project_settings.config"))
        except Exception:
            continue
        if len(d) < 100:
            continue
        # Single extruder only: list-valued keys are per-extruder, and a mode
        # taken across multi-filament projects would have the wrong length.
        if len(d.get("filament_settings_id", [])) != 1:
            continue

        total += 1
        for key, value in d.items():
            values[key][json.dumps(value, sort_keys=True)] += 1

    if not total:
        print("no single-extruder Bambu files found in the corpus", file=sys.stderr)
        return 2

    baseline = {}
    for key, counter in values.items():
        if key in ours or key in PROJECT_SPECIFIC:
            continue
        present = sum(counter.values())
        if present < total * PRESENCE:
            continue
        encoded, agree = counter.most_common(1)[0]
        baseline[key] = {"value": json.loads(encoded), "agreement": agree / present}

    strong = {k: v["value"] for k, v in baseline.items() if v["agreement"] >= 0.9}
    weak = {k: v for k, v in baseline.items() if v["agreement"] < 0.9}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(strong, indent=2, sort_keys=True), encoding="utf-8")

    print(f"single-extruder Bambu Studio files: {total}")
    print(f"candidate keys missing from ours   : {len(baseline)}")
    print(f"written (>=90% agreement)          : {len(strong)} -> {out}")
    if weak:
        print(f"skipped (values genuinely vary)    : {len(weak)}")
        for key, info in sorted(weak.items(), key=lambda kv: kv[1]['agreement'])[:12]:
            print(f"    {key:42s} top value agrees {info['agreement']:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
