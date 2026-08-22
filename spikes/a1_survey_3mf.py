"""A1 spike: survey real .3mf files to learn which members are actually required.

Reads a corpus of downloaded project files and reports member-name frequency,
which application wrote each file, and which carry Bambu print settings.
Read-only; writes nothing.
"""
import collections
import glob
import os
import re
import sys
import zipfile

CORPUS = os.path.expanduser("~/Downloads/*.3mf")

# Members whose names embed a variable index or user string; collapse for counting.
NORMALISE = [
    (re.compile(r"^3D/Objects/.*\.model$"), "3D/Objects/<name>.model"),
    (re.compile(r"^Metadata/plate_\d+\.png$"), "Metadata/plate_<n>.png"),
    (re.compile(r"^Metadata/plate_\d+\.json$"), "Metadata/plate_<n>.json"),
    (re.compile(r"^Metadata/plate_no_light_\d+\.png$"), "Metadata/plate_no_light_<n>.png"),
    (re.compile(r"^Metadata/top_\d+\.png$"), "Metadata/top_<n>.png"),
    (re.compile(r"^Metadata/pick_\d+\.png$"), "Metadata/pick_<n>.png"),
    (re.compile(r"^Auxiliaries/.*"), "Auxiliaries/<...>"),
]


def normalise(name):
    for pattern, label in NORMALISE:
        if pattern.match(name):
            return label
    return name


def generator_of(zf):
    """Read the writing application out of 3dmodel.model metadata."""
    try:
        head = zf.read("3D/3dmodel.model")[:4000].decode("utf-8", "replace")
    except KeyError:
        return "no-3dmodel.model"
    m = re.search(r'name="Application">([^<]+)<', head)
    if m:
        return m.group(1).strip()
    m = re.search(r"<!--\s*(.*?)\s*-->", head)
    return m.group(1).strip() if m else "unknown"


def main():
    files = sorted(glob.glob(CORPUS))
    if not files:
        sys.exit(f"no .3mf files found at {CORPUS}")

    member_counts = collections.Counter()
    generators = collections.Counter()
    bad = []
    total = 0

    for path in files:
        try:
            with zipfile.ZipFile(path) as zf:
                names = zf.namelist()
                member_counts.update({normalise(n) for n in names})
                generators[generator_of(zf)] += 1
        except (zipfile.BadZipFile, OSError) as exc:
            bad.append((os.path.basename(path), type(exc).__name__))
            continue
        total += 1

    print(f"corpus: {total} readable .3mf files ({len(bad)} unreadable)\n")

    print("member frequency (share of files containing it)")
    print("-" * 62)
    for name, count in member_counts.most_common(28):
        share = count / total
        marker = "ALWAYS" if count == total else f"{share:6.1%}"
        print(f"  {marker}  {name}")

    print("\nwriting application")
    print("-" * 62)
    for name, count in generators.most_common(12):
        print(f"  {count:5d}  {name}")

    if bad:
        print("\nunreadable")
        for name, kind in bad[:10]:
            print(f"  {kind}: {name}")


if __name__ == "__main__":
    main()
