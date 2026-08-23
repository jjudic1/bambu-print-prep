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
import re
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

# Bambu Studio 02.x added ~100 settings that do not exist in 01.x files at all
# -- prime_tower_rib_wall and friends among them. Harvesting across both eras
# conflates two schemas: the new keys look rare (35% of a mixed corpus) and get
# filtered out as noise. They are not noise; they are universal *within their
# era*. So cohort by major version and harvest the current one.
SCHEMA_ERA = re.compile(r"BambuStudio-0*(\d+)\.")
CURRENT_ERA = "2"

# Real files disagree on a handful of keys because users changed them. Taking
# the majority is right, but anything this uncertain is worth seeing, so the
# run prints everything below 0.9 rather than silently baking it in.
AGREEMENT = 0.80

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


def _header(z) -> str | None:
    try:
        return z.read("3D/3dmodel.model")[:3000].decode("utf-8", "replace")
    except KeyError:
        return None


def is_genuine(z) -> bool:
    """Written by Bambu Studio, and *not* by us.

    Our own output declares itself as BambuStudio-<version> too -- it has to, or
    Bambu Studio drops every setting -- so the old check now matches our files
    as well as theirs. A file this tool produced once ended up in Downloads and
    started scoring itself as ground truth; prep.write3mf stamps Origin, so
    there is a reliable way to exclude our own work from a corpus scan.
    """
    head = _header(z)
    if head is None:
        return False
    if ">print-prep<" in head:
        return False
    return "BambuStudio-" in head


def era_of(z) -> str | None:
    head = _header(z)
    match = SCHEMA_ERA.search(head) if head else None
    return match.group(1) if match else None


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
            if era_of(z) != CURRENT_ERA:
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

    strong = {k: v["value"] for k, v in baseline.items() if v["agreement"] >= AGREEMENT}
    weak = {k: v for k, v in baseline.items() if v["agreement"] < AGREEMENT}
    shaky = {k: v for k, v in baseline.items() if AGREEMENT <= v["agreement"] < 0.9}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(strong, indent=2, sort_keys=True), encoding="utf-8")

    print(f"single-extruder Bambu Studio files: {total}")
    print(f"candidate keys missing from ours   : {len(baseline)}")
    print(f"written (>={AGREEMENT:.0%} agreement)          : {len(strong)} -> {out}")
    if shaky:
        print(f"  of those, below 90% -- real files disagree, majority taken:")
        for key, info in sorted(shaky.items(), key=lambda kv: kv[1]["agreement"]):
            print(f"    {key:42s} {info['agreement']:.0%}  -> {info['value']!r}")
    if weak:
        print(f"skipped (values genuinely vary)    : {len(weak)}")
        for key, info in sorted(weak.items(), key=lambda kv: kv[1]['agreement'])[:12]:
            print(f"    {key:42s} top value agrees {info['agreement']:.0%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
