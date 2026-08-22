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

## A3 — MakerWorld terms ❓ **do this before A2**

Spec §11 Q3, unanswered. Read the Community Guidelines and ToS on
bulk / AI-generated / personal-conduit uploads **before** uploading anything.

The spec's own framing is the right one: using MakerWorld as a personal file
conduit is what people already do by hand; scripted or high-volume upload is a
different thing and could cost a creator account. If the read is ambiguous, stop
and say so rather than deciding unilaterally.

---

## A2 — Does MakerWorld accept our 3mf as a print profile? ⏳ needs a Bambu account

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
