# Handoff — read this first

**Date:** 2026-08-23 · **Repo:** https://github.com/jjudic1/bambu-print-prep · **Tests:** 156 passing

The spec is [print-prep-service-spec.md](print-prep-service-spec.md). This
document is the delta: what has been proven, what it cost to prove, and what to
do next. Read this before the spec — several of the spec's assumptions have been
tested and two of them changed.

---

## The headline

**The transport path works end to end.** A model prepared by this tool reaches a
printer from an iPad with no desktop step, correct size, correct orientation and
supports enabled. That was the question the whole product hinged on (§2, §11 Q1),
and it is answered yes.

Everything up to and including Milestone 5 is done or proven. **Milestone 6 —
someone non-technical prints something without you in the room — is the only one
that proves anything, and it has not been attempted.**

---

## What exists

A Python pipeline, driven either by a drag-and-drop launcher or a CLI.

```
model.stl
  -> ingest    guess units, normalise to mm, offer decimation if huge
  -> analyze   MeshReport: watertight, holes, thin walls, overhangs (§5.2)
  -> repair    the §5.3 ladder, honest failure when it cannot
  -> orient    the solver (§5.5) -- the moat
  -> base      level a curved bottom so it stands (§1)
  -> size      scale + plain-language comparison, clamped to the bed (§6.2)
  -> write3mf  Bambu-compatible project 3mf
  -> render    the plate pictures, in numpy -- no GL, no display
  -> handoff   the how-to-print page that travels with it (§6.5)
```

| Path | What |
|---|---|
| `Prepare for printing.bat` | Drag a model onto it. Two questions, then a file. |
| `prep/` | The pipeline. One module per stage above. |
| `bench/orient_bench.py` | Orientation solver measured against a real corpus |
| `spikes/` | Throwaway probes, kept because they document how things were proven |
| `prep/handoff.py` | The §6.5 instructions, as a file that goes to the iPad |
| `docs/transport-findings.md` | **The evidence trail. Read this second.** |

Run it:

```powershell
.venv\Scripts\prep.exe model.stl --size 80mm
.venv\Scripts\python.exe -m pytest tests\ -q
```

---

## Spec assumptions that changed

1. **§2A "do not pre-slice" — confirmed.** MakerWorld accepts an *unsliced*
   project 3mf and re-slices at print time. A sliced control was built and proved
   unnecessary.
2. **§2A "3mf produced by Bambu Studio" — resolved; the binary is gone.**
   MakerWorld refused our first container while accepting Bambu Studio's, so the
   pipeline rewrote through `bambu-studio.exe` for a day. The container gap has
   since been closed in our own writer and **MakerWorld accepts it** (verified by
   upload, 2026-08-23). `--bambu-rewrite` keeps the old path reachable in case
   MakerWorld tightens. **Phase C can be an ordinary Python worker after all**,
   and §10's AGPL question leaves the runtime with the binary. See
   `transport-findings.md` §A2b for the nine members and four non-member
   differences that had to be closed.
3. **§2A's fatal risk is real after all, and has a workaround.** An earlier run
   suggested a render passed as the gallery image. It does not: MakerWorld
   rejects it as "not a real photo". Any real photo is accepted, so the loop
   completes, and §6.5 step 4 now says so and tells the user to swap in a photo
   of the actual object once it has printed. **This is the account holder's
   decision, and it is worth re-reading A3 before it scales** — A3 reasoned about
   one person's own low-volume private listings, not a free service instructing
   every user to satisfy a photo check with an unrelated image.
4. **§10's "the orientation solver is the moat" — correct, and it was wrong
   three times before it was right.** See the benchmark section below.

---

## The delivery loop, as actually performed

This is the raw material for §6.5. Steps 1–5 are per print; the account is set up
once.

1. Save the `.3mf` to Files on the iPad.
2. Safari → MakerWorld → Upload → choose the file.
3. Add a picture. **MakerWorld will not take the `-preview.png`** — it rejects
   a render as "not a real photo". Any real photo from the camera roll gets
   through; swap in a photo of the actual object once it has printed.
4. Set visibility **Private**, give it a title, Publish.
5. Bambu Handy → and here there are two routes, both verified:
   - **Long:** *Me* tab → slide the bar with printing history / print queue /
     browsing history / ratings **to the right** → **My Creations** → tap the
     model.
   - **Short:** tap your profile picture, top left → **3D Models** → the newest
     upload is at the top.
6. From there it prints exactly like anything else in Handy.

**The honest framing for the user stays true:** this is clunky because Bambu does
not let apps talk to your printer directly. But it is six taps, once per model,
and no computer is involved.

**Not yet measured:** the precise tap count, and where a non-technical person
stalls. That is Milestone 6's job.

### This loop now ships with the file (§6.5, 2026-08-23)

Until this change, the entire handoff a user received was three lines of console
text — "upload it to MakerWorld as a PRIVATE model" — which is a reminder for
someone who already knows, not instructions. A Milestone 6 tester would have
stalled there, and stalled for a reason already known, which teaches nothing.

So every run now writes three files that only mean anything together:

```
dragon-80mm.3mf                      the model
dragon-80mm-preview.png              what it will look like, on the page
dragon-80mm - how to print this.html the six steps above, for the iPad
```

`prep/handoff.py` builds the page: one self-contained HTML file, picture inlined
as a data URI, no network. It renders in the Files preview and in Safari, and it
survives AirDrop, iCloud Drive and mail intact. §6.5 wants this **persistent, not
a modal** — it sits in Files next to the model, and "show me again" is just
opening it again on print five.

Content is the verified loop and nothing else. Both Handy routes are there, the
short one as step 6 and *My Creations* as the fallback beneath it. There is
deliberately **no deep link to MakerWorld's upload page**: that URL was never
recorded during the A2 run, and a link that 404s is worse than a sentence naming
the button.

The file name changed too, and that was the other half of §6.5's first step —
`dragon-80mm.3mf`, not `dragon.prepared.3mf`. The name is the only handle the
user has on the file once it is in Files among the others, and it is what they
must match in MakerWorld's picker. Two sizes of one model no longer collide.

**Still unmeasured, and still the whole point:** whether these steps survive
contact with someone who has not read them over your shoulder. The page is a
first draft written from a loop *you* performed. Milestone 6 is what tells you
which step is wrong.

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
At zero author-bias the solver broke 5 while fixing 6 — a net gain of one case,
i.e. noise. Three corrections got it to where it is:

- Sub-scores are **absolute ratios**, never min-max normalised across candidates.
  Min-max stretches whatever spread exists, so noise in a weak signal outvotes
  the two that matter.
- Contact area is a **threshold, not a gradient**. Scored linearly, a 3DBenchy
  balanced on 43 mm² of hull beat the upright pose it is designed for.
- **Yaw is aligned** to the minimum-area footprint. Bringing a face down leaves
  rotation about Z free, and the arbitrary axis left a 40×30 box sprawling over
  50×49 of plate — and made two candidates for the *same face* score differently.

**Re-run the benchmark after any change here.** It streams a running tally, so a
run cut short still tells you something.

---

## Gotchas that cost real time

- **Bambu Studio is scriptable despite printing nothing.** `bambu-studio.exe` is
  GUI-subsystem, but `--slice` and `--export-3mf` still *write files*, and the
  G-code header echoes the config it used. That makes it a true oracle. Not
  discovering this earlier cost two wrong diagnoses.
- **OrcaSlicer is not a stand-in for Bambu Studio.** It accepted every broken
  file, including ones Bambu Studio rejected outright. Test against the program
  the user runs.
- **Bambu Studio only reads settings from a file claiming to be its own.** The
  `Application` metadata must say `BambuStudio-<version>`; anything else gets
  "The 3mf file has invalid config, load geometry data only" and every setting is
  silently dropped. Pinned in `tests/test_write3mf.py`.
- **The 3MF build transform is row-vector** — emit the *transpose* of a
  column-vector rotation. Bounding boxes cannot tell the two apart; getting it
  backwards prints mirrored with nothing downstream to catch it.
- **Broad `except` blocks hid three separate real bugs** in this project
  (a changed pymeshfix signature, two missing optional deps). Log failures.
- **Don't score corpus files our own tool wrote.** A file sent to the user was
  saved into Downloads and started scoring itself as ground truth.
- `chcp 65001` in a `.bat` **silently breaks `set /p`** — every menu answer reads
  back empty and defaults are used.

---

## What to do next

**Milestone 6 is the only one that proves anything.** Everything else is
optional polish.

1. **Real user test.** Someone non-technical, an iPad, no help. Hand them the
   three files and the how-to page and nothing else — no explaining. Watch where
   they stall. **Do not fix anything until you have watched it fail once**; the
   page is a guess about where the difficulty is, and the point of the test is
   to find out where it actually is.

   Worth watching for specifically, since these are the guesses:
   - Do they open the how-to page at all, or go straight for the model?
   - Does the Files preview render it, or does it need Safari?
   - Step 4 — do they understand which file "the picture" means?
   - Step 5 — does **Private** survive, or does the default win?
   - Step 6 — profile picture, or do they fall through to *My Creations*?

2. **Then fix §6.5** around whatever step 1 revealed. `prep/handoff.py` is one
   module of strings; changing the copy costs nothing. Screenshots are the
   obvious next increment (§6.5 asks for them) but they are only worth shooting
   for the steps that actually lost someone — and they go stale when MakerWorld
   moves, so date the folder.

3. **Then the PWA** (Milestones 3–4), if the handoff survives contact.

**Open engineering questions, in rough priority:**

- ~~Match Bambu Studio's container in our own writer~~ — **done**, one upload,
  §A2b. What remains is that acceptance rests on that single upload; if
  MakerWorld tightens, `--bambu-rewrite` is the fallback and the first suspects
  are listed in §A2b.
- **Re-verify the rest of the A2 loop against our own container.** Orientation
  and supports were checked in Handy and are right. Not yet checked: that the
  size survives MakerWorld's re-slice, and that a print actually completes from
  the native container.
- Settings completeness is now era-aware (§A2b), but the corpus behind it is 47
  single-extruder 02.x files. A larger cohort would firm up the ~82% keys.
- §10's AGPL question is **no longer blocking** for hosting, since no AGPL binary
  runs in the worker. It still applies to any vendored profile data.
- Estimated time and filament weight are *not* available without slicing (§5.6).
  Do not fake them.

**Do not:** automate the MakerWorld upload. That means holding Bambu credentials
— a security liability and the fastest route to losing the account. §2A's
automation boundary stands unless MakerWorld ships an official API.

---

## Account and terms

A dedicated account was created for this. The terms were read on 2026-08-23 and
the clauses are quoted in `transport-findings.md` §A3. Every governing document
is written about *public* publication; none mentions private models either way.
**The account holder's decision** is that a private listing made for one's own
printing, not bulk uploaded, is within the terms. Keep volume low — "Content
Flooding" names repeated near-identical uploads, and a new account has no history
to absorb a misread.
