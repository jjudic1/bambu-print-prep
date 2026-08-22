# Print-Prep Service

Takes an AI-generated or downloaded 3D mesh and returns a print-ready, correctly-sized,
correctly-oriented file — with no desktop software, no LAN setup, and no 3D-printing
vocabulary required of the user.

Full specification: [docs/print-prep-service-spec.md](docs/print-prep-service-spec.md)

## Status

**Phase B — the pipeline works end to end.**

**Easiest way to use it: drag a model onto `Prepare for printing.bat`.**
It asks which printer you have (once, then remembers), asks how big, and opens
the folder with the finished file. No terminal needed.

From a shell, the same thing:

```powershell
.venv\Scripts\prep.exe model.stl --size 80mm
```

| Milestone | State |
|---|---|
| A1 — write a Bambu-compatible project 3mf | automated checks pass; **awaiting one manual open in Bambu Studio** |
| A2 — does MakerWorld accept it? | **blocked**: needs a Bambu account, and A3 first |
| A3 — MakerWorld terms of service | **not started**, and it gates A2 |
| 1 — CLI pipeline | done |
| 2 — orientation beats naive | done: 90% vs 83%, breaking 2 poses in 60 |

See [docs/transport-findings.md](docs/transport-findings.md) for the evidence.
The transport question is still open, and it is still the thing that decides
whether this is a product.

## Layout

| Path | What |
|---|---|
| `docs/` | Spec, ideation notes, spike findings |
| `spikes/` | Phase A throwaway probes (kept for the record, not imported by `prep/`) |
| `prep/` | The pipeline: ingest → analyze → repair → size → orient → 3mf |
| `bench/` | Orientation solver benchmark against a local model corpus |
| `tests/` | pytest |

## Local setup

Python 3.12 is installed at `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`
(the bare `python` on PATH is the Microsoft Store stub — use `py` or the venv).

```powershell
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```
