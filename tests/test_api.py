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
