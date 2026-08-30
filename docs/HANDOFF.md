# Handoff — read this first

**Date:** 2026-08-28 · **Repo:** https://github.com/jjudic1/bambu-print-prep ·
**Tests:** 300 passing · **Live:** https://bambu-print-prep.vercel.app

The spec is [print-prep-service-spec.md](print-prep-service-spec.md). This
document is the delta: what has been proven, what it cost, and what to do next.
Read this before the spec — several of the spec's assumptions have been tested
and most of the important ones changed. The evidence trail is
[transport-findings.md](transport-findings.md); read that second.

The product is called **EZslicer3D** — "3D print… no computer necessary".

---

## The headline

**There were two working products. As of 2026-08-28 there is one, and it is the
smaller one.**

The on-device page is now the whole product, served at `/` and at `/local`
(same page, a rewrite). No server at all: it parses, splits, arranges, cuts,
renders and writes the container in the browser. **MakerWorld accepts its
output**, verified by a real upload.

**The hosted app and its Cloud Run service are gone** — deliberately, not
because anything about them failed. They worked. Every cost and scaling problem
this project had belonged to that server, and the on-device page turned out to
do the job people actually wanted. Read "The strategic position" for the
argument; it is the same one, now acted on.

**What did not go away is the judgement half.** `prep/` is untouched — the
repair ladder, the analysis, and the orientation solver that `docs` calls the
moat — and it still runs from the command line and still has every test. The
hosted front end is retired in place (`web/src/App.jsx` and its entry, which no
HTML file points at), and `api/` still runs locally under test. `web/src/main.jsx`
has the three steps to put it all back. Retired, not deleted: the argument was
strategic, and strategic arguments get revisited.

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
  insights     the usage numbers, read back out of Vercel. Not pipeline code;
               it is here only because a browser cannot hold a Vercel token
web/           two Vite entries, one of them the product
  index.html      the app. Does the whole job in the browser; talks to nothing
                  but Vercel Web Analytics, for a page view and four step names
  dashboard.html  /dashboard -- who is turning up, behind a key
  src/App.jsx     RETIRED: the hosted front end. No entry points at it
```

| Path | What |
|---|---|
| `Prepare for printing.bat` | Drag a model onto it. The original desktop front end. |
| `web/src/make3mf.js` | The container writer, in JavaScript. Port of `prep/write3mf.py`. |
| `web/src/local/` | The no-server page: reader, splitter, arranger, plate viewer |
| `web/src/local/printers.js` | Which machine, and which nozzle is in it. 0.4 mm every session |
| `web/src/framing.js` | Where the camera goes, solved from the shape of the viewer |
| `web/src/local/flatten.js` | The bottom cut: clips the triangles, stitches the cap |
| `web/src/metrics.js` | The four funnel events, and the one place they are named |
| `bench/orient_bench.py` | Orientation solver measured against a real corpus |
| `spikes/` | Throwaway probes, kept because they document how things were proven |
| `docs/deploy.md` | Hosting, costs, and what the live deploy measured |

Run it:

```powershell
.venv\Scripts\python.exe -m pytest tests\ -q
.venv\Scripts\python.exe -m uvicorn api.main:app --port 8141 --reload
npm run dev --prefix web            # localhost:5174
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
  time — baked by `spikes/export_web_profiles.py`. It was **38 KB gzipped** for
  14 printers × 4 materials; offering all four nozzle sizes (2026-08-29) made it
  56 printers and **109 KB**, at which point it stopped riding in the bundle and
  became a second file fetched when a file is asked for.
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
| The app | `bambu-print-prep.vercel.app` and `/local` | One page, both addresses. Vercel, free, auto-deploys on push |
| Usage | `/dashboard` | Who is turning up. Behind a key; dark until it is set |
| Function | `/api/insights` | Reads the usage numbers back. No dependencies |
| Function | `/api/contact` | The Contact us sheet's mail, through Resend. Dark until `RESEND_API_KEY` is set |

**Nothing runs on Google any more.** The Cloud Run service was deleted on
2026-08-28 and its URL 404s. About 1 GB of container images is still sitting in
Artifact Registry (`cloud-run-source-deploy`) — a few pence a month, and not
needed to redeploy, since `--source .` rebuilds from this repo.

**The catch-all rewrite must let `/_vercel/` and `/api/` through**, which is the
same trap the old `/api/*` -> Cloud Run rewrite had in reverse: with the SPA
fallback catching them, the counting script and the insights function both come
back as a page of HTML with a 200, and nothing errors -- the script simply never
counts. The source is `"/((?!_vercel/|api/).*)"`.

**`.vercelignore` is load-bearing.** Vercel makes a serverless function out of
every file in a top-level `api/` directory, and that directory is also the
FastAPI app. Without it, the build tries to deploy `main.py` on an image with no
trimesh.

**There are two functions now, not one.** `api/contact.js` is behind the
Contact us link on the landing screen and at the bottom of the arrange panel:
a topic, a message and an optional name and address, mailed to the support
address through Resend. It holds nothing, same as the other one -- a POST in,
one email out. The reason it exists at all rather than the browser posting
straight to a form service is that both the address and the sending key stay
off the page. It is shut until `RESEND_API_KEY` is set, and says so; the setup,
including the trap about which address Resend's shared sender will deliver to,
is in `deploy.md`.

gcloud is installed, and still needs `CLOUDSDK_PYTHON` pointed at its bundled
interpreter or every command dies with "Python was not found" — see `deploy.md`.
It is only needed now if the API is ever deployed again.

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

### What profiling found (2026-08-25)

The "19 s for a 20k-face mesh" in the old plan pointed at the wrong variable.

- **19 s was Cloud Run, not the algorithm.** The same class of mesh solves in
  **1.4-5.2 s** on this desktop. Cloud Run is roughly 8x slower and CPU-throttled.
- **Candidate count drives it, not face count.** A 19k-face AMS mount produced
  **203 candidates** and took 2.4 s; a 59k-face model produced 72 and took 1.4 s.
  The hull's facet count is the variable, and the docstring's "~30 candidates"
  is wrong for anything machined.
- **Stage one was not doing geometry, it was thrashing a cache.** It copied the
  mesh and transformed it per candidate, and each transform invalidated
  trimesh's cache so normals, areas and centroids were re-derived every time.
  Every stage-one metric depends only on *z after rotation*, which is one dot
  product with one row of R, and areas are rotation-invariant outright.
  Rewritten that way: **~8x on stage one.**
- **Then the bottleneck moved to `_stress_index`** -- up to **96%** of solve(),
  building shapely polygon hierarchies (2951 `repair_invalid` calls on a pin-art
  model) to read back one number. Replaced with a contour integral over the
  triangles crossing the plane, **8-40x faster and equal to 8e-9** -- but only on
  a watertight mesh, so it falls back to slicing otherwise. About **45%** of the
  corpus takes the fast path.
- **Net: 2.1x end to end, and the benchmark did not move** -- 54/60, naive
  50/60, broke 2, identical to before. Median solve **0.34 s**.

Two traps found on the way, both pre-existing:

- **The 45 degree overhang threshold was a knife edge.** A face at exactly 45
  degrees is the canonical printable overhang, but rotation moves normals by
  ~1e-12 and any machined part is full of exact 45 degree chamfers -- one corpus
  model had **109 faces within 5e-13 of the threshold**, half a percent of its
  area, landing on whichever side rounding put them. `OVERHANG_EPSILON` now puts
  them firmly on the printable side.
- **The obvious shortcut for section area is wrong.** Summing a signed shoelace
  over trimesh's own section loops is 60-200% out, because those loops are not
  consistently wound. The orientation has to come from the surface normal.

**Still open:** 203 candidates is the remaining lever and nobody has measured
what capping it costs in accuracy.

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
   **The protocol is written: [milestone-6-user-test.pdf](milestone-6-user-test.pdf)**
   — five pages, printed and written on, not read off a screen. It names eight
   predicted stall points so they get noticed rather than reconstructed
   afterwards, and two of them are new and deliberate — the three-file output,
   and colour that is only a picture. The words live in
   [make_user_test_pdf.py](make_user_test_pdf.py); edit there and re-run it.
2. ~~**Profile `prep/orient.py`.**~~ **Done (2026-08-25)** -- see "What
   profiling found". 2.1x faster, benchmark unmoved, and the 19 s figure turned
   out to be Cloud Run rather than the algorithm. The remaining lever is the
   candidate count.
3. **Decide what the hosted app is for.** If the on-device page handles
   transport, the server exists only for repair, analysis and orientation. That is
   a product decision, not a cleanup.
4. **The donation tag is built and off.** One constant in `web/src/support.js`
   turns it on in both places. Empty is deliberate: a tag pointing at a dead URL
   is worse than no tag.

**Known gaps in `/local`:**

- Only the **active plate** gets a true render; the others reuse it.
- No repair, no analysis, no orientation solver.
- **Colour is a picture, not a print instruction.** Per-part colour reaches the
  viewer and the plate photo, and nothing else: the container gives every object
  `extruder="1"` and carries no RGB anywhere. An AMS user who wants parts printed
  in different filaments needs per-object extruder indices, which nobody has
  written or tested against Bambu Studio.
- The split is **connected components only**. It separates an assembly that
  already comes apart; it cannot *cut* a model that is one piece, which is the
  other half of "too big for the bed".

**Do not:**

- Automate the MakerWorld upload. It means holding Bambu credentials (§2A).
- Spend uploads on untested guesses. Bambu Studio answers most questions free.
- Ship `web/src/data/printer-settings.json` without answering the licensing
  question — it is 4.8 MB of vendored Bambu Studio profile data (1.4 MB before
  the nozzle sizes).

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
