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
- **Part of the bed is not printable, and only on some machines.** A P1P, a P1S
  and every X1 keep an 18 x 28 mm corner at the front left to purge and wipe the
  nozzle on (`bed_exclude_area` in the profile); the A1 family and the H2s have
  none. Arrange used to start its first row at (8, 8) -- inside it -- and the
  result is a file that opens, looks right on every screen, and is **refused at
  slice time on upload**. Nothing in the container or the bounding box says so.
  The zones are baked into `printers.json`, drawn on the plate by
  `PlateViewer.jsx`, and stepped around by `arrange()`. Bambu writes a second
  region by appending it to the same flat list of points, so `_exclude_areas`
  cuts the list into quads -- read as one polygon, a corner and the strip beside
  it become a self-crossing shape covering neither.
- Printer geometry is resolved from **vendored Bambu Studio profiles** in
  `prep/data/profiles` (not OrcaSlicer's — the two produce different files, and
  the accepted one used Bambu Studio's). Never hard-code a bed size.
- **A nozzle is a printer, not a setting.** "Bambu Lab P1S 0.6 nozzle" is its own
  machine profile with its own process, layer height and every line width; there
  is no 0.6 to apply to a P1S. So the two selects on the page are one value, and
  `web/src/local/printers.js` is what keeps them honest. The nozzle is *not*
  remembered — the machine is, and the nozzle starts at 0.4 every session,
  because it gets swapped for one print and swapped back, and an 0.8 mm file for
  a printer wearing a 0.4 is a machine pushing four times the plastic through a
  quarter of the hole.
- **Only the 0.4 profiles carry a "0.20mm Standard"** — a 0.2 mm nozzle cannot
  lay a 0.2 mm layer. `default_process` asks the machine profile for its own
  `default_print_profile` first; the name search under it silently returned
  whatever sorted first for every other nozzle.
- **`default_filament` matches on `filament_type`, not on the name.** It used to
  fall through to `options[0]` — every filament the printer knows, of every
  material — so a machine with no ABS handed back a PETG profile for a file that
  said ABS on it. The A1 family is open-frame and has no ABS at all; no 0.2 mm
  nozzle has TPU. It raises now, and the material picker offers what exists.
- **The baked profiles are two files and go stale together**: `printers.json` is
  the 13 KB index the pickers read, `printer-settings.json` the 4.8 MB of blobs,
  fetched on demand — static, it put 4 MB of JavaScript in front of first paint
  on an iPad. Both come out of one run of `spikes/export_web_profiles.py`, and
  `tests/test_web3mf.py` fails if half of an export is committed.
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
- **The file input must have no `accept` attribute.** iOS offers Photo Library
  and Take Photo or Video above Choose File, and the obvious fix -- naming the
  extensions -- is worse than the problem: WebKit does not implement extension
  specifiers, so the list resolves to no types and the Files browser greys out
  *every file*, the .3mf included. Measured on a real iPad; the app could not be
  used at all. MIME types do not hide the photo entries either, and `capture`
  opens the camera outright. The menu stays. `mesh.js` answers a photo by naming
  the entry that would have worked, and `tests/test_local_input.py` is there
  because none of this is visible from a desktop browser.
- **Size the page in `dvh`, never `vh` or `height: 100%`.** iOS measures both
  against the screen with the address bar retracted, so a page sized in them is
  taller than the part you can see -- which is how an iPhone ended up with the
  controls over four fifths of the screen and the plate a strip at the top,
  while the same page on an iPad looked right.
- **Added to the Home Screen, a link out of the app does not reach Safari.**
  It opens a stripped browser sheet inside the app instead, with no address
  bar and none of the user's session -- wrong for every outward link here,
  since all of them are places somebody signs in to. `x-safari-https:` is the
  way out: iOS hands the unknown scheme to the system and Safari opens a real
  tab. Measured on an iPad 2026-08-29. `web/src/local/outside.js` applies it,
  and only when `navigator.standalone` is true, because the scheme is dead
  everywhere else -- a tap that does nothing, with no error. The *saved*
  how-to-print page keeps plain `https`; it is read outside the app.
- **The same scheme is dead inside the sandboxed frame**, and that cost a
  round trip to find. A sandbox with no `allow-top-navigation` will not hand a
  scheme it does not know to the system, so rewriting the how-to-print page's
  MakerWorld link killed it outright -- a tap doing nothing, which reads as a
  broken app rather than a blocked navigation. The page in the frame keeps
  ordinary `https`; the way out to Safari is `Open MakerWorld` on the sheet's
  own bar, outside the sandbox. Lifting the sandbox is not the trade: it would
  let generated markup navigate the whole app.
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
- **Counting a step is `countStep`, and the ugly name is deliberate.** It was
  `note`, which is also what LocalApp calls its status line, so
  `const [note, setNote] = useState('')` shadowed the import and every call
  invoked a string. Nothing failed at build time; the app threw
  "R is not a function" *after* writing the user's file, and not one event was
  ever counted — which on a dashboard is indistinguishable from nobody turning
  up. `web/metrics-check.mjs` (run by `tests/test_metrics.py`) fails if any file
  redeclares a name it imports from `metrics.js`.
- **The app is a blank page to anything that does not run JavaScript**, which
  is most of what feeds an AI answer -- GPTBot, ClaudeBot, PerplexityBot and
  OAI-SearchBot fetch HTML and stop. So there are six static pages in
  `web/public/`, generated by `web/build-guides.mjs` from `web/guides.mjs`,
  each answering one question people actually type, and `web/index.html`
  carries the landing copy as real markup inside `#root` that React clears on
  mount. **The copy on those pages breaks the §6 jargon ban on purpose**:
  "slice" and "STL" are the search terms, and a page avoiding them cannot be
  found by anyone looking for them. Nothing in `web/src/` is affected, and the
  app's own strings still obey the rule.
- **The generated pages are committed, not built on deploy**, for the same
  reason the printer profiles are: copy that only exists inside a build step is
  copy nobody proof-reads. `node build-guides.mjs --check` is what
  `tests/test_guides.py` runs, so an edit to the generator without a rerun
  fails the suite instead of shipping the old words.
- **A slug is written down in four places** -- the generator, the committed
  file, the fallback markup in `index.html`, and `GUIDES` in `LocalApp.jsx`.
  Renaming one and not the others is not a visible 404: the catch-all rewrite
  answers an unknown path with the app, so a dead link reads as a link that
  did nothing. `tests/test_guides.py` compares all four.
- **`cleanUrls: true` is load-bearing, and `x-safari-https:` must stay away
  from these links.** The pages are `.html` files linked without the
  extension; `cleanUrls` is what resolves that, in the filesystem step, ahead
  of the catch-all. And the guide links are same-origin, so they take plain
  root-relative paths -- `outward()` is for getting *out* of a Home Screen app,
  and applying it here would throw the reader into a second browser on iOS and
  do nothing at all everywhere else. `web/outside-check.mjs` allows the one
  exemption by name and checks the list really is root-relative.
- **The catch-all rewrite must let `/_vercel/` and `/api/` through.** The
  counting script is served from `/_vercel/insights/script.js` and the one
  remaining function is at `/api/insights`; a plain `"/(.*)"` fallback answers
  either with a page of HTML — the script tag then parses as HTML and silently
  never counts anything. The source is `"/((?!_vercel/|api/).*)"`. Same trap
  the old API rewrite had. See `docs/deploy.md`.
- **The contact form is the one thing that sends what a user typed.**
  `api/contact.js` mails it through Resend; nothing about the model goes with
  it, and the address it lands at is only ever in the environment, never in the
  bundle. It is **shut unless `RESEND_API_KEY` is set** -- a form that accepts a
  message it cannot send is worse than one that says it is off. The subject is
  written server-side (`[Handoff3D] Feature request from Jo`) because that is
  the whole feature: obviously from the app before it is opened. The brand and
  the three topics are each written twice -- `api/contact.js` cannot import the
  app's ESM -- and `tests/test_contact.py` fails when the copies drift. Resend's
  shared sender only delivers to the address the Resend account itself was
  opened with; anywhere else needs a verified domain and `CONTACT_FROM`.
- **`api/insights.js` is a Vercel function; `api/*.py` must never become one.**
  Vercel turns every file in a top-level `api/` directory into a function, and
  the FastAPI app lives in that same directory. `.vercelignore` excludes the
  Python — delete those lines and the build tries to make a serverless function
  out of `main.py`, on an image with no trimesh.
- **A `teamId` breaks the Web Analytics API on a personal Vercel account.**
  Measured 2026-08-28: the same token, same project, returns 200 with no
  `teamId` and **403 "Not authorized"** with the correct one out of
  `.vercel/project.json`. The read API is *not* gated to a paid plan -- hobby
  reads fine. `api/insights.js` retries without the team on any 403, because a
  403 there reads exactly like a badly scoped token and sent one person off
  creating tokens that were never the problem.
- **Vercel snaps the analytics window to whole days, and the two endpoints
  snap it opposite ways.** Measured 2026-08-29 by reading back the `query`
  each one echoes: `visits/aggregate` rounds `until` **up** to the next
  midnight, `visits/count` truncates it **down** to the last one. So an
  `until` of "now" asked the count query for a window ending where today
  began, and `/dashboard` showed 0 visitors and 0 page views beside a chart,
  built from the same request, showing 43. Nothing about it looked like a date
  bug -- right token, right scope, documented response shape, documented field
  names, and a real number Vercel meant. Ask for whole UTC days at both ends.
- **The hit count on the visits dataset is `pageviews`, not `count`.** The
  docs say `count`, and `Number(undefined) || 0` turned every table's hit
  count into a confident zero for a week. `api/insights.js` now reads either.
- **`GET /api/insights?raw=1`** (same `INSIGHTS_KEY`) returns what Vercel
  actually said next to the URL it was asked. Reach for it before theorising:
  both bugs above were invisible from the reshaped output and each cost a
  deploy to guess at. No secret is in it -- the token travels in a header.
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
