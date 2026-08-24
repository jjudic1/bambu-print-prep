"""Render the plate thumbnails, without a GPU, a display, or a slicer.

Dropping the Bambu Studio dependency takes the pictures with it. ``plate_1.png``
and its four siblings are produced by Bambu Studio's own renderer, and
``prep.bambu.extract_preview`` has been pulling one out of its export to serve
two separate needs: the gallery image MakerWorld asks for at upload, and the
picture on the §6.5 how-to page. Both have to keep working, so the renderer is
not optional -- it is a precondition for the whole exercise.

**Why a software rasteriser rather than a real one.** Everything else in the
Phase C plan is a small Python worker; putting OpenGL back in to draw a 512px
thumbnail would re-import the problem we are removing. pyrender wants EGL or
OSMesa, pyglet wants a display, and both want a container that is no longer
small. A z-buffered triangle rasteriser in numpy is about a hundred lines, has
no system dependencies at all, and is deterministic -- which also makes it
testable, where a GL context is not.

PNGs are written with ``zlib`` directly for the same reason. Pillow happens to
be installed here as somebody's transitive dependency, and relying on that would
be relying on an accident.

**This does not try to match Bambu Studio pixel for pixel** and could not: its
renders carry plate texture, logo and lighting rig. The claim is only that these
are plausible renders of the right thing at the right size, which is what the
upload and the how-to page actually need. Whether MakerWorld inspects their
*content* is unknown and is one of the things the single test upload settles.
"""

from __future__ import annotations

import struct
import zlib
from dataclasses import dataclass

import numpy as np

# Bambu Studio renders a plate at 512; the small sibling is 128. Matching those
# costs nothing and means the container is not obviously different by shape.
PLATE_PX = 512
SMALL_PX = 128

# Rasterising every triangle of a dense scan is wasted at 512px -- the proxy is
# invisible at this size and keeps a slow Python loop short. The orientation
# solver already leans on fast_simplification for the same reason.
MAX_FACES = 8000

# Bambu's own filament green, near enough. The picture is the first thing the
# user sees of their model, so it should look like an object, not a debug view.
# Overridable per render, because the app lets the user pick a colour and the
# picture that goes to MakerWorld should be the one they were looking at.
MODEL_RGB = (0.13, 0.66, 0.33)


def parse_colour(value, fallback=MODEL_RGB):
    """Accept "#rrggbb" from the browser; fall back rather than fail.

    A malformed colour is not worth losing a prepared model over -- the picture
    is a nicety and the file is the point.
    """
    if not value:
        return fallback
    text = str(value).strip().lstrip("#")
    if len(text) != 6:
        return fallback
    try:
        return tuple(int(text[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return fallback
BACKGROUND_RGBA = (0, 0, 0, 0)      # transparent: the page supplies its own bg

# Where the eye is, as a direction from the model towards the camera. Positive
# Z means above the plate, which is the only place a picture of a print should
# ever be taken from.
#
# This vector used to be fed to the camera as the *look* direction, which is its
# exact opposite, so every render was made from underneath the plate looking up.
# It survived review because the test model was a box with a cylinder centred on
# top, and that is very nearly symmetrical about the plate: from below it still
# reads as a plausible object. A slab with a spike on it does not -- from below
# the spike is hidden behind the slab and only clears the far silhouette edge,
# which is what finally made it obvious.
#
# So the name now means what it says and `_camera` negates it once, in one place.
EYE_DIR = np.array([0.62, -0.72, 0.46])
TOP_DOWN = np.array([0.0, 0.0, 1.0])
UP = np.array([0.0, 0.0, 1.0])


@dataclass
class Thumbnails:
    """The five members Bambu Studio writes, as raw PNG bytes."""

    plate: bytes            # Metadata/plate_1.png        512, lit
    plate_small: bytes      # Metadata/plate_1_small.png  128, lit
    plate_no_light: bytes   # Metadata/plate_no_light_1.png
    top: bytes              # Metadata/top_1.png          straight down
    pick: bytes             # Metadata/pick_1.png         flat id colour


def write_png(rgba: np.ndarray) -> bytes:
    """Encode HxWx4 uint8 as a PNG. Stdlib only, so it works in any container."""
    height, width = rgba.shape[:2]
    # PNG wants each row prefixed with a filter byte; 0 means "no filter".
    raw = np.hstack([
        np.zeros((height, 1), dtype=np.uint8),
        rgba.reshape(height, width * 4),
    ]).tobytes()

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b""))


def _proxy(mesh):
    """Cheap stand-in for rasterising, since detail below a pixel is wasted."""
    if len(mesh.faces) <= MAX_FACES:
        return np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces)
    try:
        import fast_simplification
    except ImportError:
        # Not fatal: a slow render beats no picture. Deliberately not a broad
        # except -- anything other than a missing optional dep should surface.
        return np.asarray(mesh.vertices, dtype=np.float64), np.asarray(mesh.faces)
    verts, faces = fast_simplification.simplify(
        np.asarray(mesh.vertices, dtype=np.float32),
        np.asarray(mesh.faces, dtype=np.int32),
        target_count=MAX_FACES,
    )
    return np.asarray(verts, dtype=np.float64), np.asarray(faces)


def _camera(verts: np.ndarray, eye: np.ndarray, up: np.ndarray):
    """An orthographic basis looking at the model, framed with a small margin.

    ``eye`` points from the model towards the camera; the camera looks back
    along it. The negation is here and nowhere else.
    """
    forward = -np.asarray(eye, dtype=np.float64)
    forward = forward / np.linalg.norm(forward)
    if abs(float(np.dot(forward, up))) > 0.999:      # looking straight down
        up = np.array([0.0, 1.0, 0.0])
    right = np.cross(forward, up)
    right /= np.linalg.norm(right)
    true_up = np.cross(right, forward)
    return np.vstack([right, true_up, forward])       # rows: x, y, depth


def _project(verts: np.ndarray, basis: np.ndarray, px: int):
    """Orthographic projection into pixel space, centred and scaled to fit."""
    cam = verts @ basis.T
    lo, hi = cam[:, :2].min(axis=0), cam[:, :2].max(axis=0)
    extent = float(max(hi - lo))
    if extent <= 0:
        extent = 1.0
    scale = (px * 0.82) / extent                      # 18% margin, as slicers do
    centre = (hi + lo) / 2.0
    xy = (cam[:, :2] - centre) * scale
    xy[:, 1] *= -1.0                                  # screen y grows downward
    xy += px / 2.0
    return xy, cam[:, 2]


def _rasterise(verts, faces, px: int, *, shade: bool, flat_rgb=None,
               direction=None, base_rgb=None) -> np.ndarray:
    """Z-buffered triangle fill. Returns HxWx4 uint8 over a transparent ground."""
    basis = _camera(verts, EYE_DIR if direction is None else np.asarray(direction,
                    dtype=np.float64), UP)
    xy, depth = _project(verts, basis, px)

    image = np.zeros((px, px, 4), dtype=np.float64)
    image[:] = BACKGROUND_RGBA
    zbuf = np.full((px, px), np.inf)

    tri_xy = xy[faces]                                # (n, 3, 2)
    tri_z = depth[faces]

    # Lambert term per face, from the face normal in camera space.
    if shade:
        v = verts[faces]
        normals = np.cross(v[:, 1] - v[:, 0], v[:, 2] - v[:, 0])
        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        lengths[lengths == 0] = 1.0
        normals = (normals / lengths) @ basis.T
        lambert = np.clip(-normals[:, 2], 0.0, 1.0)
        intensity = 0.30 + 0.70 * lambert             # ambient + diffuse
    else:
        intensity = np.ones(len(faces))

    base = np.array(flat_rgb or base_rgb or MODEL_RGB, dtype=np.float64)

    # Back-to-front is not enough with interpenetrating geometry, so keep a real
    # z-buffer. The loop is per-triangle; the pixel work inside is vectorised.
    for i in range(len(faces)):
        ax, ay = tri_xy[i, 0]
        bx, by = tri_xy[i, 1]
        cx, cy = tri_xy[i, 2]

        area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
        if abs(area) < 1e-9:
            continue

        x0 = max(int(np.floor(min(ax, bx, cx))), 0)
        x1 = min(int(np.ceil(max(ax, bx, cx))) + 1, px)
        y0 = max(int(np.floor(min(ay, by, cy))), 0)
        y1 = min(int(np.ceil(max(ay, by, cy))) + 1, px)
        if x0 >= x1 or y0 >= y1:
            continue

        ys, xs = np.mgrid[y0:y1, x0:x1]
        pxs = xs + 0.5
        pys = ys + 0.5

        w0 = ((bx - ax) * (pys - ay) - (pxs - ax) * (by - ay)) / area
        w1 = ((pxs - ax) * (cy - ay) - (cx - ax) * (pys - ay)) / area
        inside = (w0 >= 0) & (w1 >= 0) & (w0 + w1 <= 1)
        if not inside.any():
            continue

        z = (tri_z[i, 0] * (1 - w0 - w1) + tri_z[i, 2] * w0 + tri_z[i, 1] * w1)
        window = zbuf[y0:y1, x0:x1]
        nearer = inside & (z < window)
        if not nearer.any():
            continue

        window[nearer] = z[nearer]
        rgb = np.clip(base * intensity[i], 0.0, 1.0)
        target = image[y0:y1, x0:x1]
        target[nearer, 0:3] = rgb
        target[nearer, 3] = 1.0

    return (image * 255.0 + 0.5).astype(np.uint8)


def _downsample(rgba: np.ndarray, px: int) -> np.ndarray:
    """Box filter to the smaller size -- cheaper than rasterising twice."""
    factor = rgba.shape[0] // px
    if factor < 1:
        return rgba
    trimmed = rgba[: px * factor, : px * factor].astype(np.float64)
    blocks = trimmed.reshape(px, factor, px, factor, 4)
    return (blocks.mean(axis=(1, 3)) + 0.5).astype(np.uint8)


def thumbnails(mesh, colour=None) -> Thumbnails:
    """The five plate images Bambu Studio's container carries."""
    verts, faces = _proxy(mesh)
    rgb = parse_colour(colour)

    lit = _rasterise(verts, faces, PLATE_PX, shade=True, base_rgb=rgb)
    flat = _rasterise(verts, faces, PLATE_PX, shade=False, base_rgb=rgb)

    # top_1.png looks straight down; it is how the slicer shows plate coverage.
    # Passed as an argument rather than swapped into the module constant -- a
    # worker renders more than one job at a time, and shared mutable state is
    # how you get one model's thumbnail onto another model's listing.
    top = _rasterise(verts, faces, PLATE_PX, shade=True, direction=TOP_DOWN,
                     base_rgb=rgb)

    # pick_1.png is an object-id buffer, not a picture: flat colour per object,
    # read back to work out what the cursor is over. One object means one colour.
    pick = _rasterise(verts, faces, PLATE_PX, shade=False, flat_rgb=(1.0, 0.0, 0.0))

    return Thumbnails(
        plate=write_png(lit),
        plate_small=write_png(_downsample(lit, SMALL_PX)),
        plate_no_light=write_png(flat),
        top=write_png(top),
        pick=write_png(pick),
    )


def preview_png(mesh, colour=None) -> bytes:
    """Just the gallery image, for the upload and the how-to page."""
    verts, faces = _proxy(mesh)
    return write_png(_rasterise(verts, faces, PLATE_PX, shade=True,
                                base_rgb=parse_colour(colour)))
