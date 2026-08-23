# Print-Prep Service

Takes an AI-generated or downloaded 3D mesh and returns a print-ready, correctly-sized,
correctly-oriented file — with no desktop software, no LAN setup, and no 3D-printing
vocabulary required of the user.

Full specification: [docs/print-prep-service-spec.md](docs/print-prep-service-spec.md)

## The app (Milestones 3-4, in progress)

Two processes. The API wraps `prep/`; the PWA is a client and does no mesh work.

```powershell
.venv\Scripts\python.exe -m uvicorn api.main:app --port 8141 --reload
npm install --prefix web
npm run dev --prefix web
```

Then open **http://localhost:5174**. Vite proxies `/api` to 8141, so the app
calls the same paths in development and in production.

The viewer works in the printer's own frame -- millimetres, **Z up**, origin at
the front-left of the bed. trimesh writes GLB with no Y-up conversion (verified,
not assumed), so nothing is converted anywhere and the preview cannot mirror.

What the user can do so far: pick their printer and see the real bed, choose
between the solver's orientations or turn the model in quarter turns, and scale
against a slider that is hard-clamped to the build volume. Then the same three
files the launcher produces.

## Status

**Phase B — the pipeline works end to end.**

**Easiest way to use it: drag a model onto `Prepare for printing.bat`.**
It asks which printer you have (once, then remembers), asks how big, and opens
the folder with the finished file. No terminal needed.

You get three files, and they only work together -- send all of them to the iPad:

| File | What it is |
|---|---|
| `dragon-80mm.3mf` | the model, named so you can find it again |
| `dragon-80mm-preview.png` | the picture the upload asks for |
| `dragon-80mm - how to print this.html` | the steps, written for the iPad |

Open the last one on the iPad and follow it. It is self-contained -- no internet
needed to read it -- and it is the same steps every time, so keep it.

Every model also gets, by default:

- **a levelled bottom** if it was sculpted resting on a curve, so it stands on
  the plate instead of rocking on a point. The cut is the smallest one that
  gives a real footprint, capped at 8% of the model's height, and it tells you
  how much it took.
- **automatic supports** (`tree(auto)`), because Bambu's stock profiles ship
  with supports off and an overhanging model then prints into thin air. Auto
  means a model that needs none still gets none.

Turn either off with `--no-flatten` / `--no-supports`.

**Bambu Studio must be installed.** MakerWorld rejects our own 3mf container
even though Bambu Studio accepts it, so the finished file is handed back through
`bambu-studio.exe --export-3mf` (~0.5s) to produce one MakerWorld will take.
`--no-makerworld` skips that step; the file still opens fine in Bambu Studio.

From a shell, the same thing:

```powershell
.venv\Scripts\prep.exe model.stl --size 80mm
```

| Milestone | State |
|---|---|
| A1 — write a Bambu-compatible project 3mf | done |
| A2 — MakerWorld → Handy → printer | **done: prints from an iPad, no desktop** |
| A3 — MakerWorld terms of service | read; decision recorded |
| 1 — CLI pipeline | done |
| 2 — orientation beats naive | done: 90% vs 83%, breaking 2 poses in 60 |
| 5 — delivery works end to end | proven manually |
| 6 — non-technical user prints alone | **not started — the only one that proves anything** |

New here? Read [docs/HANDOFF.md](docs/HANDOFF.md) first, then
[docs/transport-findings.md](docs/transport-findings.md) for the evidence.

## Layout

| Path | What |
|---|---|
| `docs/` | Spec, ideation notes, spike findings |
| `spikes/` | Phase A throwaway probes (kept for the record, not imported by `prep/`) |
| `prep/` | The pipeline: ingest → analyze → repair → size → orient → 3mf → handoff |
| `bench/` | Orientation solver benchmark against a local model corpus |
| `tests/` | pytest |

## Local setup

Python 3.12 is installed at `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`
(the bare `python` on PATH is the Microsoft Store stub — use `py` or the venv).

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```
