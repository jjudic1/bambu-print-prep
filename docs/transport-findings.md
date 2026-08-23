# Transport findings

Spec §2 requires this document before any UI work. It records what actually
happens when we try to get a file onto a printer, and — the part that matters —
**what the user has to do once, versus what they do per print.**

Status legend: ✅ proven here · ⏳ awaiting a manual step · ❓ unverified · ❌ ruled out

---

## A1 — Can we write a project 3mf ourselves? ✅ (automated checks) ⏳ (Bambu Studio open)

**Date:** 2026-08-22 · **Verdict so far: yes.**

Spec §2A flagged this as the open risk: MakerWorld's docs say a print profile is
a 3mf *produced by Bambu Studio*, and it was unverified whether a
programmatically generated one would do. The spec proposed testing against
MakerWorld first; we inverted that, because Bambu Studio and OrcaSlicer are
installed locally and proving the artifact costs nothing and risks no account.

### What was established

**The container.** Surveyed 769 readable `.3mf` files
(`spikes/a1_survey_3mf.py`). Only three members are universal:

| Member | Share of corpus |
|---|---|
| `[Content_Types].xml` | 100% |
| `_rels/.rels` | 100% |
| `3D/3dmodel.model` | 100% |
| `Metadata/project_settings.config` | 48.6% |
| `Metadata/model_settings.config` | 48.6% |

That 48.6% split is the line between a plain *model* 3mf and a *project* 3mf.
Only the latter carries print settings, and only the latter can be a MakerWorld
print profile. 394 of the corpus files came from non-Bambu tools; the rest name
a Bambu Studio version in their `Application` metadata.

**The transform convention — the one that could have quietly ruined everything.**
`<build><item transform="...">` carries twelve numbers, which are either the rows
of a column-vector matrix or its transpose. Bounding boxes cannot tell the two
apart (`spikes/a1_transform_corpus.py` found only four discriminating samples in
the whole corpus, and all four were ambiguous). Resolved by construction instead
(`spikes/a1_transform_oracle.py`): write the same asymmetric mesh under both
readings, hand each to PrusaSlicer — an independent, strict 3MF reader — and
compare what comes back.

```
rows     extents [25.133, 30.97,  35.642]   deviation 5.4701 mm
columns  extents [19.663, 32.725, 35.81 ]   deviation 0.0000 mm
intended extents [19.663, 32.725, 35.81 ]
```

**3MF uses the row-vector convention: emit the transpose of the rotation, then
the translation.** Getting this backwards yields a file that opens fine and
prints mirrored, with nothing downstream to catch it — so it is pinned in
`tests/test_write3mf.py` against a hand-computed expectation, not against the
writer's own output.

**Profiles come from the slicer, not from us.** OrcaSlicer ships the vendor
bundle at `resources/profiles/BBL/`, with an `inherits` chain per profile.
`prep/profiles.py` resolves it, which is where the P1S's 256×256×250 volume,
0.4 mm nozzle and 18×28 mm origin-corner exclusion zone come from. Process and
filament profiles must be selected by their `compatible_printers` field, **not**
by name — the P1S uses the `@BBL X1C` process profiles, so a name match finds
nothing.

### Result

`prep/write3mf.py` writes a project 3mf that passes every automated check
(`spikes/a1_validate.py`):

- trimesh (an unrelated 3MF implementation) reads back the exact triangle count,
  extents to 1e-3 mm, object centred on the plate, sitting on z=0
- PrusaSlicer independently agrees on size to 1e-3 mm
- settings blob carries printer model, printable area and height, nozzle, layer
  height, filament type and bed type

Our `project_settings.config` has 235 keys against a reference file's 320. The 98
absent ones are print-process defaults (`brim_type`, `bridge_angle`,
`enable_overhang_speed`, …) that Bambu Studio fills in itself. **Whether their
absence matters is exactly what the manual step below tests.**

### ⏳ Manual step still outstanding

Open in Bambu Studio and slice:

```
spikes/out/validate_bunny.3mf
```

Pass condition (spec §2A): it opens, shows the bunny on the correct plate at the
correct size and tilt, and slices **without a repair prompt**. If a repair prompt
appears, the writer is emitting degenerate geometry. If settings look wrong,
backfill the 98 missing keys from a resolved reference.

---

## Milestone 2 — orientation solver vs. naive placement ✅

**Date:** 2026-08-22 · Reproduce with `python bench/orient_bench.py --limit 60`.
Latest run saved in [orientation-benchmark.txt](orientation-benchmark.txt).

The corpus doubles as a labelled dataset: every project 3mf carries the build
transform its creator settled on before printing. That is a real human judgement
about which way up a model goes, and §10 is right that almost nobody else has it.

| | |
|---|---|
| agrees with the creator | **54/60 (90%)** |
| naive "leave it alone" | 50/60 (83%) |
| arrived already correct | 50/60 (83%) |
| we fixed a wrong pose | 6 |
| **we broke a right pose** | **2** |

The second metric is the one that took three attempts to get right. Plain
agreement hides harm: **83% of real files arrive already oriented**, so a solver
that re-poses on a hairline margin mostly converts right answers into wrong ones.
Measured at zero bias it broke 5 poses while fixing 6 — a net gain of one case,
which is noise. Requiring a real margin before overruling a human keeps the wins
and drops most of the damage.

Three corrections, each found by measuring rather than by reading the code:

1. **Min-max normalising sub-scores across candidates.** It stretches whatever
   spread happens to exist, so when every pose is near-equal on support volume it
   manufactures a large difference out of noise, and a weak signal like height
   outvotes the two that matter. Scores are now absolute ratios.
2. **Contact area scored as a gradient.** Let a 3DBenchy balanced on 43 mm² of
   hull beat the upright pose it is designed for. It is a threshold.
3. **Yaw left free.** Bringing a face down does not fix rotation about Z, and the
   arbitrary cross-product axis left a 40×30 box sprawling over 50×49 of plate —
   and made two candidates for the *same face* score differently.

**Caveat on the label:** the creator's orientation is a strong signal, not ground
truth. Some of those files were never printed, and a few disagreements are cases
where the solver is arguably right. Treat 90% as "agrees with an experienced
human most of the time", not as accuracy.

---

## A1b — Bambu Studio only trusts a file that claims to be its own ✅

**Date:** 2026-08-22 · Reproduce with `python spikes/a2_model_header.py`.

Reported symptom: supports stayed off in Bambu Studio. The real symptom was
bigger — on open it says **"The 3mf file has invalid config, load geometry data
only"** and discards *every* setting we write, not just the support ones.

**Bambu Studio's own exe is a usable oracle**, which unlocked this. It is
GUI-subsystem and prints nothing to the console, so it looks unscriptable — but
`bambu-studio.exe --slice 0 --outputdir DIR file.3mf` still *writes files*. The
G-code header echoes the config it used: an accepted config prints
`print_settings_id`, a rejected one leaves it empty.

Three bisections, each overturning the previous conclusion:

1. **Is it the settings?** No. A genuine Bambu config, copied verbatim into our
   container, was *also* rejected. That ruled out the whole settings theory —
   including the missing `version` key and `different_settings_to_system`, which
   had looked like strong candidates.
2. **Which part of the container?** Swapping our parts one at a time into a
   working file: `[Content_Types].xml`, `_rels/.rels`, `slice_info.config` and
   `model_settings.config` all passed. `3D/3dmodel.model` failed.
3. **What inside it?** One string:

```
<metadata name="Application">print-prep</metadata>        -> rejected
<metadata name="Application">BambuStudio-01.10.01.50</metadata>  -> accepted
```

**Bambu Studio reads print settings only from a file whose Application metadata
declares Bambu Studio format.** Anything else is treated as a foreign import:
geometry in, settings discarded. That is what "load geometry data only" means.

Verified end to end afterwards — Bambu Studio slicing our own pipeline output:

```
; print_settings_id = 0.20mm Standard @BBL X1C
; enable_support = 1
; support_type = tree(auto)
43 support features
```

Pinned in `tests/test_write3mf.py`. Provenance is not hidden: the file carries an
XML comment naming print-prep, since the Application string is a format
declaration rather than a claim of authorship.

**The lesson worth keeping:** OrcaSlicer accepted every one of these files,
including the broken ones, so it was never a valid stand-in for Bambu Studio.
Test against the program the user actually runs.

---

## A3 — MakerWorld terms ✅ read, decision recorded

**Date:** 2026-08-23. Sources, with the dates they were last revised:

- [Terms of Use](https://makerworld.com/en/user-agreement) — Jun 2024
- [Community Guidelines](https://makerworld.com/en/community-guidelines) — 27 Apr 2026
- [Model Upload Guidelines](https://wiki.bambulab.com/en/makerworld/tutorials/model-upload-guidelines) — 29 Jul 2026
- [Print Profile Upload Guidelines](https://wiki.bambulab.com/en/makerworld/tutorials/print-profile-upload) — 26 Apr 2026

**What the documents say**

- *Bulk* — Model Upload Guidelines, "Content Flooding": duplicate uploads,
  low-quality bulk uploads and homogeneous uploads are prohibited. Community
  Guidelines prohibit spam and "excessive posting".
- *Conduit* — ToS §5: "MakerWorld is **NOT** a data storage service provider."
  A liability disclaimer rather than a ban, but it states the intent. ToS §9
  separately bars robots, spiders and "any means of artificial intelligence
  service" from accessing or acquiring site content.
- *AI-generated* — permitted, but must be tagged **AIGC**, and AI-generated
  images may not be used as model images. Outright AI bans apply only to the
  Exclusive Program and crowdfunding.

**Two clauses that bear on this design more than the bulk question**

1. The printed-photo requirement is explicit: model gallery images "must include
   at least one clear photo of the actual printed object", and "Missing Photos of
   Printed Objects" is a listed violation. That is circular for our flow — you
   upload *in order to* print. Whether it is enforced on private models is what
   A2 tests.
2. Print Profile Guidelines §6.1 lists as an invalid modification "adjusting
   scale or print parameters ... without specifying meaningful changes", which
   describes our output fairly literally. Written about profiles attached to
   other people's public models, so its reach here is unclear.

**The ambiguity, stated plainly:** every one of these documents is written about
*public* publication — visibility, community quality, other users downloading.
The word "private" appears in none of them. There is no clause prohibiting
"upload your own model privately and print it", and no safe-harbour permitting
it either.

**Decision (account holder, 2026-08-23):** a private listing created for one's
own printing, not bulk uploaded, is within the terms. Proceeding to A2 on that
basis. The automation boundary is unchanged: uploads stay manual.

---

## A2 — Does MakerWorld accept our 3mf? ⏳ partly answered, 2026-08-23

**The upload form rejects our container and accepts Bambu Studio's.**

| File | Container | Result |
|---|---|---|
| A — written by our pipeline | 6 members, 300 settings | **rejected** |
| B — A round-tripped through Bambu Studio | 15 members, 575 settings | **accepted** |

MakerWorld's error:

> The 3mf file is not generated by Bambu Studio, or the printer selected in the
> 3mf is not a Bambu Lab printer.

B is A's own geometry, orientation, scale and settings — only the container
differs — so the fault was ours and the fix is structural, not a design failure.
Note MakerWorld validates *harder than Bambu Studio does*: A opens correctly in
Bambu Studio and honours every setting, and is still refused at upload.

**What this settles:** MakerWorld accepts an **unsliced** project 3mf. §2A's "do
not pre-slice" premise survives — a sliced file was prepared as a third control
and turned out not to be needed.

**The fix, and its cost.** `prep/bambu.py` hands the finished file back through
`bambu-studio.exe --export-3mf`, which is precisely the fallback §2A reserved:
Bambu Studio "purely as a 3mf *writer*, not a slicer". It takes ~0.5s and
preserves geometry, orientation, scale, supports and printer selection.

The cost is a real dependency: **any host producing MakerWorld-ready output now
needs Bambu Studio installed**, which bears on the Phase C plan of a Python
worker on Fly.io or Railway. Matching Bambu Studio's container in our own writer
would remove it. The differences to close are known — geometry moved into
`3D/Objects/object_1.model` with `3D/_rels/3dmodel.model.rels`, plus
`Metadata/plate_1.png`, `plate_1_small.png`, `top_1.png`, `pick_1.png`,
`cut_information.xml` and `filament_sequence.json` — but which of them MakerWorld
actually checks is unknown, and every guess costs an upload to test.

### A2b — our own container is accepted; the binary is dropped ✅

The Bambu Studio rewrite is a real hosting cost: §4's Python worker becomes a
container with a desktop GUI app in it, which is why "match their container in
our own writer" sits at the top of the open questions. That is now **written but
unproven** — it needs exactly one upload to settle.

**Everything below was found by diffing the rejected file against the accepted
one.** The earlier note said "the differences to close are known"; it undercounted
them. Nine members, and four further differences that are not members at all:

| Difference | Closed by |
|---|---|
| Geometry inline in `3dmodel.model` rather than split into `3D/Objects/object_1.model` + `3D/_rels/3dmodel.model.rels` | 3MF **production extension**: `xmlns:p`, `requiredextensions="p"`, `p:path` on the component |
| No `p:UUID` on object, component, build or item | generated, with Bambu's index-ish prefixes |
| `xmlns:slic3rpe` declared; `xmlns:BambuStudio` and `xmlns:p` absent | namespaces matched |
| Four metadata fields missing (`Copyright`, `ProfileCover`, `ProfileDescription`, `ProfileTitle`) | emitted |
| `_rels/.rels` lacked `cover-thumbnail-middle` / `cover-thumbnail-small` | emitted — **best single guess at how MakerWorld finds a cover image**, since neither is in the 3MF standard |
| Five plate PNGs absent | `prep/render.py` |
| `cut_information.xml`, `filament_sequence.json` absent | static templates |
| 300 settings keys against 575 | 494 by resolving against Bambu Studio's own profile tree; the last 97 are compiled-in defaults |

**The renderer was the hidden cost.** Dropping Bambu Studio drops its renderer,
and `extract_preview` was quietly serving two masters: MakerWorld's gallery image
*and* the picture on the §6.5 how-to page. `prep/render.py` is a z-buffered
rasteriser in numpy — no GL, no display, no imaging library, PNGs written with
`zlib` — because putting OpenGL back in to draw a 512px thumbnail would
re-import the dependency being removed. ~0.14s for all five.

**What is verified locally, with no upload spent:**

- Container is **member-for-member identical** to Bambu Studio's export.
- Bambu Studio slices it and echoes our settings back unchanged — same
  `print_settings_id`, `printer_settings_id`, `enable_support` as its own file.
- trimesh, an unrelated 3MF reader, follows `p:path` and reads the geometry
  back at the right size, grounded on z=0.

**✅ MakerWorld accepted it (2026-08-23).** One upload, as planned. The print
file was taken without complaint, so `prep/bambu.py` is no longer in the default
path — `--bambu-rewrite` keeps it reachable if MakerWorld ever tightens. **Phase
C can be an ordinary Python worker after all**, and §10's AGPL question leaves
the runtime with it.

⚠️ **Two things this upload did *not* establish, and one it contradicted.**

**1. Accepted at upload is not the same as prints from Handy.** The original A2
protocol had six checkpoints; this run confirms the first. Our container has not
been shown to produce a *printable profile*, nor to preserve size, orientation
and supports through MakerWorld's re-slice. Those were verified for Bambu
Studio's container, not ours, and MakerWorld could accept a file it cannot make
a profile from. **Re-run checkpoints 2–6 before trusting the native path.**

**2. The gallery image was rejected as not a real photo.** This directly
contradicts the finding recorded above — "a private model publishes with a
*render* as its gallery image; no photo of a printed object is required." Both
observations are from 2026-08-23. Two candidate explanations, untested:

- The earlier run may never have *attached* a picture: MakerWorld may pull
  `Metadata/plate_1.png` out of the container itself, and only run a photo check
  on an image the user uploads by hand. Our container now carries that member
  plus the `cover-thumbnail-*` relationships, so **the "attach nothing" path is
  worth one upload before any other decision** — it would dissolve the problem.
- Or the check is on image *content*, and Bambu Studio's lit plate render with
  its plate texture passes where our flat-shaded one does not.

**Resolved in the page (2026-08-23):** step 4 now warns that MakerWorld will not
take the supplied picture, tells the user any real photo gets them through, and
tells them to swap in a photo of the real object once it has printed. The
account holder's decision, taken with the A3 scoping in view.

### The prime tower settings, and what they revealed ✅

Checking the submitted model in Handy turned up non-standard values in the prime
tower section -- infill gap 100% where 150% is normal, rib wall unchecked where
it is normally checked. The cause is a schema change, and it is worth recording
because it will happen again:

**Bambu Studio 02.x added ~100 settings that do not exist in 01.x files at all.**
Our config omitted them; anything downstream then filled them from an *older*
compiled-in fallback rather than the current profile default, and the user sees
settings they never chose.

The harvest in `spikes/a1_harvest_baseline.py` could not have caught this. It
required a key to appear in 98% of the corpus, and the corpus is 244 files of
01.x against 135 of 02.x -- so a key universal within the current era looked
like 35% noise and was filtered out. It now **cohorts by major version** and
harvests the current one. Baseline: 60 keys -> 86.

Two further notes from the same pass:

- `is_genuine()` only checked for `BambuStudio-` in the header, which **our own
  output now satisfies** -- it has to, or Bambu Studio drops every setting. The
  corpus-pollution failure CLAUDE.md warns about had quietly become possible
  again. `prep.write3mf` stamps `Origin`, so the check now excludes our own work
  by that.
- `prime_tower_infill_gap` and `prime_tower_rib_wall` agree at only ~82% across
  real files, and the minority is not printer- or filament-count-specific, so it
  is a user preference rather than a default we would get wrong per printer. The
  majority is taken and the harvest prints anything below 90% for review.

An unrelated real photo was accepted and completed the submission. That works,
but note what it would mean to put in the instructions: **the A3 terms decision
was scoped to "a private listing made for one's own printing, not bulk uploaded
... keep volume low."** One person doing this once on their own account is the
thing A3 reasoned about. A free service telling every user to do it is not, and
that is a product decision rather than a bug.

**If it is rejected**, the informative order to strip things back is: first the
`Origin` metadata (`print-prep` is the only string in the file that says we are
not Bambu Studio — it was moved out of an XML comment for exactly this reason),
then the settings gap, then the `CLIENT_VERSION` string. The version is the
*weakest* suspect: 99 of 380 files in the local corpus claim the same
`01.10.01.50` we do.

**The Bambu Studio rewrite remains the default** until that upload happens.
`--no-makerworld` produces the native container; do not flip the default on a
file nobody has uploaded.

### The photo requirement is not enforced on private models ✅

The risk §2A flagged as potentially fatal — "a blocked Publish button ends the
flow" — does not materialise. **A private model publishes with a render as its
gallery image; no photo of a printed object is required at upload.** Verified
2026-08-23: published private, and MakerWorld generated a print profile from it.

That resolves the circularity in the Model Upload Guidelines, which require "at
least one clear photo of the actual printed object". Enforcement is evidently
tied to public listings. A user who later wants to publish can replace the
render with a real photo after the first print.

Consequence for §6.5: the handoff no longer needs a "take a screenshot" step.
Bambu Studio's export already contains a 512x512 lit plate render at
`Metadata/plate_1.png`, and `prep.bambu.extract_preview` now saves it beside the
3mf as `<name>-preview.png`. It is cleaner than a screenshot — no plate grid, no
slicer UI — so the upload has a picture ready without the user producing one.

### ✅ A2 is answered: the loop works end to end (2026-08-23)

| Question | Result |
|---|---|
| Publish completes on a Private model | **yes**, with a render as the image |
| Appears in Bambu Handy | **yes**, under *My Creations* |
| Offers a printable profile | **yes** |
| Size and orientation correct | **yes** |
| Supports honoured | **yes** |
| Print starts with no desktop step | **yes** |

**A model prepared by this tool reaches a printer from an iPad with no computer
involved.** That is the question §2 and §11 Q1 said the product hinged on.

**The route through Handy**, both verified, and the raw material for §6.5:

- *Me* tab → slide the bar carrying printing history / print queue / browsing
  history / ratings **to the right** → **My Creations** → tap the model.
- Shorter: profile picture, top left → **3D Models** → newest upload is at top.

From there it prints like anything else in Handy.

Still unmeasured: the exact tap count, and where a non-technical person stalls.
That is Milestone 6, and it is now the only milestone that proves anything.

### Original plan, for the record

Blocked on A1's manual step and on A3. Run in the order §2A specifies:

1. Upload an **OrcaSlicer-exported** project 3mf as a **Private** model → does it
   appear as a printable profile in Bambu Handy?
2. Upload the **generated** file (`spikes/out/validate_bunny.3mf`) → same test.
3. If both fail: drive `bambu-studio.exe` headless purely as a 3mf *writer*.

Also confirm the two secondary risks §2A names:

- Is a photo of the printed result enforced on private models? A blocked
  **Publish** button ends the whole flow.
- Do private models count against any account-quality metric?

**If A2 fails outright,** the product degrades to "download a print-ready file"
and the §6.5 handoff screen changes shape. Phase B is unaffected either way.

---

## Path status (spec §2 table, as re-checked)

| Path | Status | Note |
|---|---|---|
| Bambu cloud, third-party print initiation | ❌ | ACS blocks unauthorised software |
| Bambu Handy file import | ❌ | No file browser, no share-sheet handler |
| Bambu LAN + Developer Mode | ❌ for this user | Needs LAN-only mode, IP, access code |
| Bambu Connect on a PC | ❌ by choice | Needs an always-on desktop; shelved |
| **MakerWorld private upload** | ⏳ **A2** | The v1 path. Zero-setup, official software only |
| Prusa Connect | ❓ | Official cloud with an API; third-party submission unverified |
| Klipper / Moonraker | ❓ | Trivial HTTP upload; setup burden sits with whoever installed Klipper |
| Download to Files app | ✅ | Always works, dead-ends without a helper or USB-C drive |

---

## Automation boundary (unchanged)

v1 does **not** automate the MakerWorld upload. That would mean handling the
user's Bambu credentials — a security liability and the fastest route to a banned
account. Revisit only if MakerWorld ships an official API.
