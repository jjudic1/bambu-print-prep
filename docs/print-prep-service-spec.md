# Print-Prep Service — Build Specification v0.1

**One line:** A mobile-first web service that takes an AI-generated or downloaded 3D mesh and returns a print-ready, correctly-sized, correctly-oriented, sliced file — with no desktop software, no LAN setup, and no 3D-printing vocabulary required of the user.

**Status:** Pre-build. Phase 0 is a feasibility spike that gates everything else.

---

## 1. The problem this solves

AI 3D generation (Meshy, Tripo, Hitem3D, 3D AI Studio) has made *making a model* easy on a phone. Printing that model is still a desktop task. The user is left holding an STL they cannot do anything with.

The generation platforms are closing the *mesh quality* gap (watertight, auto-repair, auto-split). Nobody is closing the **judgment** gap:

- How big should this actually be? ("fits in a hand" not "80mm")
- Which way up does it print without stair-stepping the face?
- Which part is too thin and will snap?
- Does it need a cut, a flat base, a pin?
- Which material?

That judgment is the product. Slicing is just the delivery mechanism for it.

### Target user

Someone with a 3D printer bound to their account and an iPad or iPhone as their only computer. Non-technical. Will not find an IP address, will not enable LAN mode, will not read a wiki. Adjacent: a technical person setting this up *for* that user.

---

## 2. Phase 0 — Transport feasibility spike (DO THIS FIRST)

**Do not build any UI until one delivery path is proven end to end.**

The hardest part of this product is not slicing. It is getting a sliced file onto a printer without the user doing setup. Known constraints as of Aug 2026:

| Path | Status | Notes |
|---|---|---|
| Bambu cloud, third-party initiated print | **Blocked** | Bambu's Authorization Control System rejects print-initiation commands from unauthorized software in both cloud and normal LAN mode |
| Bambu Handy file import | **Not supported** | No file browser, no iOS share-sheet handler. Long-standing open feature request |
| Bambu LAN + Developer Mode | Works, rejected | Requires LAN-only mode, IP, access code — disqualifying for target user |
| Bambu Connect on a PC | Works | Requires an always-on desktop — this is the shelved architecture |
| MakerWorld publish → print in Handy | Works, one-tap | Only genuinely zero-setup Bambu path. Public listings only. Check MakerWorld ToS re: bulk/AI/personal-use uploads before relying on it |
| Prusa Connect | Likely open | Official cloud with an API; verify third-party job submission |
| Klipper / Moonraker | Open | Trivial HTTP upload + print. Setup burden falls on whoever installed Klipper |
| Download sliced file to Files app | Always works | Dead-ends on iPad unless user has a USB-C drive or a helper |

**Spike deliverable:** a shell script or minimal Node/Python program that takes a local `.stl`, produces a file, and causes a real printer to start printing — with no interactive desktop step. Document exactly what the *user* had to do once, and what they do per print.

Write the finding into `/docs/transport-findings.md` before proceeding.

---

## 2A. Primary transport for v1 — MakerWorld private upload

This is the path to build first. It is community-validated, uses only official software, and requires no LAN mode, no IP address, and no desktop.

**Critical design consequence: do not pre-slice.**

MakerWorld does its own cloud slicing. A print profile is a Bambu Studio *project* 3mf containing geometry plus settings; MakerWorld re-slices it against whatever printer, filament, and build plate the user selects at print time. Uploading an already-sliced G-code 3mf is the wrong artifact.

This removes an enormous amount of the build:

- No slicer binary in the container
- No CPU-heavy job queue (analysis and repair are seconds, not minutes)
- No AGPL hosting question
- No per-printer profile management — the user picks their printer in Handy
- Re-sizing does not require re-slicing

**What the server actually produces:** a valid Bambu Studio–compatible project 3mf containing the repaired, scaled, oriented mesh, with default Bambu print settings and correct plate placement. That's it.

**Open risk to spike (half a day):** MakerWorld's documentation says a print profile is a 3mf *produced by Bambu Studio*. Whether it accepts a 3mf written by OrcaSlicer, by `lib3mf`, or hand-assembled is unverified. Test in this order:

1. OrcaSlicer-exported project 3mf → upload as private model → does it appear as a printable profile in Handy?
2. Programmatically generated 3mf matching Bambu Studio's structure → same test
3. If both fail: fall back to running Bambu Studio headless in the container purely as a 3mf *writer*, not a slicer

If none work, the product degrades to "download a print-ready file" and the transport question reopens.

**Secondary risks:**
- Private models earn no downloads or points — fine, but confirm they don't count against any upload-quality metric on the account.
- Check Community Guidelines before automating uploads at volume. Using MakerWorld as a personal file conduit is what people already do manually; scripted bulk upload is a different thing and could put a creator account at risk.
- Print-profile guidance asks for a photo of the printed result. Verify whether that is enforced on private models — it almost certainly isn't, but a blocked publish button ends the flow.

**Automation boundary:** v1 does not automate the upload. The user does it in Safari, guided. Automating MakerWorld uploads means handling their Bambu credentials, which is both a security liability and the fastest way to get an account banned. Revisit only if MakerWorld exposes an official API.

---

## 3. Scope

### In scope (v1)
- Upload a mesh (`.stl`, `.obj`, `.3mf`, `.glb`) from an iOS device or paste a URL from a generation platform
- Automated print-readiness analysis and repair
- Plain-language sizing with real-world reference
- Automatic orientation selection with a human-readable reason
- Slice against a stored printer/material profile
- Deliver via whichever adapter Phase 0 validated
- Job history so a print can be re-run without redoing anything

### Out of scope (v1)
- Model generation (integrate, never rebuild)
- Manual mesh editing, sculpting, boolean tools
- Multi-plate arrangement, print farm management
- Accounts beyond a magic-link email login
- Payment

### Non-goals (deliberate)
- Do not expose layer height, infill percentage, support angle, or any slicer setting in the primary flow. Every one of those is a place the target user fails.
- Do not build a 3D editor. The user's only geometric decisions are **how big** and **which way up**, and the app should have a defensible default for both.

---

## 4. Architecture

```
iOS Safari (PWA)
      │  HTTPS
      ▼
API server ──────► Job queue ──────► Worker pool
(Node/Fastify        (Redis)          - mesh analysis (trimesh)
 or FastAPI)                          - repair (manifold3d / pymeshfix)
      │                               - orientation solver
      │                               - slicer CLI (headless)
      ▼                                       │
  Postgres                                    ▼
  Object storage ◄──────────────────── sliced artifact
      │
      ▼
  Delivery adapter (per Phase 0 finding)
```

**Why a job queue:** slicing is 5–90 s and CPU-bound. The request must not block. The PWA polls or subscribes for status.

**Slicer:** OrcaSlicer or BambuStudio CLI in a container, headless. Both accept `--load-settings` with profile bundles and `--slice` with an output path. Pin the version — CLI flags shift between releases. Verify licensing terms for hosted use (AGPL considerations) before any commercial deployment.

**Suggested stack** (adjust to what you're fluent in):
- Frontend: React + Vite PWA, `three.js` for preview. No native app.
- API: FastAPI (Python) — keeps you in one language as the mesh work is all Python
- Workers: Python + Celery/RQ, or a simple Postgres-backed queue
- Mesh: `trimesh`, `manifold3d`, `pymeshfix`, `numpy`
- Storage: S3-compatible (R2 is cheap)
- Deploy: containers on Fly.io or Railway; workers need real CPU, not edge functions

---

## 5. The pipeline

### 5.1 Ingest
Accept file upload or URL. Normalize to a trimesh object. Reject > 200 MB or > 5M triangles with a decimation offer rather than an error.

### 5.2 Analyze
Produce a `MeshReport`:

```python
{
  "watertight": bool,
  "manifold": bool,
  "hole_count": int,
  "shell_count": int,          # floating disconnected pieces
  "self_intersecting": bool,
  "inverted_normals": bool,
  "bbox_mm": [x, y, z],        # at native scale
  "volume_mm3": float,
  "unit_guess": "mm" | "m" | "unknown",   # AI exports are often unitless or metre-scaled
  "min_wall_mm": float,         # sampled thickness
  "thin_regions": [...],        # for highlighting in preview
  "flat_base_area_mm2": float,
  "overhang_ratio": float
}
```

Unit guessing matters more than it sounds. A mesh that arrives 0.08 units tall is metres; one that's 2400 is probably millimetres from a scan. Guess, then confirm with the user visually — never with a number.

### 5.3 Repair
Ordered, each step conditional on the report:
1. Merge duplicate vertices, drop degenerate faces
2. Remove floating shells below a volume threshold (keep the largest, keep intentional multi-part)
3. Fix normals
4. Fill holes → watertight
5. Optional voxel remesh as the fallback when targeted repair fails (`manifold3d`) — slow but almost always produces something sliceable
6. Re-run analysis; if still not watertight, fail the job with a plain-language message

### 5.4 Size
This is a UX problem, not a geometry problem. See §6.2.

### 5.5 Orient
Score candidate orientations (convex hull faces + the 6 axis-aligned options) on:
- flat contact area with the bed (weight high)
- support volume required (weight high)
- whether the "face" / detail-dense region points up or sideways rather than down (estimate via curvature density)
- height (lower = fewer layers = fewer failure chances)
- Z-axis stress across the thinnest cross-section (a neck printed vertically snaps)

Return the top choice **plus a one-sentence reason** — "laid on its back so the face isn't printed against supports." The reason is the feature. It teaches the user why, which is what makes the product feel like a person and not a button.

Offer at most two alternates as thumbnails.

### 5.6 Assemble the project 3mf
Apply the orientation transform and scale, place the object on the plate origin, and write a Bambu Studio–compatible project 3mf with default print settings. Capture a preview thumbnail rendered client-side or with a headless renderer.

Estimated time and filament weight are **not available** without slicing. Do not fake them. Either omit them or show a rough volume-derived estimate clearly labelled as approximate — MakerWorld will show the real numbers at print time.

Validate against the target printer's build volume before writing the file. `"Object exceeds print volume"` becomes `"This is bigger than your printer's bed — want me to shrink it to fit, or cut it into parts?"`

### 5.6b Handoff to MakerWorld
The app's final screen is a guided handoff, not a send button. See §6.5.

### 5.7 Deliver
Adapter interface — implement one, stub the rest:

```python
class DeliveryAdapter(Protocol):
    def list_targets(user) -> list[Printer]: ...
    def send(job: SlicedJob, target: Printer) -> DeliveryResult: ...
    def status(job) -> JobStatus | None: ...
```

---

## 6. UX specification

Five screens. If it needs a sixth, something is wrong.

### 6.1 Bring a model
Big drop target. Three routes: Files, photo/image → generation partner, paste link. Never the word "mesh."

### 6.2 How big?
**The critical screen.** Do not present a number field first.

- Show the model rendered next to a familiar reference object at true relative scale — a hand, a coffee mug, a credit card. Let the user swipe between references.
- A single slider adjusts size continuously. Numbers appear as secondary text (mm and inches), never as the primary control.
- Snap points for common intents: "keychain," "desk size," "as big as it'll print."
- Hard clamp at the printer's build volume — the slider physically cannot exceed it. Show the ceiling rather than erroring after the fact.
- If shrinking pushes any wall below the nozzle diameter, warn *at the moment it happens*: "the ears get too thin to print at this size."

### 6.3 Check
Auto-selected orientation, rendered on a virtual bed, with the one-sentence reason. Two alternate thumbnails. Thin regions highlighted in a warning color with a plain caption. A "print it as-is" button that is always available — the user must be able to ignore every warning.

### 6.4 Material
Pick from what the user told you they have. If AMS/CFS data is available from the printer, read it. Otherwise: a saved list of spools with color swatches, managed once during setup.

### 6.5 Send — the guided handoff

This screen is the product's weakest link and deserves the most design attention. The user has to leave your app, do six things in Safari, and come back to Handy. Every one of those steps is a place they quit.

**Screen contents, in order:**

1. **One tap: "Save the file."** iOS share sheet → Save to Files. Default the filename to something recognizable (`dragon-80mm.3mf`), never a UUID. Show where it went.
2. **One tap: "Open MakerWorld."** Deep link to the upload page. If they're not logged in, they log in once and stay logged in.
3. **Inline illustrated steps** — screenshots, not prose. Each step is one line and one image:
   - Tap **Upload**
   - Tap **Choose file**, pick the file from Files
   - Set visibility to **Private**
   - Give it any title
   - Tap **Publish**
4. **"Done — now open Handy."** Deep link into the Bambu Handy app. The model appears under their own uploads; they tap it, pick printer and filament, and print.

**Design rules for this screen:**
- Persistent, not a one-time modal. They will need it again on print two and print five.
- A "show me again" link that replays the steps.
- Screenshots must be re-shootable — MakerWorld's UI will change, and stale screenshots are worse than none. Keep them in one folder with a dated README.
- Never say "3mf." Say "the file."
- Track drop-off per step if you instrument anything at all. Whichever step loses people is the thing to fix or automate first.

**The honest framing to the user:** "This part is clunky because Bambu doesn't let apps talk to your printer directly. Six taps, once per model."

**Setup-day version:** during onboarding, walk the user through this whole loop once with a small test cube, on the same day the technical helper is present. Doing it cold for the first time on their own is where this dies.

### Copy rules
- No jargon in any user-facing string: no manifold, non-manifold, mesh, topology, normals, infill, brim, raft, gcode, slice.
- Every error names the recovery, not the cause.
- Every automated decision is explained in one sentence, in the same voice a person would use standing next to the printer.

---

## 7. Data model

```
User(id, email, created_at)
Printer(id, user_id, model, build_volume, nozzle_mm, adapter_type, adapter_config_json)
Spool(id, user_id, material, color_hex, label)
Job(id, user_id, source_type, source_url, original_filename, state, created_at)
  state: uploaded → analyzing → repairing → awaiting_input → slicing → ready → sending → printing → done | failed
MeshReport(job_id, ...)            # §5.2
JobConfig(job_id, scale, orientation_quaternion, spool_id, profile_id)
Artifact(job_id, kind, storage_key)  # original, repaired, sliced, thumbnail
```

Keep every artifact. Re-printing at a different size must not require re-uploading, and the repaired mesh is the expensive part.

---

## 8. Onboarding (the part that decides whether this works)

Two roles, explicitly:

**Setup** — done once, possibly by a family member on a laptop: connect the printer, name it, enter build volume, add spools. Assume competence here.

**Use** — done forever after, on the iPad: upload, size, send. Assume nothing here.

Design the setup flow as something that can be completed *by a different person on a different device* and handed over. A shareable setup link that a technical relative can complete on the user's behalf is a legitimate v1 feature, not a hack.

---

## 9. Milestones

| # | Deliverable | Done when |
|---|---|---|
| 0 | Transport spike | A real printer starts a print from a script, findings documented |
| 1 | CLI pipeline | `prep in.stl --size 80mm --printer p1s` emits a sliced file locally |
| 2 | Orientation solver | Beats naive axis-aligned placement on 20 hand-picked AI-generated meshes, judged by support volume + your own eye |
| 3 | API + queue | Upload via HTTP, poll status, download result |
| 4 | PWA | Five screens, works on iPad Safari, installable, no desktop needed |
| 5 | Delivery adapter | End-to-end from iPad to printing |
| 6 | Real user test | Someone non-technical prints something without you in the room |

Milestone 6 is the only one that proves anything.

---

## 10. Risks

- **Bambu closes further.** ACS already blocks third-party print initiation; assume the trend continues. Do not build a Bambu-only product. The adapter boundary in §5.7 exists for this reason.
- **The generation platforms absorb this.** Meshy already ships printability checks, auto-repair, auto-split, and slicer export. Your defense is judgment and the mobile last mile, not repair algorithms — do not compete on repair.
- **Slicer licensing.** OrcaSlicer/BambuStudio are GPL/AGPL derivatives. Hosting them as a service has obligations. Resolve before charging money.
- **CPU cost.** Slicing is expensive per job and users will iterate on size. Cache aggressively: re-slicing at a new scale is a full re-slice, so debounce and only slice on explicit confirm.
- **The orientation solver is the moat and the hard part.** If it makes bad calls, the product is worse than nothing. Budget real time here, and seed it with your own catalogue — you have 100+ models whose correct orientation you already know. That is a labelled dataset almost nobody else has.

---

## 11. Open questions for the builder

1. Which printer ecosystem does Phase 0 clear first? Build for that one, not the one you own.
2. Is "print-prep only, ending in a download" a product on its own if no transport clears? (My read: yes, but a smaller one — sell it to generation platforms as an API rather than to end users.)
3. Does the MakerWorld publishing path violate ToS at volume? Answer before touching it — your creator account is worth more than this experiment.
