# CLAUDE.md — Print-Prep Service

**Start by reading [docs/HANDOFF.md](docs/HANDOFF.md).** It says where the
project stands and what changed against the spec. Then
[docs/transport-findings.md](docs/transport-findings.md) for the evidence.

Mesh in, print-ready Bambu project 3mf out, for someone whose only computer is an
iPad. Spec: `docs/print-prep-service-spec.md`. Repo: `jjudic1/bambu-print-prep`.

## Running things

Python 3.12 in a project `.venv` — call it directly, don't activate:

```powershell
.venv\Scripts\prep.exe model.stl --size 80mm
.venv\Scripts\python.exe -m pytest tests\ -q
.venv\Scripts\python.exe bench\orient_bench.py --limit 60
```

`Prepare for printing.bat` is the drag-and-drop front end for the user.
`PREP_SLOW_TESTS=1` enables the Bambu Studio round-trip test.

## Facts that are easy to get wrong

- **Bambu Studio and OrcaSlicer are both installed and both scriptable.**
  `bambu-studio.exe` prints nothing to a console but `--slice` / `--export-3mf`
  still write files, and the G-code header echoes the config used — that is the
  only reliable oracle for "did Bambu Studio accept our settings".
- **OrcaSlicer is not a stand-in for Bambu Studio.** It accepts files Bambu
  Studio rejects outright. Test against Bambu Studio.
- **`Application` metadata must say `BambuStudio-<version>`** or Bambu Studio
  discards every setting in the file with "invalid config, load geometry only".
- **MakerWorld is stricter still** and refuses our container even though Bambu
  Studio accepts it, so the pipeline ends by rewriting through Bambu Studio
  (`prep/bambu.py`). Producing MakerWorld-ready output requires it installed.
- **The 3MF build transform is row-vector**: emit the transpose. Bounding boxes
  cannot detect the error; it prints mirrored.
- Printer geometry comes from resolving OrcaSlicer's vendor profiles
  (`prep/profiles.py`). Never hard-code a bed size. Process and filament profiles
  are selected by `compatible_printers`, not by name.

## Working rules for this project

- **Measure, don't assume.** Every wrong turn here came from reasoning about a
  slicer instead of running it. The corpus in `~/Downloads/*.3mf` and the two
  slicer CLIs make almost everything empirically testable.
- **Never score our own output as ground truth** — a file sent to the user ended
  up in Downloads and polluted a corpus scan.
- **No broad `except`.** Three real bugs hid in swallowed exceptions.
- **Re-run `bench/orient_bench.py` after touching `prep/orient.py`.** Watch the
  "we broke a right pose" number, not just agreement.
- **Never automate the MakerWorld upload** (§2A). It means holding the user's
  Bambu credentials.
- **Don't spend the user's MakerWorld uploads on untested guesses** — the account
  is new and each structural experiment costs a real upload.
- User-facing strings carry no jargon: no mesh, manifold, normals, infill,
  gcode, slice (§6). Keep output ASCII — the Windows console mangles the rest.
