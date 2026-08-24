"""HTTP in front of the pipeline. Milestone 3.

Deliberately thin. Every decision this serves -- what shape it should be, how
big, which way up -- is already made by `prep/`, and `prep/cli.py` was written
so the API would call the same code path rather than a parallel one. Anything
here that starts to look like mesh logic belongs in `prep/` instead.

**Orientation is not baked at upload.** The CLI bakes it immediately, because
the CLI decides once and writes a file. Here the user is about to argue with the
solver, so the working mesh stays in its own coordinates and the chosen rotation
is applied at prepare time -- in the same order the CLI uses (rotate, ground,
level the base, scale), so both routes produce the same file.

**The browser preview is a preview.** It applies rotation and scale as a live
transform, which is exact, but it cannot show the base-levelling cut (§1) -- that
is real geometry work and happens server-side. The size the *prepare* call
returns is the authoritative one, and the UI shows that rather than its own.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from prep import analyze as analyze_mod
from prep import base as base_mod
from prep import handoff as handoff_mod
from prep import orient as orient_mod
from prep import size as size_mod
from prep.ingest import IngestError, TooLarge, load
from prep.profiles import (
    ProfileError,
    default_filament,
    default_process,
    list_printers,
    load_printer,
)
from prep.repair import repair
from prep.write3mf import write_project_3mf

from . import limits
from .geometry import (
    matrix_to_quaternion,
    preview_glb,
    quaternion_to_matrix,
    yaw_matrix,
)

# Jobs live on disk rather than in memory so a reload during development does
# not throw away an upload. §7 wants every artifact kept anyway: re-printing at
# a different size must not mean re-uploading, and the repaired mesh is the
# expensive part.
#
# JOBS_ROOT is set in the container, where the only reliably writable place is
# the tmpfs. Note what that means and does not mean: a job survives for as long
# as the instance does, which with the six-hour sweep is usually longer than
# anyone needs -- but an instance recycling mid-flow loses it, and the user has
# to upload again. Making that never happen means a bucket, not a bigger disk.
JOBS = Path(os.environ.get("JOBS_ROOT")
            or Path(__file__).resolve().parent.parent / "var" / "jobs")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Sweep on boot as well as on a timer: a container that restarts often
    # would otherwise never reach the first scheduled sweep.
    limits.sweep(JOBS)
    task = asyncio.create_task(limits.sweep_forever(JOBS))
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="print-prep", lifespan=lifespan)
uploads = limits.RateLimiter()

log = logging.getLogger("print-prep.api")

# Strong references to in-flight background work. See create_job().
_running: set = set()


@app.get("/api/health")
def health():
    """For the host's health check. Cheap on purpose -- it must answer while
    the solver is busy, which is the whole reason mesh work left the loop."""
    return {"ok": True}

# The PWA is served from a different origin in development (Vite on 5174,
# this on 8141). Tightened to an allowlist rather than "*" because these
# endpoints accept uploads.
# In production the PWA is served from Vercel and /api/* is *rewritten* through
# to here, so the browser only ever sees one origin and none of this applies.
# It stays for local development, where Vite is on another port, and for anyone
# pointing a different front end at this. Never "*": these endpoints take
# uploads.
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:5174,http://127.0.0.1:5174",
    ).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# --- what the browser sends -------------------------------------------------

class PrepareRequest(BaseModel):
    printer: str
    # three.js order (x, y, z, w). See api/geometry.py -- this is the one place
    # a convention mismatch would silently mirror the print.
    orientation: list[float] = Field(default=[0.0, 0.0, 0.0, 1.0], min_length=4,
                                     max_length=4)
    # A spin on the plate, applied after `orientation`. Separate from it on
    # purpose -- see the sizing note in prepare().
    yaw_deg: float = 0.0
    longest_mm: float | None = None
    material: str = "PLA"
    # "#rrggbb". Only affects the picture -- the actual colour is whatever
    # filament is loaded at print time -- but the picture is what the user
    # was looking at and what MakerWorld shows, so it should match.
    colour: str | None = None
    supports: bool = True
    flatten_base: bool = True


# --- job storage ------------------------------------------------------------

@dataclass
class Job:
    id: str
    name: str
    dir: Path
    meta: dict = field(default_factory=dict)

    @property
    def mesh_path(self) -> Path:
        return self.dir / "working.stl"

    def load_mesh(self):
        return trimesh.load(self.mesh_path, force="mesh")


def _job(job_id: str) -> Job:
    # Reject anything that is not the id we issued, rather than trusting it as
    # a path component -- this string reaches the filesystem.
    try:
        uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(404, "no such job")

    directory = JOBS / job_id
    meta_path = directory / "meta.json"
    if not meta_path.is_file():
        raise HTTPException(404, "no such job")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return Job(id=job_id, name=meta["name"], dir=directory, meta=meta)


# --- printers ---------------------------------------------------------------

# The nozzle a machine is fitted with is a slicer setting, and §6's non-goals
# are explicit that none of those belong in the primary flow. Resolving every
# profile gives four entries per machine that differ only by nozzle -- so the
# user picking "Bambu Lab A1" would be shown the same printer four times with
# identical beds and no way to tell them apart. `Prepare for printing.bat`
# already answers this by offering seven machines and fitting 0.4, which is what
# these printers ship with; this matches it.
DEFAULT_NOZZLE_MM = 0.4


@app.get("/api/printers")
def printers():
    """One entry per machine -- what the user actually owns -- with its bed.

    The bed is never hard-coded: it is resolved from the vendor profiles, so a
    printer added upstream appears here without a code change.
    """
    by_model: dict[str, dict] = {}
    for name in list_printers():
        try:
            p = load_printer(name)
        except ProfileError:
            continue

        entry = {
            "id": p.name,
            "model": p.model,
            "bed_mm": [p.bed_mm[0], p.bed_mm[1]],
            "height_mm": p.height_mm,
            "nozzle_mm": p.nozzle_mm,
            "exclude_areas": p.exclude_areas,
        }
        seen = by_model.get(p.model)
        # Prefer the stock nozzle; otherwise keep whichever came first, so a
        # machine with an unusual profile set still appears rather than vanishing.
        if seen is None or (seen["nozzle_mm"] != DEFAULT_NOZZLE_MM
                            and p.nozzle_mm == DEFAULT_NOZZLE_MM):
            by_model[p.model] = entry

    # Smallest bed first: it reads as a size ladder, and the A1 mini is the one
    # a model is most likely to be too big for.
    out = sorted(by_model.values(),
                 key=lambda e: (e["bed_mm"][0] * e["bed_mm"][1], e["model"]))
    return {"printers": out}


# --- upload -----------------------------------------------------------------

def _examine(source: Path, directory: Path):
    """Everything CPU-bound about an upload, in one blocking call.

    Pulled out so it can be handed to a worker thread whole. It used to run
    inline in an `async def`, which meant the ~9s the solver takes on a 20k-face
    mesh blocked the event loop -- no other request served, health check
    included. On a single-instance deploy that reads as an outage rather than as
    a slow upload.
    """
    ingested = load(source)
    mesh = ingested.mesh

    # Nozzle only affects the thin-wall threshold in the report; the real
    # printer is chosen later, and prepare() re-analyses against it.
    report = analyze_mod.analyze(mesh, unit_guess=ingested.unit_guess, nozzle_mm=0.4)

    repair_steps = []
    if not report.printable:
        mesh, log = repair(mesh, report=report, nozzle_mm=0.4)
        report = log.after
        repair_steps = [s.split(": ", 1)[-1] for s in log.steps]

    chosen, alternates = orient_mod.solve(mesh)
    mesh.export(directory / "working.stl")
    return ingested, mesh, report, repair_steps, chosen, alternates


async def _receive(file: UploadFile, destination: Path) -> None:
    """Stream the body to disk, refusing anything oversized as it arrives.

    Read in chunks rather than with `await file.read()`: that pulls the whole
    body into memory first, so a large upload costs the RAM before any limit
    can be applied to it.
    """
    written = 0
    with destination.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            written += len(chunk)
            if written > limits.MAX_UPLOAD_BYTES:
                raise HTTPException(
                    413,
                    f"That file is bigger than "
                    f"{limits.MAX_UPLOAD_BYTES // (1024 * 1024)} MB. "
                    f"Try exporting it again at a lower detail setting.")
            out.write(chunk)


WORKING, READY, FAILED = "working", "ready", "failed"


def _write_meta(directory: Path, meta: dict) -> None:
    """Write meta.json atomically.

    The browser polls this file's contents through `GET /api/jobs/{id}`. A
    plain write is not atomic, so a poll landing mid-write reads truncated JSON
    and the client sees a parse error rather than "still working" -- an error
    for something that is not wrong. Rename is atomic on both platforms.
    """
    temporary = directory / "meta.json.tmp"
    temporary.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    temporary.replace(directory / "meta.json")


def _describe(candidate) -> dict:
    return {
        "quaternion": matrix_to_quaternion(candidate.matrix),
        "reason": candidate.reason,
        "height_mm": round(float(candidate.height_mm), 1),
        "contact_mm2": round(float(candidate.contact_mm2), 1),
    }


async def _work(job_id: str, directory: Path, source: Path, name: str) -> None:
    """The examination, run after the response has already gone out."""
    base = {"name": name, "state": WORKING}
    try:
        ingested, mesh, report, repair_steps, chosen, alternates = (
            await limits.run_mesh_work(_examine, source, directory))
    except (TooLarge, IngestError) as exc:
        # Both already carry a plain-language message written for the user --
        # that is the whole point of prep.ingest's exception types, so pass it
        # through rather than inventing a worse one here.
        _write_meta(directory, {**base, "state": FAILED, "error": str(exc)})
        return
    except Exception as exc:                                   # noqa: BLE001
        # A crash must still reach the poller, or the browser waits for ever on
        # a job that will never finish. Logged in full, shown in the plainest
        # terms available -- and re-raised nowhere, because this is the top of
        # a background task and there is nothing above it to catch anything.
        log.exception("examining %s failed", job_id)
        _write_meta(directory, {
            **base, "state": FAILED,
            "error": "Something went wrong reading that model. Try another file.",
        })
        return

    _write_meta(directory, {
        **base,
        "state": READY,
        "unit_guess": ingested.unit_guess,
        "simplified_from": ingested.simplified_from,
        "repair_steps": repair_steps,
        "report": report.to_dict(),
        "native_size_mm": [round(float(v), 2) for v in mesh.extents],
        "orientations": [_describe(chosen)] + [_describe(a) for a in alternates],
    })


@app.post("/api/jobs", status_code=202)
async def create_job(request: Request, file: UploadFile):
    """Take the file, start looking at it, and answer straight away.

    This used to do the whole examination inline and return the result. At the
    measured speeds that was not tenable: 19s for a 20k-face mesh on Cloud Run,
    27s for a dense one, during which the browser has nothing to show and any
    gateway in the path is entitled to give up -- which Vercel's duly did, with
    a 502, on the third of three quick uploads.

    §4 said so from the start: "the request must not block. The PWA polls or
    subscribes for status." So: 202 and a job id, and the client asks
    `GET /api/jobs/{id}` until the state stops being `working`.
    """
    try:
        uploads.check(request.client.host if request.client else "unknown")
    except limits.TooManyRequests as exc:
        raise HTTPException(429, str(exc))

    job_id = str(uuid.uuid4())
    directory = JOBS / job_id
    directory.mkdir(parents=True, exist_ok=True)

    source = directory / f"source{Path(file.filename or 'model.stl').suffix}"
    try:
        await _receive(file, source)
    except HTTPException:
        shutil.rmtree(directory, ignore_errors=True)
        raise

    name = Path(file.filename or "model").stem
    # Written before the task starts, so a poll arriving immediately finds a
    # job rather than a 404.
    _write_meta(directory, {"name": name, "state": WORKING})

    # Held in a set because asyncio keeps only a weak reference to a task: drop
    # the last strong one and it can be garbage collected mid-flight, leaving a
    # job stuck at "working" for ever with nothing running.
    task = asyncio.create_task(_work(job_id, directory, source, name))
    _running.add(task)
    task.add_done_callback(_running.discard)

    return {"job_id": job_id, "name": name, "state": WORKING}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    """Where a job has got to, and its result once it has one."""
    job = _job(job_id)
    return {"job_id": job.id, **job.meta}


@app.get("/api/jobs/{job_id}/mesh.glb")
def mesh_glb(job_id: str):
    """The model for the browser to draw, in its own coordinates."""
    job = _job(job_id)
    cached = job.dir / "preview.glb"
    if not cached.is_file():
        cached.write_bytes(preview_glb(job.load_mesh()))
    return Response(cached.read_bytes(), media_type="model/gltf-binary")


# --- prepare ----------------------------------------------------------------

@app.post("/api/jobs/{job_id}/prepare")
def prepare(job_id: str, req: PrepareRequest):
    """Apply what the user chose and write the three files they leave with.

    The order matters and matches prep/cli.py exactly: rotate, ground, level the
    base, then scale. Levelling before scaling means the 8% height cap is
    measured against the model rather than against whatever size was asked for.
    """
    job = _job(job_id)
    if job.meta.get("state") != READY:
        # Without this the caller gets a FileNotFoundError on working.stl, which
        # is a 500 describing an internal path rather than "not finished yet".
        raise HTTPException(409, "That model is still being looked at.")

    try:
        printer = load_printer(req.printer)
    except ProfileError as exc:
        raise HTTPException(400, str(exc))

    mesh = job.load_mesh()
    report = analyze_mod.analyze(mesh, unit_guess="mm", nozzle_mm=printer.nozzle_mm)

    try:
        rotation = quaternion_to_matrix(req.orientation)
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    mesh = mesh.copy()
    mesh.apply_transform(rotation)
    mesh.apply_translation([0, 0, -float(mesh.bounds[0][2])])

    flattened = None
    if req.flatten_base:
        mesh, flattened = base_mod.flatten_base(mesh)

    # "How big" must mean the object, not its shadow on the plate.
    #
    # The obvious implementation measures the longest side of the axis-aligned
    # bounding box of whatever pose is current. That is wrong the moment a spin
    # is involved: turning a 40x30 box a quarter of the way round grows its
    # bounding box to about 49x49, so holding "longest side = 40 mm" shrinks the
    # actual object to four-fifths of the size the user asked for. They turned
    # it; they did not ask for it to get smaller.
    #
    # So the scale is fixed against the *unspun* pose and the spin is applied
    # afterwards. The size that comes back still describes the real yawed model,
    # and the build-volume clamp still measures the real footprint -- only the
    # thing the slider is proportional to changes.
    sizing_basis = float(max(mesh.extents))

    if req.yaw_deg:
        mesh.apply_transform(yaw_matrix(req.yaw_deg))
        mesh.apply_translation([0, 0, -float(mesh.bounds[0][2])])

    if req.longest_mm:
        sizing = size_mod.apply(mesh, report, printer,
                                scale=float(req.longest_mm) / sizing_basis)
    else:
        sizing = size_mod.apply(mesh, report, printer, scale=1.0)

    scaled = mesh.copy()
    scaled.apply_scale(sizing.scale)

    out_dir = job.dir / "out"
    if out_dir.exists():
        shutil.rmtree(out_dir)         # re-preparing replaces, never accumulates
    out_dir.mkdir(parents=True)

    # Named for the size that was asked for, so two spins of the same model
    # at the same size do not become two differently-named files.
    asked = req.longest_mm or sizing.longest_mm
    stem = f"{job.name}-{round(min(asked, sizing.longest_mm))}mm"
    written = write_project_3mf(
        out_dir / f"{stem}.3mf", scaled, printer,
        title=f"{job.name}.stl",
        orientation=None,                      # already baked in above
        process=default_process(printer.name),
        filament=default_filament(printer.name, material=req.material),
        supports=req.supports,
        colour=req.colour,
    )

    preview_path = out_dir / f"{stem}-preview.png"
    if written.preview_png:
        preview_path.write_bytes(written.preview_png)

    x, y, z = (round(v, 1) for v in written.size_mm)
    instructions = handoff_mod.write(
        out_dir / f"{stem} - how to print this.html",
        model_name=job.name,
        file_name=written.path.name,
        printer=written.printer,
        size_text=f"{x} x {y} x {z} mm - {sizing.comparison}",
        material=req.material,
        preview=preview_path if written.preview_png else None,
    )

    return {
        "job_id": job.id,
        "size_mm": [x, y, z],
        "comparison": sizing.comparison,
        "warning": sizing.warning,
        "fits": written.fits,
        "min_wall_mm": sizing.min_wall_mm,
        "flattened": flattened.note if flattened else None,
        "printer": written.printer,
        "filament": written.filament,
        "files": [
            {"kind": "model", "name": written.path.name},
            {"kind": "picture", "name": preview_path.name},
            {"kind": "instructions", "name": instructions.path.name},
        ],
    }


@app.get("/api/jobs/{job_id}/files/{name}")
def download(job_id: str, name: str):
    job = _job(job_id)
    # Resolve and confine: `name` comes off the wire and must not escape.
    target = (job.dir / "out" / name).resolve()
    if not target.is_file() or job.dir.resolve() not in target.parents:
        raise HTTPException(404, "no such file")
    return FileResponse(target, filename=name)
