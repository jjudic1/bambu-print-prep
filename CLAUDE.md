# CLAUDE.md — Print-Prep Service

**Start by reading [docs/HANDOFF.md](docs/HANDOFF.md).** It says where the
project stands and what changed against the spec. Then
[docs/transport-findings.md](docs/transport-findings.md) for the evidence.

Mesh in, print-ready Bambu project 3mf out, for someone whose only computer is an
iPad. Called **EZslicer3D**. Spec: `docs/print-prep-service-spec.md`. Repo:
`jjudic1/bambu-print-prep`. Live at `bambu-print-prep.vercel.app`, with a
no-server page at `/local` that does the whole job in the browser.

## Running things

Python 3.12 in a project `.venv` — call it directly, don't activate:

```powershell
.venv\Scripts\prep.exe model.stl --size 80mm
.venv\Scripts\python.exe -m pytest tests\ -q
.venv\Scripts\python.exe bench\orient_bench.py --limit 60
```

`Prepare for printing.bat` is the drag-and-drop front end for the user.
`PREP_SLOW_TESTS=1` enables the Bambu Studio round-trip test.

The web app and API:

```powershell
.venv\Scripts\python.exe -m uvicorn api.main:app --port 8141 --reload
npm run dev --prefix web            # localhost:5174, and /local.html
```

Deploying, and the gcloud CLOUDSDK_PYTHON trap: `docs/deploy.md`.

## Facts that are easy to get wrong

- **Bambu Studio and OrcaSlicer are both installed and both scriptable.**
  `bambu-studio.exe` prints nothing to a console but `--slice` / `--export-3mf`
  still write files, the G-code header echoes the config used, and
  `result.json` carries a real error string. It is the free oracle for almost
  every question about the container — use it before spending a MakerWorld
  upload.
- **OrcaSlicer is not a stand-in for Bambu Studio.** It accepts files Bambu
  Studio rejects outright. Test against Bambu Studio.
- **`Application` metadata must say `BambuStudio-<version>`** or Bambu Studio
  discards every setting in the file with "invalid config, load geometry only".
- **MakerWorld now accepts our own container** (2026-08-23) — including one
  written entirely in the browser. `prep/bambu.py` is behind `--bambu-rewrite`
  and no slicer is needed to produce or host output.
- **The 3MF build transform is row-vector**: emit the transpose. Bounding boxes
  cannot detect the error; it prints mirrored. The JavaScript reader has the
  same trap in reverse — check it by signed volume.
- **Multi-plate has two silent traps**: every geometry part must declare the id
  it is referenced by, and plates are regions of world space at 1.2x the bed
  wrapping after two columns. Get either wrong and parts are dropped from a file
  that still opens. See `docs/transport-findings.md` §A2d.
- Printer geometry is resolved from **vendored Bambu Studio profiles** in
  `prep/data/profiles` (not OrcaSlicer's — the two produce different files, and
  the accepted one used Bambu Studio's). Never hard-code a bed size.
- **The writer exists twice**: `prep/write3mf.py` and `web/src/make3mf.js`.
  `tests/test_web3mf.py` diffs them on every run — keep them in step.
- **`/local` orients per part but sizes as one model.** `base` is the whole
  model's pose *and* the frame Across/Deep/Tall are measured in; each part
  carries its own `spin`/`yaw` on top. Measure size in any other frame and
  the sliders scale the wrong axis the moment anything is tipped.
  `web/parts-check.mjs` (run by `tests/test_local_parts.py`) checks the
  split, the poses and the layout by signed volume as well as size — a
  mirror leaves the bounding box alone.

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
