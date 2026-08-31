# Handoff3D

**3D print from an iPad. No computer necessary.**

Handoff3D is a free, browser-based Bambu print preparation tool that creates
Bambu-compatible project 3MF files from an iPad, without a Windows or Mac
computer.

**→ [bambu-print-prep.vercel.app](https://bambu-print-prep.vercel.app)**

Bambu Studio is a desktop program for Windows, macOS and Linux. There is no
iPad version and iPadOS will not run one, so somebody whose only computer is an
iPad has no way to take a model they downloaded and turn it into something
their printer will accept. That gap is the whole reason this exists.

---

## What it does

Open the page in Safari, choose a model, and it writes a print-ready Bambu
project file into the Files app.

- Reads **STL, 3MF, OBJ and PLY**
- **Resize** to an exact measurement in millimetres, not a percentage
- **Stands each part up** in an orientation that will actually print
- **Flattens a curved bottom**, so a sculpted model has a face to stand on
- **Splits a model too large for the bed** across as many plates as it needs
- Writes a **Bambu project 3MF** that MakerWorld and Bambu Studio both accept
- Every current Bambu Lab machine — A1 mini, A1, P1P, P1S, P2S, X1, X1 Carbon,
  X1E, X2D, A2L, H2C, H2S, H2D, H2D Pro — in 0.2, 0.4, 0.6 and 0.8 mm nozzle
  versions, with bed sizes and settings taken from Bambu Studio's own profiles

No account, nothing to install, and **the model is never uploaded**: it is
read, measured and rewritten inside the browser tab, on the device. Page visits
are counted anonymously; the model, its name and everything measured from it
stay put.

## What it does not do

It is **not a full replacement for Bambu Studio**, and does not claim to be.
No hand-placed supports, no painted-on settings, no custom filament profiles,
and no multi-colour or AMS colour assignment — every object in the file is
assigned to a single extruder, so an AMS will print the result in whichever one
filament you select. It writes the standard settings for the machine and nozzle
you chose, and nothing beyond that. The slicing happens when the file is sent.

If you have a computer, use Bambu Studio. It is free and it is better at its
job than any web page. This is for the case where there is no computer to run
it on.

## Getting the file to the printer

No third-party app can hand a file to a Bambu printer — the machine takes work
from Bambu's own software and cloud. So: save to Files → upload to MakerWorld
as a **private** model → print from Bambu Handy. Clunky, once per model, and
no computer involved. Every file comes with a page of those steps saved beside
it.

---

## The interesting part: what a Bambu project 3MF actually requires

Most of the work here was finding out what makes a file the Bambu ecosystem
accepts. It is written up in [docs/transport-findings.md](docs/transport-findings.md);
the short version, all measured rather than reasoned about:

- **`Application` metadata must say `BambuStudio-<version>`.** Bambu Studio
  reads print settings only from a file that declares itself one of its own.
  Anything else gets *"invalid config, load geometry data only"* and **every
  setting is discarded** — a genuine Bambu config copied verbatim into our
  container was rejected too. It is that one string, nothing else.
- **The 3MF build transform is row-vector — emit the transpose.** Bounding
  boxes cannot detect the error. It prints mirrored.
- **Multi-plate has two silent traps.** Every geometry part must declare the id
  it is referenced by, and plates are regions of world space at 1.2× the bed,
  wrapping after two columns. Get either wrong and parts are dropped from a
  file that still opens.
- **OrcaSlicer is not a stand-in for Bambu Studio.** It accepted every one of
  the broken files above. Test against the program people actually run.
- **`bambu-studio.exe` is a free oracle.** It prints nothing to a console, but
  `--slice` still writes files and the G-code header echoes the config it used.

## How it runs

The whole job — parse, split, arrange, cut, render, write — happens in the
browser. There is no server, which is why it costs nothing to operate and why
the model never leaves the device.

There is also a Python half (`prep/`) that does the same job from a command
line, with the judgement features a browser cannot do: repair, analysis, and an
orientation solver benchmarked against a model corpus.

```powershell
npm run dev --prefix web                          # the app, on :5174
.venv\Scripts\prep.exe model.stl --size 80mm      # the CLI
.venv\Scripts\python.exe -m pytest tests\ -q      # the tests
```

The writer exists twice — `prep/write3mf.py` and `web/src/make3mf.js` — and
`tests/test_web3mf.py` diffs them on every run so they cannot drift.

## Layout

| Path | What |
|---|---|
| `web/` | The product: the on-device app, and the static pages |
| `prep/` | The Python pipeline: ingest → analyse → repair → size → orient → 3mf |
| `api/` | A retired FastAPI service, plus the one live analytics function |
| `docs/` | Spec, findings, deployment notes — start with `HANDOFF.md` |
| `tests/` | pytest, including harnesses that run the JavaScript |
| `bench/` | Orientation solver benchmark |
| `spikes/` | Throwaway probes, kept for the record |

## Whose job is whose

The tool prepares a file. It does not print it, and it has never printed it.

- **Checking the print is yours.** The settings come from Bambu's own profiles,
  but nobody has run your file on your machine. Watch the first few minutes and
  stop the printer if it looks wrong.
- **The printer is yours.** Damage to it, or to anything else, is yours and not
  this tool's.
- **A model may not go public unprinted.** MakerWorld allows a public listing
  only once you have printed the thing and can show a photo of it. Private is
  fine, and is what the instructions tell you to pick.
