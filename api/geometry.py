"""Conversions between what the browser sends and what the pipeline expects.

This module exists for one reason: **there is a convention mismatch between
three.js and trimesh, and it fails silently.** three.js orders a quaternion
``(x, y, z, w)``; `trimesh.transformations` orders it ``(w, x, y, z)``. Feed one
to the other and you get a valid rotation matrix describing a different
rotation, so nothing raises, nothing looks obviously wrong, and the printed
object comes out in a pose the user did not choose.

This project has already been bitten once by exactly this class of bug -- the
3MF build transform is row-vector, and emitting it untransposed prints mirrored
with nothing downstream to catch it (see prep/write3mf.py). That one cost real
time because bounding boxes cannot tell the two apart. So the browser boundary
gets the same treatment: one documented conversion, in one place, with tests
that check the *effect* on geometry rather than the numbers.
"""

from __future__ import annotations

import numpy as np


def quaternion_to_matrix(quat) -> np.ndarray:
    """A three.js ``(x, y, z, w)`` quaternion as a 4x4 column-vector matrix.

    Column-vector because that is what ``mesh.apply_transform`` wants and what
    ``place_on_bed`` composes with. The 3MF writer transposes on the way out;
    that is its job, not ours.
    """
    x, y, z, w = (float(v) for v in quat)

    norm = np.sqrt(x * x + y * y + z * z + w * w)
    if norm < 1e-12:
        raise ValueError("quaternion has no length")
    x, y, z, w = x / norm, y / norm, z / norm, w / norm

    matrix = np.eye(4)
    matrix[:3, :3] = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w)],
        [2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y)],
    ]
    return matrix


def matrix_to_quaternion(matrix) -> list:
    """Inverse, in three.js order, so the solver's picks can be sent to the UI."""
    m = np.asarray(matrix, dtype=float)[:3, :3]
    trace = float(np.trace(m))

    if trace > 0:
        s = np.sqrt(trace + 1.0) * 2
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = np.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = np.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = np.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s

    return [float(x), float(y), float(z), float(w)]


def preview_glb(mesh, max_faces: int = 40_000) -> bytes:
    """The mesh as GLB, decimated enough to move over a phone connection.

    Sent in the model's **own** coordinates, unrotated and unscaled: the browser
    applies orientation and size as a live transform, so those stay instant and
    need no round trip. The server re-derives both from what the user confirms.
    """
    import trimesh

    display = mesh
    if len(mesh.faces) > max_faces:
        try:
            import fast_simplification
            verts, faces = fast_simplification.simplify(
                np.asarray(mesh.vertices, dtype=np.float32),
                np.asarray(mesh.faces, dtype=np.int32),
                target_count=max_faces,
            )
            display = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
        except ImportError:
            pass    # a slow preview beats no preview; not a broad except

    return trimesh.exchange.gltf.export_glb(trimesh.Scene(display))


def yaw_matrix(degrees: float) -> np.ndarray:
    """Rotation about the bed's Z axis -- a spin, not a tumble.

    Kept separate from the pose quaternion because the two answer different
    questions and must not be conflated when sizing: the quaternion decides
    *which face is down*, and this decides *how far round it is stood* on that
    face. The face on the plate is the same at every angle, so a spin can never
    make a model need supports it did not need a moment ago.
    """
    radians = np.radians(float(degrees))
    cos, sin = np.cos(radians), np.sin(radians)
    matrix = np.eye(4)
    matrix[:3, :3] = [[cos, -sin, 0], [sin, cos, 0], [0, 0, 1]]
    return matrix
