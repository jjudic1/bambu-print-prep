# Handoff — read this first

**Date:** 2026-08-24 · **Repo:** https://github.com/jjudic1/bambu-print-prep ·
**Tests:** 284 passing · **Live:** https://bambu-print-prep.vercel.app

The spec is [print-prep-service-spec.md](print-prep-service-spec.md). This
document is the delta: what has been proven, what it cost, and what to do next.
Read this before the spec — several of the spec's assumptions have been tested
and most of the important ones changed. The evidence trail is
[transport-findings.md](transport-findings.md); read that second.

The product is called **EZslicer3D** — "3D print… no computer necessary".

---

## The headline

**There are two working products, and the smaller one is the more interesting.**

1. **The hosted app** (`/`) — the full pipeline: repair, analysis, the
   orientation solver, sizing, the container. PWA on Vercel, Python API on Cloud
   Run. Works.
2. **The on-device page** (`/local`) — no server at all. Parses, arranges,
   renders and writes the container in the browser. **MakerWorld accepts its
   output**, verified by a real upload.

That second result is the one that matters, because every cost and scaling
problem this project has belongs to the server. Read "The strategic position"
before planning anything.

**Milestone 6 — someone non-technical prints something without you in the room —
is still the only milestone that proves anything, and still has not been
attempted.**

---

## What exists

```
prep/          the Python pipeline
  ingest       guess units, normalise to mm, offer decimation if huge
  analyze      MeshReport: watertight, holes, thin walls, overhangs (§5.2)
  repair       the §5.3 ladder, honest failure when it cannot
  orient       the solver (§5.5) -- the moat
  base         level a curved bottom so it stands (§1)
  size         scale + plain-language comparison, clamped to the bed (§6.2)
  write3mf     the container MakerWorld accepts
  render       plate pictures, in numpy -- no GL, no display
  handoff      the §6.5 how-to page that travels with the file
  bambu        the Bambu Studio rewrite -- NO LONGER USED by default

api/           FastAPI over prep/: main, limits, geometry
web/           two Vite entries sharing one writer
  index.html   the hosted app -- talks to /api
  local.html   the on-device page -- talks to nothing
```

| Path | What |
|---|---|
| `Prepare for printing.bat` | Drag a model onto it. The original desktop front end. |
| `web/src/make3mf.js` | The container writer, in JavaScript. Port of `prep/write3mf.py`. |
| `web/src/local/` | The no-server page: reader, splitter, arranger, plate viewer |
| `bench/orient_bench.py` | Orientation solver measured against a real corpus |
| `spikes/` | Throwaway probes, kept because they document how things were proven |
| `docs/deploy.md` | Hosting, costs, and what the live deploy measured |

Run it:

```powershell
.venv\Scripts\python.exe -m pytest tests\ -q
.venv\Scripts\python.exe -m uvicorn api.main:app --port 8141 --reload
npm run dev --prefix web            # localhost:5174 and /local.html
```

---

## Spec assumptions that changed

1. **§2A "do not pre-slice" — confirmed.** MakerWorld re-slices at print time.
2. **§2A "3mf produced by Bambu Studio" — resolved, and the binary is gone.**
   MakerWorld refused our first container; the differences were closed in our own
   writer and it now **accepts ours** (§A2b). `--bambu-rewrite` keeps the old path
   reachable. Consequence: no slicer is needed to host this.
3. **§2A's fatal risk is real after all.** A render is *not* accepted as the
   gallery image — MakerWorld rejects it as "not a real photo". Any real photo is
   accepted, and §6.5 step 4 now says so. **This is the account holder's decision,
   and A3 was scoped to one person's low-volume private listings, not a service
   telling every user to do it.** Re-read A3 before it scales.
4. **§4's architecture is half wrong.** The mesh work does not need a server.
5. **§10's "the orientation solver is the moat" — correct, and now the
   bottleneck.** 19 s for a 20k-face mesh on Cloud Run.

---

## The strategic position, and why it changed

Prompted by [BumpMesh](https://github.com/CNCKitchen/stlTexturizer) (CNC
Kitchen), which does mesh displacement entirely client-side and whose 3MF exports
**MakerWorld refuses** — for exactly the reason our first container was refused.
Closing that gap is the thing this project already knows how to do.

So the writer was ported to JavaScript, and it works:

- `prep/write3mf.py` imports **only stdlib and numpy**. No trimesh, no scipy.
- Of fifteen container members, six are static strings, four are small templates,
  five are pictures, and one is a settings blob that resolves the same way every
  time — baked to **38 KB gzipped** for 14 printers × 4 materials by
  `spikes/export_web_profiles.py`.
- The port produces a **byte-identical** container (`tests/test_web3mf.py` diffs
  both writers on every run), and **MakerWorld accepted it**.

**What this means for the money.** Every cost problem in `deploy.md` is the
server's: ~$130/month at steady use, cold starts, the queue, `--max-instances 1`,
tmpfs job loss, rate limits, CPU throttling. The on-device path has none of them,
is a static file on a CDN, and inverts the failure condition — **popularity
becomes free instead of fatal**. It also allows the claim BumpMesh makes: the
model never leaves the device.

**What does not port:** repair, analysis and the orientation solver need real
mesh libraries. They are the judgement half. The transport half — the container —
is the part nobody else has.

---

## What is live

| | URL | Notes |
|---|---|---|
| PWA | `bambu-print-prep.vercel.app` | Vercel, free, auto-deploys on push |
| On-device | `/local` | Same deploy, second Vite entry, no API |
| API | `print-prep-api-…us-central1.run.app` | Cloud Run, project `bambu-print-prep` |

`vercel.json` rewrites `/api/*` to Cloud Run, so the browser sees one origin and
CORS never applies in production. **The API rewrite must stay ahead of the SPA
catch-all** — with the fallback first, every API call returns 200 and a page of
HTML, and the client fails parsing it as JSON.

gcloud is installed. It needs `CLOUDSDK_PYTHON` pointed at its bundled
interpreter or every command dies with "Python was not found" — see `deploy.md`.

---

## The delivery loop, as actually performed

Per print; the account is set up once.

1. Save the `.3mf` to Files on the iPad.
2. Safari → MakerWorld → Upload → choose the file.
3. **Add a photo.** MakerWorld will not take the render. Any real photo gets
   through; swap in a photo of the real object after it prints.
4. Set visibility **Private**, give it a title, Publish.
5. Bambu Handy → profile picture, top left → **3D Models** → newest at top.
   *(Fallback: Me tab → slide the row right → My Creations.)*
6. Prints like anything else in Handy.

Every hosted run writes three files that only work together — the model, its
picture, and a self-contained "how to print this" page (`prep/handoff.py`). Send
all three to the iPad.

**Still unmeasured:** where a non-technical person actually stalls.

---

## The orientation solver, and how to not break it

`bench/orient_bench.py` measures against orientations real people chose, using
the build transforms in the local 3mf corpus (`~/Downloads/*.3mf`) as labels.

```
agrees with the creator : 54/60 (90%)
naive "leave it alone"  : 50/60 (83%)
we broke a right pose   : 2      <-- the number that matters
```

**83% of real models arrive already correctly oriented.** Plain agreement hides
harm, so the benchmark also counts poses that were right and got rotated wrong.
Three corrections got it here:

- Sub-scores are **absolute ratios**, never min-max normalised across candidates.
- Contact area is a **threshold, not a gradient**. Scored linearly, a 3DBenchy
  balanced on 43 mm² of hull beat the upright pose it is designed for.
- **Yaw is aligned** to the minimum-area footprint.

**Re-run the benchmark after any change here.**

---

## Gotchas that cost real time

**The container**

- **The 3MF build transform is row-vector** — emit the *transpose*. Bounding
  boxes cannot tell the two apart; backwards prints mirrored. The JS reader
  (`read3mf.js`) has the same trap in reverse and is checked by **signed volume**,
  because a mirror preserves the bounding box.
- **`Application` must say `BambuStudio-<version>`** or every setting is dropped.
- **Every geometry part must declare the id it is referenced by.**
  `object_2.model` needs `<object id="3">`, not `id="1"`. All-1 makes Bambu Studio
  quietly reassign every object to plate 1.
- **Plates are regions of world space.** Stride is **1.2× the bed** and the wrap
  column is **two**. Get it wrong and objects land on no plate and are **silently
  dropped** — the file still opens.
- **Orientation is per part, size is not, and that asymmetry is deliberate.**
  `base` is the model's own pose and the frame the size sliders measure in;
  `spin`/`yaw` are per part on top of it. Scaling per part would make "make it
  80 mm" meaningless once an assembly has been cut up, and measuring size in any
  frame but `base` puts Across/Deep/Tall on the wrong axes the moment anything
  is tipped -- which is what it used to do. `web/parts-check.mjs` pins both.
- **Vendored profiles decide the output.** OrcaSlicer's tree yields 326 settings
  and an X1C filament for a P1S; Bambu Studio's yields 487 and the right one. The
  accepted file used Bambu Studio's, so that is what `prep/data/profiles` holds.
- **Bambu Studio is the free oracle.** `--slice` / `--export-3mf` write files and
  `result.json` carries a real error string. It diagnosed both plate traps.
- **OrcaSlicer is not a stand-in.** It accepts files Bambu Studio rejects.

**The browser**

- **`accept` on a file input makes an iPad refuse every file.** iOS resolves it
  against UTIs and none of `.stl` / `.3mf` / `.obj` has one, so Files greys out
  *everything*. Never add it back.
- **trimesh exports GLB with no NORMAL attribute**, so a lit material renders flat
  black. `computeVertexNormals()` on load.
- **Strip every attribute but position before `mergeVertices`.** Loader normals
  differ across a hard edge, so nothing welds, and the splitter then reports a
  cube as six separate parts. `readModel` does this; anything feeding it
  geometry must too.
- **Never defer work with `requestAnimationFrame`.** A tab that is not
  compositing -- backgrounded, or the preview pane here -- never runs the
  callback, so the UI sticks on its busy label forever. Use a timer.
- **three.js's 3MF loader cannot follow `p:path`**, so it fails on every Bambu
  Studio project file. We use our own reader.
- **Cloud Run throttles CPU outside request processing.** Work scheduled after the
  response never runs. `--no-cpu-throttling` is required and it changes billing to
  instance lifetime.
- The preview pane cannot composite WebGL here — verify with offscreen render
  targets and `readRenderTargetPixels`, not screenshots.

**Process**

- **No broad `except`.** Three real bugs hid in swallowed exceptions.
- **Don't score corpus files our own tool wrote.** `write3mf` stamps
  `Origin: print-prep` so harvests can exclude them; `is_genuine()` checks it.
- **Verify what the user looks at, not only the numbers.** The viewer rendered a
  black silhouette for days while every bounding-box assertion passed, and the
  plate photographs were taken from underneath for longer than that.
- `chcp 65001` in a `.bat` silently breaks `set /p`.

---

## What to do next

1. **Milestone 6 — a real user test.** Still the only milestone that proves
   anything. Someone non-technical, an iPad, no help. Watch where they stall; fix
   nothing until you have watched it fail once.
2. **Profile `prep/orient.py`.** 19 s for a 20k-face mesh is the bottleneck for
   everything: the user's patience, the Cloud Run bill, and whether the solver
   could ever run in the browser. It already works on a decimated proxy, so that
   is slower than it should be.
3. **Decide what the hosted app is for.** If the on-device page handles
   transport, the server exists only for repair, analysis and orientation. That is
   a product decision, not a cleanup.
4. **The donation tag is built and off.** One constant in `web/src/support.js`
   turns it on in both places. Empty is deliberate: a tag pointing at a dead URL
   is worse than no tag.

**Known gaps in `/local`:**

- Only the **active plate** gets a true render; the others reuse it.
- No repair, no analysis, no orientation solver.
- The split is **connected components only**. It separates an assembly that
  already comes apart; it cannot *cut* a model that is one piece, which is the
  other half of "too big for the bed".

**Do not:**

- Automate the MakerWorld upload. It means holding Bambu credentials (§2A).
- Spend uploads on untested guesses. Bambu Studio answers most questions free.
- Ship `web/src/data/printers.json` without answering the licensing question — it
  is 1.4 MB of vendored Bambu Studio profile data.

---

## Money, and the terms

**Hosting.** Vercel is free. Cloud Run's always-free tier is real — 2M requests,
180,000 vCPU-seconds and 360,000 GiB-seconds a month in
us-central1/us-east1/us-west1 — but `--no-cpu-throttling` bills instance lifetime
rather than request time, so the unit is "a period of activity", on the order of
**a hundred sessions a month free**. A budget alert is set at $1. Fly.io has had
no free tier since October 2024.

**Terms.** A dedicated MakerWorld account was created for this. The clauses are
quoted in `transport-findings.md` §A3 and the account holder's decision is that a
private listing for one's own printing is within them. **That reasoning was
scoped to one person at low volume.** A free public service — many users, each
told to satisfy the photo check with an unrelated image — is a different posture,
and "Content Flooding" names repeated near-identical uploads on an account with
no history to absorb a misread.
