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
import zipfile

import numpy as np
import pytest
import trimesh
from fastapi.testclient import TestClient

from api.geometry import matrix_to_quaternion, quaternion_to_matrix
from api.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def box_stl():
    """40 x 30 x 20 -- asymmetric, so any axis swap or mirror is visible."""
    mesh = trimesh.creation.box(extents=(40, 30, 20))
    return mesh.export(file_type="stl")


@pytest.fixture
def job(client, box_stl):
    r = client.post("/api/jobs",
                    files={"file": ("box.stl", box_stl, "application/octet-stream")})
    assert r.status_code == 200
    return r.json()


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
    r = client.post("/api/jobs",
                    files={"file": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 400
    assert r.json()["detail"]


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
