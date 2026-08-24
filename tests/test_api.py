"""The HTTP layer, Milestone 3.

The interesting tests here are not about status codes. They are about the two
boundaries where this layer can silently corrupt a print:

* **The quaternion convention.** three.js orders (x, y, z, w); trimesh orders
  (w, x, y, z). Swap them and you get a valid rotation describing a different
  one -- nothing raises, and the object prints in a pose nobody chose. Same
  class of bug as the row-vector transform in prep/write3mf.py, which cost real
  time precisely because bounding boxes cannot see it.
* **Agreement between preview and result.** The browser previews a pose by
  transforming the mesh itself. If the server bakes something else, the user is
  shown one thing and given another.

So these check the *effect on geometry*, never the numbers.
"""

from __future__ import annotations

import io
import json
import time
import zipfile

import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient

from api import limits, main
from api.geometry import matrix_to_quaternion, quaternion_to_matrix
from api.main import app


@pytest.fixture(autouse=True)
def _fresh_limits():
    """A test suite uploads far more than a person would.

    Without this the limiter does its job and starts returning 429 halfway
    through the run -- which is the limiter being right and the suite being
    wrong. Reset per test rather than raising the limit, so the number under
    test stays the number that ships.
    """
    main.uploads.reset()
    yield
    main.uploads.reset()


@pytest.fixture
def client():
    """As a context manager, which matters now that uploads are asynchronous.

    A bare `TestClient(app)` never runs the lifespan, so the app's event loop
    does not tick between requests and a task scheduled by an upload never
    progresses -- every job sits at "working" for ever and every test times
    out. The context manager form runs the real startup and keeps the loop
    alive, which is also what production does.
    """
    with TestClient(app) as c:
        yield c


def wait_for(client, job_id, *, timeout=90.0):
    """Poll a job to completion, the way the browser does."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/api/jobs/{job_id}").json()
        if body["state"] != "working":
            return body
        time.sleep(0.2)
    raise AssertionError(f"job {job_id} never left 'working'")


def upload(client, data, name="box.stl"):
    """Upload and wait, for tests that care about the result and not the wait."""
    r = client.post("/api/jobs",
                    files={"file": (name, data, "application/octet-stream")})
    assert r.status_code == 202, r.text
    return wait_for(client, r.json()["job_id"])


@pytest.fixture
def box_stl():
    """40 x 30 x 20 -- asymmetric, so any axis swap or mirror is visible."""
    mesh = trimesh.creation.box(extents=(40, 30, 20))
    return mesh.export(file_type="stl")


@pytest.fixture
def job(client, box_stl):
    body = upload(client, box_stl)
    assert body["state"] == "ready", body.get("error")
    return {"job_id": body["job_id"], **body}


# --- the convention boundary ------------------------------------------------

@pytest.mark.parametrize("seed", range(25))
def test_quaternion_matches_an_independent_implementation(seed):
    rng = np.random.default_rng(seed)
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)

    ours = quaternion_to_matrix(q)
    # trimesh takes (w, x, y, z). If our ordering were wrong this is where it
    # would show, and nowhere else.
    theirs = trimesh.transformations.quaternion_matrix([q[3], q[0], q[1], q[2]])
    assert np.allclose(ours, theirs, atol=1e-9)


@pytest.mark.parametrize("seed", range(25))
def test_quaternion_survives_a_round_trip(seed):
    rng = np.random.default_rng(seed)
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    matrix = quaternion_to_matrix(q)
    assert np.allclose(quaternion_to_matrix(matrix_to_quaternion(matrix)),
                       matrix, atol=1e-9)


def test_a_rotation_is_never_a_reflection():
    """A mirrored model prints as its own opposite and nothing downstream
    notices -- the determinant is the only cheap way to see it."""
    rng = np.random.default_rng(0)
    for _ in range(50):
        q = rng.normal(size=4)
        q /= np.linalg.norm(q)
        assert np.linalg.det(quaternion_to_matrix(q)[:3, :3]) == pytest.approx(1.0)


def test_a_zero_quaternion_is_refused_rather_than_producing_nonsense():
    with pytest.raises(ValueError):
        quaternion_to_matrix([0, 0, 0, 0])


# --- printers ---------------------------------------------------------------

def test_printers_are_listed_once_per_machine_not_once_per_nozzle(client):
    """Resolving every profile gives four entries per machine differing only by
    a nozzle the user never chose -- and §6's non-goals bar slicer settings from
    the primary flow entirely."""
    printers = client.get("/api/printers").json()["printers"]
    models = [p["model"] for p in printers]
    assert len(models) == len(set(models)), "a machine is listed more than once"
    assert all(p["nozzle_mm"] == 0.4 for p in printers)


def test_printers_carry_a_real_bed_from_the_profiles(client):
    printers = {p["model"]: p for p in client.get("/api/printers").json()["printers"]}
    assert printers["Bambu Lab A1 mini"]["bed_mm"] == [180.0, 180.0]
    assert printers["Bambu Lab P1S"]["bed_mm"] == [256.0, 256.0]


def test_printers_are_ordered_smallest_bed_first(client):
    printers = client.get("/api/printers").json()["printers"]
    areas = [p["bed_mm"][0] * p["bed_mm"][1] for p in printers]
    assert areas == sorted(areas)


# --- upload -----------------------------------------------------------------

def test_upload_reports_the_size_it_actually_read(job):
    assert sorted(job["native_size_mm"], reverse=True) == [40.0, 30.0, 20.0]


def test_upload_offers_the_solver_pick_and_alternates(job):
    assert len(job["orientations"]) >= 2
    assert job["orientations"][0]["reason"]


def test_the_mesh_is_served_as_glb_in_the_pipelines_own_coordinates(client, job):
    r = client.get(f"/api/jobs/{job['job_id']}/mesh.glb")
    assert r.status_code == 200
    assert r.content[:4] == b"glTF"

    # No Y-up conversion on the way out: the browser sets its camera up-vector
    # to Z instead, so nothing is converted anywhere. If this ever starts
    # failing, the viewer will be showing a model lying on its side.
    back = trimesh.load(io.BytesIO(r.content), file_type="glb", force="mesh")
    assert sorted(np.round(back.extents, 3), reverse=True) == [40.0, 30.0, 20.0]


# --- the preview must equal the result --------------------------------------

@pytest.mark.parametrize("quat,expected", [
    ([0, 0, 0, 1], [40, 30, 20]),                                  # untouched
    ([0.7071067811865476, 0, 0, 0.7071067811865476], [40, 20, 30]),  # 90 about X
    ([0, 0.7071067811865476, 0, 0.7071067811865476], [20, 30, 40]),  # 90 about Y
    ([0, 0, 0.7071067811865476, 0.7071067811865476], [30, 40, 20]),  # 90 about Z
])
def test_the_server_bakes_the_pose_the_browser_previewed(client, job, quat, expected):
    """The browser rotates the mesh itself to draw the preview. The server must
    land on the same footprint, or the user is shown one thing and given
    another. Checked as a footprint, because that is what a mirror would change
    and a bounding box alone would not."""
    r = client.post(f"/api/jobs/{job['job_id']}/prepare",
                    json={"printer": "Bambu Lab P1S 0.4 nozzle",
                          "orientation": quat, "flatten_base": False})
    assert r.status_code == 200
    assert sorted(r.json()["size_mm"]) == sorted(float(v) for v in expected)


def test_scaling_is_uniform_and_hits_the_asked_for_longest_side(client, job):
    r = client.post(f"/api/jobs/{job['job_id']}/prepare",
                    json={"printer": "Bambu Lab P1S 0.4 nozzle",
                          "orientation": [0, 0, 0, 1], "longest_mm": 100,
                          "flatten_base": False})
    assert r.json()["size_mm"] == [100.0, 75.0, 50.0]      # 40:30:20 preserved


def test_asking_for_more_than_the_bed_clamps_to_the_bed_and_says_so(client, job):
    """§6.2 wants a hard ceiling, not an error after the fact: "show the ceiling
    rather than erroring after". So 300 mm on a 180 mm bed is not a failure --
    it is 180 mm and a sentence explaining why. The file still fits."""
    r = client.post(f"/api/jobs/{job['job_id']}/prepare",
                    json={"printer": "Bambu Lab A1 mini 0.4 nozzle",
                          "orientation": [0, 0, 0, 1], "longest_mm": 300,
                          "flatten_base": False}).json()

    assert max(r["size_mm"]) == 180.0          # filled the bed, did not exceed it
    assert r["size_mm"] == [180.0, 135.0, 90.0]   # and stayed in proportion
    assert r["fits"] is True
    assert r["warning"] and "as big as" in r["warning"]
    # The warning is what the user reads, so it obeys the §6 copy rules too.
    assert "build volume" not in r["warning"].lower()


# --- what the user leaves with ----------------------------------------------

def test_prepare_produces_the_same_three_files_the_launcher_does(client, job):
    files = client.post(f"/api/jobs/{job['job_id']}/prepare",
                        json={"printer": "Bambu Lab P1S 0.4 nozzle",
                              "orientation": [0, 0, 0, 1], "longest_mm": 80}
                        ).json()["files"]
    assert {f["kind"] for f in files} == {"model", "picture", "instructions"}


def test_the_written_container_is_the_one_makerworld_accepts(client, job):
    """The API must not drift from prep/. Same writer, same container."""
    body = client.post(f"/api/jobs/{job['job_id']}/prepare",
                       json={"printer": "Bambu Lab P1S 0.4 nozzle",
                             "orientation": [0, 0, 0, 1], "longest_mm": 80}).json()
    name = next(f["name"] for f in body["files"] if f["kind"] == "model")
    r = client.get(f"/api/jobs/{job['job_id']}/files/{name}")
    members = set(zipfile.ZipFile(io.BytesIO(r.content)).namelist())
    assert "3D/Objects/object_1.model" in members
    assert "Metadata/plate_1.png" in members
    assert len(members) == 15


def test_re_preparing_replaces_the_old_files_rather_than_piling_up(client, job):
    for longest in (60, 90):
        client.post(f"/api/jobs/{job['job_id']}/prepare",
                    json={"printer": "Bambu Lab P1S 0.4 nozzle",
                          "orientation": [0, 0, 0, 1], "longest_mm": longest})
    stale = client.get(f"/api/jobs/{job['job_id']}/files/box-60mm.3mf")
    assert stale.status_code == 404


# --- untrusted input --------------------------------------------------------

def test_a_job_id_that_is_not_ours_is_refused(client):
    assert client.get("/api/jobs/not-a-uuid/mesh.glb").status_code == 404


def test_a_filename_cannot_escape_the_job_directory(client, job):
    # `name` reaches the filesystem, so it gets confined rather than trusted.
    r = client.get(f"/api/jobs/{job['job_id']}/files/../../meta.json")
    assert r.status_code == 404


def test_a_file_that_is_not_a_model_is_rejected_with_a_reason(client):
    """The rejection now arrives through the poll, not the upload.

    The upload cannot know: it answers before anything has looked at the file.
    So the failure has to survive into the job's state and carry a message the
    user can act on -- §6, every error names the recovery.
    """
    body = upload(client, b"hello", name="notes.txt")
    assert body["state"] == "failed"
    assert body["error"]


# --- yaw: turning the model on the face it is already resting on ------------
#
# The distinction that matters is between tipping and spinning. Tipping changes
# which face is down, and so changes what the print needs to hold it up.
# Spinning cannot: the same face stays on the plate at every angle. Anything
# here that lets a spin alter the height is a bug, because it would mean the
# down-face moved.

def _prepared(client, job, **body):
    payload = {"printer": "Bambu Lab P1S 0.4 nozzle", "orientation": [0, 0, 0, 1],
               "flatten_base": False, **body}
    r = client.post(f"/api/jobs/{job['job_id']}/prepare", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("yaw", [0, 30, 45, 90, 135, 180, 270, 359])
def test_a_spin_never_changes_the_height(client, job, yaw):
    """Height is the tell. If it moves, the face on the plate moved with it."""
    body = _prepared(client, job, yaw_deg=yaw, longest_mm=40)
    assert body["size_mm"][2] == pytest.approx(20.0, abs=0.05)


@pytest.mark.parametrize("yaw", [0, 45, 90, 180, 270])
def test_a_spin_never_resizes_the_object(client, job, yaw):
    """The bug this replaced: scale was pinned to the longest side of the
    axis-aligned box, which *grows* on the diagonal -- so asking for 40 mm and
    then turning the model quietly shrank it to about 32. The user turned it;
    they did not ask for it to get smaller."""
    body = _prepared(client, job, yaw_deg=yaw, longest_mm=40)
    # 40 x 30 x 20 at any spin still has the same volume and the same height.
    assert sorted(body["size_mm"])[0] == pytest.approx(20.0, abs=0.05)
    assert body["size_mm"][2] == pytest.approx(20.0, abs=0.05)


def test_a_quarter_turn_swaps_the_footprint(client, job):
    body = _prepared(client, job, yaw_deg=90, longest_mm=40)
    assert body["size_mm"] == pytest.approx([30.0, 40.0, 20.0], abs=0.05)


def test_a_half_turn_returns_the_footprint_it_started_with(client, job):
    assert (_prepared(client, job, yaw_deg=180, longest_mm=40)["size_mm"]
            == pytest.approx([40.0, 30.0, 20.0], abs=0.05))


def test_turning_across_the_corner_widens_the_footprint(client, job):
    """A 40x30 box on the diagonal covers about 49x49 -- more plate, same object.
    The UI leans on this: it is why a long model can fit a bed it otherwise
    would not, and why the size ceiling has to move when the spin does."""
    straight = _prepared(client, job, yaw_deg=0, longest_mm=40)["size_mm"]
    diagonal = _prepared(client, job, yaw_deg=45, longest_mm=40)["size_mm"]
    assert diagonal[0] > straight[0]
    assert diagonal[1] > straight[1]
    assert diagonal[2] == pytest.approx(straight[2], abs=0.05)


def test_the_spin_composes_after_the_pose_not_before(client, job):
    """Yaw is about the *bed's* Z, applied to the already-placed model. Compose
    it the other way round and it turns about whatever axis Z was before the
    face came down, which reads as the model tumbling off the plate."""
    # Lay the box on its side first (90 about X: 40 x 30 x 20 -> 40 x 20 x 30),
    # then spin a quarter turn. A bed-Z spin swaps the footprint and leaves the
    # height alone; a body-Z spin would move the height.
    on_side = [0.7071067811865476, 0, 0, 0.7071067811865476]
    body = _prepared(client, job, orientation=on_side, yaw_deg=90, longest_mm=40)
    assert body["size_mm"][2] == pytest.approx(30.0, abs=0.05)
    assert sorted(body["size_mm"][:2]) == pytest.approx([20.0, 40.0], abs=0.05)


def test_the_yaw_matrix_is_a_rotation_about_z_and_nothing_else():
    from api.geometry import yaw_matrix
    for deg in (0, 17, 90, 180, 359):
        m = yaw_matrix(deg)
        assert np.linalg.det(m[:3, :3]) == pytest.approx(1.0)
        # Z is untouched, which is the whole point.
        assert m[:3, 2] == pytest.approx([0, 0, 1])
        assert m[2, :3] == pytest.approx([0, 0, 1])


def test_a_spin_still_gets_clamped_to_the_bed(client, job):
    """Turning a big model across the corner needs more plate, not less, so the
    ceiling has to tighten -- the file must never come out bigger than the bed."""
    body = _prepared(client, job, yaw_deg=45, longest_mm=400,
                     printer="Bambu Lab A1 mini 0.4 nozzle")
    assert body["fits"] is True
    assert max(body["size_mm"][:2]) <= 180.0 + 1e-6


# --- what a public URL needs ------------------------------------------------
#
# None of this matters on localhost. All of it matters the moment the address
# is reachable, and each one is a way an ordinary day takes the service down.

def test_the_health_check_answers(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_uploads_are_rate_limited_per_caller(client, box_stl):
    """Unauthenticated uploads mean anyone with the URL can spend the CPU."""
    limit = limits.RATE_LIMIT
    for _ in range(limit):
        r = client.post("/api/jobs",
                        files={"file": ("box.stl", box_stl, "application/octet-stream")})
        assert r.status_code == 202

    blocked = client.post("/api/jobs",
                          files={"file": ("box.stl", box_stl, "application/octet-stream")})
    assert blocked.status_code == 429


def test_the_rate_limit_message_says_what_to_do_not_what_broke(client, box_stl):
    # §6: every error names the recovery. "429 Too Many Requests" does not.
    for _ in range(limits.RATE_LIMIT):
        client.post("/api/jobs",
                    files={"file": ("box.stl", box_stl, "application/octet-stream")})
    detail = client.post(
        "/api/jobs",
        files={"file": ("box.stl", box_stl, "application/octet-stream")},
    ).json()["detail"]

    assert "try again" in detail.lower()
    for jargon in ("rate", "429", "quota", "throttle"):
        assert jargon not in detail.lower()


def test_an_oversized_upload_is_refused(client, monkeypatch):
    monkeypatch.setattr(limits, "MAX_UPLOAD_BYTES", 1024)
    r = client.post("/api/jobs",
                    files={"file": ("big.stl", b"x" * 4096, "application/octet-stream")})
    assert r.status_code == 413
    assert "bigger than" in r.json()["detail"]


def test_a_refused_upload_leaves_nothing_on_disk(client, monkeypatch):
    """A rejected upload that still costs disk is the same leak, slower."""
    before = len(list(main.JOBS.iterdir())) if main.JOBS.is_dir() else 0
    monkeypatch.setattr(limits, "MAX_UPLOAD_BYTES", 1024)
    client.post("/api/jobs",
                files={"file": ("big.stl", b"x" * 4096, "application/octet-stream")})
    after = len(list(main.JOBS.iterdir())) if main.JOBS.is_dir() else 0
    assert after == before


def test_a_failed_job_keeps_its_directory_so_the_error_survives(client):
    """The opposite of the oversized case, and deliberately so.

    An upload refused at the door leaves nothing behind, because there is no
    job. One that fails while being examined has already answered 202 with an
    id, and the browser is polling that id -- delete the directory and the poll
    404s, turning a legible "that is not a model we can read" into "your job
    vanished". The sweep clears it later.
    """
    body = upload(client, b"hello", name="notes.txt")
    assert body["state"] == "failed"
    assert (main.JOBS / body["job_id"] / "meta.json").is_file()


# --- the sweep --------------------------------------------------------------

def test_the_sweep_removes_jobs_past_the_window(tmp_path):
    import os
    import time

    old = tmp_path / "stale"
    fresh = tmp_path / "current"
    for d in (old, fresh):
        d.mkdir()
        (d / "meta.json").write_text("{}")

    long_ago = time.time() - (limits.JOB_TTL_SECONDS + 60)
    os.utime(old, (long_ago, long_ago))

    assert limits.sweep(tmp_path) == 1
    assert not old.exists()
    assert fresh.exists()


def test_the_sweep_spares_a_job_someone_is_still_working_on(tmp_path):
    """prepare() rewrites out/ and touches the directory, so an open tab keeps
    its job alive rather than having it deleted underneath the user."""
    import os
    import time

    job = tmp_path / "active"
    job.mkdir()
    recent = time.time() - 60
    os.utime(job, (recent, recent))

    assert limits.sweep(tmp_path) == 0
    assert job.exists()


def test_the_sweep_ignores_stray_files_next_to_the_jobs(tmp_path):
    (tmp_path / "README").write_text("not a job")
    assert limits.sweep(tmp_path) == 0
    assert (tmp_path / "README").exists()


def test_the_sweep_copes_with_a_directory_that_is_not_there(tmp_path):
    assert limits.sweep(tmp_path / "nope") == 0


# --- concurrency ------------------------------------------------------------

def test_mesh_work_is_capped_below_the_core_count():
    """More threads than cores buys nothing on CPU-bound work and makes every
    request slower at once -- the failure that looks like a hang, not a queue."""
    assert 1 <= limits.MAX_CONCURRENT_JOBS <= 4


def test_the_upload_path_does_not_block_the_event_loop():
    """The solver takes ~9s on a 20k-face mesh. Inline in an `async def` that
    froze the whole process, health check included. This asserts the heavy work
    is reachable as a plain function so it can be handed to a thread."""
    import inspect

    assert not inspect.iscoroutinefunction(main._examine)
    assert inspect.iscoroutinefunction(limits.run_mesh_work)


# --- 202 and poll -----------------------------------------------------------
#
# The measured reason this exists: 19s for a 20k-face mesh on Cloud Run, 27s
# for a dense one. Held open, that is long enough for a gateway to give up --
# Vercel's did, with a 502, on the third of three quick uploads. §4 called it
# before any of this was written: "the request must not block."

def test_the_upload_answers_immediately_rather_than_waiting(client):
    """The point of the whole change: answer before the work, not after."""
    heavy = trimesh.creation.icosphere(subdivisions=4).export(file_type="stl")

    started = time.monotonic()
    r = client.post("/api/jobs",
                    files={"file": ("ball.stl", heavy, "application/octet-stream")})
    elapsed = time.monotonic() - started

    assert r.status_code == 202
    assert r.json()["state"] == "working"
    # Generously loose: this asserts "did not wait for the solver", not a
    # latency budget. The solver alone is seconds even on this machine.
    assert elapsed < 5.0


def test_a_job_is_pollable_the_instant_it_is_created(client, box_stl):
    """meta.json is written before the task starts, so a poll that arrives
    immediately finds a job rather than a 404 it has to learn to retry."""
    job_id = client.post(
        "/api/jobs",
        files={"file": ("box.stl", box_stl, "application/octet-stream")},
    ).json()["job_id"]

    assert client.get(f"/api/jobs/{job_id}").status_code == 200


def test_polling_reaches_ready_and_carries_the_whole_report(client, box_stl):
    body = upload(client, box_stl)
    assert body["state"] == "ready"
    assert body["orientations"]
    assert body["report"]
    assert sorted(body["native_size_mm"], reverse=True) == [40.0, 30.0, 20.0]


def test_a_crash_while_examining_still_reaches_the_poller(client, monkeypatch):
    """A background task that dies silently leaves the browser waiting for ever.

    Whatever goes wrong has to end up in the job's state, because after a 202
    there is no request left to fail.
    """
    def explode(*_args, **_kwargs):
        raise RuntimeError("solver went bang")

    monkeypatch.setattr(main, "_examine", explode)
    body = upload(client, trimesh.creation.box().export(file_type="stl"))

    assert body["state"] == "failed"
    assert body["error"]
    assert "bang" not in body["error"]        # the user gets prose, not a traceback


def test_preparing_a_job_that_is_not_ready_says_so(client, box_stl):
    """Without this the caller gets a FileNotFoundError on working.stl -- a 500
    naming an internal path, for the entirely ordinary situation of being early."""
    job_id = client.post(
        "/api/jobs",
        files={"file": ("box.stl", box_stl, "application/octet-stream")},
    ).json()["job_id"]

    r = client.post(f"/api/jobs/{job_id}/prepare",
                    json={"printer": "Bambu Lab P1S 0.4 nozzle"})
    assert r.status_code in (409, 200)        # 200 only if it finished that fast
    if r.status_code == 409:
        assert "still" in r.json()["detail"].lower()


def test_meta_is_written_atomically(client, box_stl):
    """The browser polls this file's contents. A torn read is a parse error in
    the client for something that is not actually wrong, so the write goes to a
    temporary and is renamed into place."""
    job_id = client.post(
        "/api/jobs",
        files={"file": ("box.stl", box_stl, "application/octet-stream")},
    ).json()["job_id"]

    # Hammer it while the task runs; every read must be valid JSON.
    for _ in range(60):
        body = client.get(f"/api/jobs/{job_id}")
        assert body.status_code == 200
        assert body.json()["state"] in ("working", "ready", "failed")
        if body.json()["state"] != "working":
            break
        time.sleep(0.05)


def test_a_job_id_that_was_never_issued_is_still_a_404(client):
    import uuid as _uuid
    assert client.get(f"/api/jobs/{_uuid.uuid4()}").status_code == 404
