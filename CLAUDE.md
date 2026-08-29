# CLAUDE.md — Print-Prep Service

**Start by reading [docs/HANDOFF.md](docs/HANDOFF.md).** It says where the
project stands and what changed against the spec. Then
[docs/transport-findings.md](docs/transport-findings.md) for the evidence.

Mesh in, print-ready Bambu project 3mf out, for someone whose only computer is an
iPad. Called **Handoff3D** (`web/src/brand.js` — it was EZslicer3D, which
promised the one thing this is not). Spec: `docs/print-prep-service-spec.md`.
Repo: `jjudic1/bambu-print-prep`. Live at `bambu-print-prep.vercel.app`.

**There is one product now, and it has no server.** The whole job — parse,
split, arrange, cut, render, write — happens in the browser. `/` and `/local`
are the same page; the second is a rewrite, kept because it is the address
people were given.

**The hosted app came down on 2026-08-28**, and with it the Cloud Run service.
Its front end (`web/src/App.jsx`, `Viewer.jsx`, `api.js`, `main.jsx`) is
retired in place — no HTML entry points at it, so none of it builds — and
`api/` (FastAPI) still runs locally and is still under test. **None of the
judgement half is lost**: `prep/` is untouched, still the best thing here, and
still runs from the command line. What went away is the hosting, not the code.
`web/src/main.jsx` has the three steps to bring it back.

## Running things

Python 3.12 in a project `.venv` — call it directly, don't activate:

```powershell
.venv\Scripts\prep.exe model.stl --size 80mm
.venv\Scripts\python.exe -m pytest tests\ -q
.venv\Scripts\python.exe bench\orient_bench.py --limit 60
```

`Prepare for printing.bat` is the drag-and-drop front end for the user.
`PREP_SLOW_TESTS=1` enables the Bambu Studio round-trip test.

The web app — this is the product, and it needs nothing else running:

```powershell
npm run dev --prefix web            # localhost:5174
```

The API is no longer deployed and the app no longer calls it. It still runs, and
its tests still pass, if you are working on the retired hosted front end:

```powershell
.venv\Scripts\python.exe -m uvicorn api.main:app --port 8141 --reload
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
- **The handoff page exists twice too**: `prep/handoff.py` and
  `web/src/local/handoff.js`, diffed by `tests/test_web_handoff.py`. The copy is
  not invented — it is the delivery loop someone actually walked — so treat a
  reworded step as a change to verified evidence, not to prose.
- **`/local` colour is a picture, not a print instruction.** It reaches the
  viewer and the plate photo. The container has no RGB and gives every object
  `extruder="1"`, so the printer uses whatever filament is loaded.
- **Render targets need `colorSpace: SRGBColorSpace` set explicitly.** three.js
  applies `outputColorSpace` when drawing to the canvas but not into a render
  target, so `readRenderTargetPixels` returns linear values and every plate
  picture came out about half as bright as the viewer next to it. Only the PNG's
  dimensions were ever asserted, so it went unnoticed.
- **The viewer's camera is solved, not placed** (`web/src/framing.js`). A
  distance fixed to the bed frames it for one shape of window only: narrowing a
  viewport narrows the horizontal field of view and nothing else, so the plate
  ran off the sides of a tall window and off the front of a short one. A phone
  lost it both ways at once. `web/framing-check.mjs` (run by
  `tests/test_view_framing.py`) projects the bed's corners for every bed against
  a spread of viewport shapes, and checks the bed fills the frame as well as
  fits in it -- "fits" is satisfied by standing far enough away.
- **Size the page in `dvh`, never `vh` or `height: 100%`.** iOS measures both
  against the screen with the address bar retracted, so a page sized in them is
  taller than the part you can see -- which is how an iPhone ended up with the
  controls over four fifths of the screen and the plate a strip at the top,
  while the same page on an iPad looked right.
- **The writer exists twice**: `prep/write3mf.py` and `web/src/make3mf.js`.
  `tests/test_web3mf.py` diffs them on every run — keep them in step.
- **The bottom cut does *not* exist twice.** `prep/base.py` searches for the
  smallest cut that gives a footprint and caps it at 8% of the height, because
  the server is guessing. `web/src/local/flatten.js` is not a port of it — the
  user picks the height, so there is no search and no ceiling beyond one that
  keeps the slider off a cut that leaves nothing standing. Do not "align" them.
  The JS one clips triangles and stitches its own cap; a cap that misses a loop,
  or fills a hole that should stay open, leaves both the bounding box and the
  volume looking right. `web/flatten-check.mjs` (run by
  `tests/test_local_flatten.py`) is the only thing that catches it — it checks
  every edge is still shared by exactly two triangles, as well as the volume and
  the area of the new face against arithmetic done by hand.
- **The app is no longer silent.** `web/src/metrics.js` sends a page view and
  four step names to Vercel Web Analytics. The model, its name and everything
  measured from it stay on the device — and the landing copy was narrowed from
  "nothing is uploaded anywhere" to say exactly that, because the old sentence
  stopped being true. If you add a counter, check the copy still is.
- **The catch-all rewrite must let `/_vercel/` and `/api/` through.** The
  counting script is served from `/_vercel/insights/script.js` and the one
  remaining function is at `/api/insights`; a plain `"/(.*)"` fallback answers
  either with a page of HTML — the script tag then parses as HTML and silently
  never counts anything. The source is `"/((?!_vercel/|api/).*)"`. Same trap
  the old API rewrite had. See `docs/deploy.md`.
- **`api/insights.js` is a Vercel function; `api/*.py` must never become one.**
  Vercel turns every file in a top-level `api/` directory into a function, and
  the FastAPI app lives in that same directory. `.vercelignore` excludes the
  Python — delete those lines and the build tries to make a serverless function
  out of `main.py`, on an image with no trimesh.
- **`/dashboard` is shut unless `INSIGHTS_KEY` is set** in the Vercel project's
  environment variables, and it needs Web Analytics switched on in the Vercel
  dashboard by hand — a 404 from every query means that checkbox, not a broken
  endpoint.
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
