"""The pipeline as a command, which is Milestone 1.

    prep model.stl --size 80mm --printer "Bambu Lab P1S 0.4 nozzle"

Deliberately the same code path the API will call later, so anything proved here
is proved for the service too. Output is written for a person reading a terminal;
``--json`` gives the machine-readable version the worker will actually use.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from . import analyze as analyze_mod
from . import bambu as bambu_mod
from . import base as base_mod
from . import handoff as handoff_mod
from . import orient as orient_mod
from . import size as size_mod
from .ingest import IngestError, TooLarge, load
from .profiles import ProfileError, default_filament, default_process, list_printers, load_printer
from .repair import repair
from .write3mf import write_project_3mf

DEFAULT_PRINTER = "Bambu Lab P1S 0.4 nozzle"

# Exit codes the launcher reacts to.
EXIT_TOO_BIG_FOR_BED = 1     # prepared fine, but larger than the build volume
EXIT_BAD_PROFILE = 2
EXIT_UNUSABLE = 3            # cannot be read or repaired
EXIT_TOO_LARGE = 4           # too detailed, but --simplify would fix it


def parse_size(text: str) -> float:
    """Accept '80mm', '80', '3in', '3.5 in' -- and say so clearly when it is none of those."""
    cleaned = text.strip().lower().replace(" ", "")
    for suffix, factor in (("mm", 1.0), ("cm", 10.0), ("in", 25.4), ('"', 25.4)):
        if cleaned.endswith(suffix):
            cleaned = cleaned[: -len(suffix)]
            return float(cleaned) * factor
    return float(cleaned)


def _output_path(out_arg, model_path, longest_mm: float) -> Path:
    """Name the file the way §6.5 asks: recognisable, never a UUID.

    ``dragon-80mm.3mf`` tells the user which model and which size, which is what
    they need three prints later when Files shows a list of them. ``--out`` may
    name a file exactly, or a directory to put the recognisable name in -- the
    launcher wants the latter, since it does not know the final size either.
    """
    nice = f"{Path(model_path).stem}-{round(longest_mm)}mm.3mf"
    if out_arg:
        given = Path(out_arg)
        if given.is_dir() or str(out_arg).endswith(("/", "\\")):
            return given / nice
        return given
    return Path(model_path).with_name(nice)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="prep",
        description="Turn a 3D model into a print-ready project file.")
    p.add_argument("model", nargs="?", help="the .stl/.obj/.3mf/.glb file to prepare")
    p.add_argument("--size", help="how big, longest side: 80mm, 3in, 120")
    p.add_argument("--intent", choices=sorted(size_mod.INTENTS),
                   help="a named size instead of a number")
    p.add_argument("--printer", default=DEFAULT_PRINTER)
    p.add_argument("--material", default="PLA")
    p.add_argument("--out", help="output .3mf (default: alongside the input)")
    p.add_argument("--no-orient", action="store_true",
                   help="keep the model's own orientation")
    p.add_argument("--no-flatten", action="store_true",
                   help="don't level the bottom, even if it rocks on a curve")
    p.add_argument("--no-supports", action="store_true",
                   help="don't turn on automatic supports")
    p.add_argument("--no-repair", action="store_true")
    p.add_argument("--simplify", action="store_true",
                   help="accept the offer to simplify a very large model")
    p.add_argument("--no-makerworld", action="store_true",
                   help="skip the Bambu Studio rewrite that MakerWorld requires")
    p.add_argument("--no-instructions", action="store_true",
                   help="don't write the how-to-print page beside the file")
    p.add_argument("--json", action="store_true", help="machine-readable output")
    p.add_argument("--list-printers", action="store_true")
    return p


def main(argv=None) -> int:
    # The Windows console defaults to cp1252 and mangles anything outside it.
    # User-facing copy should never be at the mercy of the code page.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    args = build_parser().parse_args(argv)

    if args.list_printers:
        for name in list_printers():
            print(name)
        return 0

    if not args.model:
        build_parser().error("a model file is required")

    try:
        printer = load_printer(args.printer)
    except ProfileError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_BAD_PROFILE

    try:
        ingested = load(args.model, simplify=args.simplify)
    except TooLarge as exc:
        print(f"{exc}", file=sys.stderr)
        return EXIT_TOO_LARGE
    except IngestError as exc:
        print(f"{exc}", file=sys.stderr)
        return EXIT_UNUSABLE

    mesh = ingested.mesh
    report = analyze_mod.analyze(mesh, unit_guess=ingested.unit_guess,
                                 nozzle_mm=printer.nozzle_mm)

    repair_log = None
    if not args.no_repair and not report.printable:
        mesh, repair_log = repair(mesh, report=report, nozzle_mm=printer.nozzle_mm)
        report = repair_log.after

    # Bake the orientation into the geometry rather than carrying it alongside.
    # Everything after this -- levelling the base, measuring the longest side --
    # only means anything once "down" is settled, and a single baked transform
    # removes any chance of applying it twice.
    chosen = None
    if not args.no_orient:
        chosen, _alternates = orient_mod.solve(mesh)
        mesh = mesh.copy()
        mesh.apply_transform(chosen.matrix)
        mesh.apply_translation([0, 0, -float(mesh.bounds[0][2])])

    flattened = None
    if not args.no_flatten:
        mesh, flattened = base_mod.flatten_base(mesh)

    if args.intent:
        sizing = size_mod.apply(mesh, report, printer, intent=args.intent)
    elif args.size:
        sizing = size_mod.apply(mesh, report, printer,
                                target_longest_mm=parse_size(args.size))
    else:
        sizing = size_mod.apply(mesh, report, printer, scale=1.0)

    scaled = mesh.copy()
    scaled.apply_scale(sizing.scale)

    out = _output_path(args.out, args.model, sizing.longest_mm)
    written = write_project_3mf(
        out, scaled, printer,
        title=Path(args.model).name,
        orientation=None,                     # already baked into the geometry
        process=default_process(printer.name),
        filament=default_filament(printer.name, material=args.material),
        supports=not args.no_supports,
    )

    # MakerWorld rejects our own container even though Bambu Studio accepts it,
    # so hand the finished file back through Bambu Studio as a writer (§2A).
    # The picture no longer comes out of Bambu Studio's export -- prep.render
    # draws it, so it exists whether or not the rewrite below runs, and will
    # still exist once the rewrite is gone entirely.
    preview = None
    if written.preview_png:
        preview = written.path.with_name(written.path.stem + "-preview.png")
        preview.write_bytes(written.preview_png)

    makerworld_ready = False
    makerworld_note = None
    if not args.no_makerworld:
        try:
            bambu_mod.rewrite_for_makerworld(written.path)
            makerworld_ready = True
        except bambu_mod.BambuStudioUnavailable as exc:
            makerworld_note = str(exc)
        except (bambu_mod.ExportFailed, OSError, subprocess.SubprocessError) as exc:
            makerworld_note = f"Bambu Studio couldn't rewrite the file: {exc}"

    # §6.5. The instructions travel with the model, because the model is the
    # only thing that reaches the iPad. Written last, so it can show the picture
    # and the size that actually came out.
    instructions = None
    if not args.no_instructions:
        x, y, z = (round(v, 1) for v in written.size_mm)
        instructions = handoff_mod.write(
            written.path.with_name(written.path.stem + " - how to print this.html"),
            model_name=Path(args.model).stem,
            file_name=written.path.name,
            printer=written.printer,
            size_text=f"{x} x {y} x {z} mm - {sizing.comparison}",
            material=args.material,
            preview=preview,
        )

    if args.json:
        print(json.dumps({
            "source": ingested.source_name,
            "unit_guess": ingested.unit_guess,
            "report": report.to_dict(),
            "repair": repair_log.steps if repair_log else [],
            "repair_succeeded": repair_log.succeeded if repair_log else None,
            "orientation_reason": chosen.reason if chosen else None,
            "orientation_scores": chosen.sub_scores if chosen else None,
            "flattened": flattened.note if flattened else None,
            "flattened_mm": flattened.removed_mm if flattened else 0.0,
            "supports": not args.no_supports,
            "scale": sizing.scale,
            "size_mm": list(written.size_mm),
            "comparison": sizing.comparison,
            "warning": sizing.warning,
            "fits": written.fits,
            "makerworld_ready": makerworld_ready,
            "makerworld_note": makerworld_note,
            "preview_image": str(preview) if preview else None,
            "instructions": str(instructions.path) if instructions else None,
            "output": str(written.path),
        }, indent=2))
        return 0

    _report_to_human(ingested, report, repair_log, chosen, flattened, sizing,
                     written, supports=not args.no_supports,
                     makerworld_ready=makerworld_ready, makerworld_note=makerworld_note,
                     preview=preview, instructions=instructions)
    return 0 if written.fits else EXIT_TOO_BIG_FOR_BED


def _report_to_human(ingested, report, repair_log, chosen, flattened, sizing,
                     written, *, supports=True, makerworld_ready=False,
                     makerworld_note=None, preview=None, instructions=None):
    print(f"{ingested.source_name}")
    if ingested.simplified_from:
        print(f"  simplified from {ingested.simplified_from / 1e6:.1f} million "
              f"triangles - far more detail than a printer can use")
    if ingested.scale_applied != 1.0:
        print(f"  read as {ingested.unit_guess}, scaled to millimetres")

    if repair_log and repair_log.changed:
        print("  fixed:")
        for step in repair_log.steps:
            print(f"    - {step.split(': ', 1)[-1]}")
    if repair_log and not repair_log.succeeded:
        print(f"  ! {repair_log.failure_reason}")

    if chosen:
        print(f"  orientation: {chosen.reason}")

    if flattened and flattened.note:
        print(f"  base: {flattened.note}")

    x, y, z = (round(v, 1) for v in written.size_mm)
    inches = max(written.size_mm) / 25.4
    print(f"  size: {x} x {y} x {z} mm  ({inches:.1f} in) - {sizing.comparison}")
    if sizing.warning:
        print(f"  ! {sizing.warning}")

    if report.min_wall_mm:
        print(f"  thinnest part: {sizing.min_wall_mm:.1f} mm")

    if not written.fits:
        print("  ! This is bigger than your printer's bed - "
              "shrink it to fit, or cut it into parts.")

    if supports:
        print("  supports: on, added automatically only where they're needed")

    if makerworld_note:
        print(f"  ! {makerworld_note}")
    elif makerworld_ready:
        print("  ready to upload to MakerWorld")

    print(f"  wrote {written.path}")
    print(f"    for {written.printer} in {written.filament}")
    if preview:
        print(f"    picture for the upload: {preview}")
    if instructions:
        print(f"    how to print it: {instructions.path}")
        print("    send all of these to the iPad together")


if __name__ == "__main__":
    raise SystemExit(main())
