# Handoff — read this first

**Date:** 2026-08-23 · **Repo:** https://github.com/jjudic1/bambu-print-prep · **Tests:** 110 passing

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
  -> bambu     rewrite via Bambu Studio so MakerWorld accepts it
```

| Path | What |
|---|---|
| `Prepare for printing.bat` | Drag a model onto it. Two questions, then a file. |
| `prep/` | The pipeline. One module per stage above. |
| `bench/orient_bench.py` | Orientation solver measured against a real corpus |
| `spikes/` | Throwaway probes, kept because they document how things were proven |
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
2. **§2A "3mf produced by Bambu Studio" — literally true, twice over.** Our own
   container is a valid project 3mf that Bambu Studio opens and honours
   completely, and MakerWorld still refuses it at upload. The pipeline therefore
   ends by rewriting the file through `bambu-studio.exe --export-3mf` (~0.5s),
   which is the fallback §2A reserved. **Consequence: any host producing
   MakerWorld-ready output needs Bambu Studio installed.** This directly affects
   the plan of a Python worker on Fly.io/Railway.
3. **§2A's fatal risk did not materialise.** A private model publishes with a
   *render* as its gallery image; no photo of a printed object is demanded. The
   Model Upload Guidelines require one, but enforcement is tied to public
   listings.
4. **§10's "the orientation solver is the moat" — correct, and it was wrong
   three times before it was right.** See the benchmark section below.

---

## The delivery loop, as actually performed

This is the raw material for §6.5. Steps 1–5 are per print; the account is set up
once.

1. Save the `.3mf` to Files on the iPad.
2. Safari → MakerWorld → Upload → choose the file.
3. Add the `-preview.png` the tool produces as the gallery image.
   *(No printed photo needed while the model is private.)*
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

1. **Real user test.** Someone non-technical, an iPad, no help. Watch where they
   stall. Do not fix anything until you have watched it fail once.
2. **Then §6.5** — the guided handoff screen, built around whatever step 1
   revealed as the drop-off. The loop above is the content; the tap count and the
   failure point are the unknowns.
3. **Then the PWA** (Milestones 3–4), if the handoff survives contact.

**Open engineering questions, in rough priority:**

- Match Bambu Studio's container in our own writer, to drop the binary
  dependency. Candidate differences are recorded in `transport-findings.md`;
  which ones MakerWorld actually checks is unknown, and **each guess costs an
  upload to test**, so do not do it blind on a young account.
- Phase C hosting needs rethinking given the Bambu Studio dependency, and §10's
  AGPL question applies before any commercial deployment.
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
