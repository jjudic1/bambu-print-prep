"""Work out whether a mesh can be printed, and what will go wrong if it is.

Spec §5.2. Produces a MeshReport: the raw facts. Nothing here decides anything
or talks to the user -- §5.3 acts on it, and the UI translates it. Keeping the
judgement out of this module is what lets the same report drive both a repair
step and a warning caption.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict

import numpy as np
import trimesh

# A surface is an overhang once it leans more than this far from vertical.
# 45 deg is the near-universal slicer default for "needs support".
OVERHANG_DEGREES = 45.0

# A face counts towards the base if it is flat-down and within this of the lowest point.
BASE_TOLERANCE_MM = 0.4

# How many surface points to sample for wall thickness. Enough to find thin ears
# on a figurine, few enough to stay well under a second.
THICKNESS_SAMPLES = 3000


@dataclass
class MeshReport:
    watertight: bool
    manifold: bool
    hole_count: int
    non_manifold_edges: int             # edges shared by 3+ faces
    shell_count: int
    self_intersecting: bool | None      # None when we did not test
    inverted_normals: bool
    bbox_mm: tuple
    volume_mm3: float
    surface_area_mm2: float
    unit_guess: str
    min_wall_mm: float | None
    thin_fraction: float                # share of sampled points below the nozzle
    flat_base_area_mm2: float
    overhang_ratio: float
    triangle_count: int
    degenerate_faces: int
    duplicate_vertices: int

    @property
    def printable(self) -> bool:
        """Sliceable at all. Says nothing about whether it will print *well*."""
        return self.watertight and self.manifold and not self.inverted_normals

    def to_dict(self) -> dict:
        return asdict(self)


def _open_edges(mesh) -> np.ndarray:
    """Edges belonging to exactly one face -- the boundary of every hole."""
    return mesh.edges_sorted[trimesh.grouping.group_rows(mesh.edges_sorted, require_count=1)]


def count_holes(mesh) -> int:
    """Number of boundary loops, not number of open edges.

    A single square hole has four open edges but is one hole; reporting four
    would badly misdescribe the model.
    """
    if mesh.is_watertight:
        return 0
    edges = _open_edges(mesh)
    if len(edges) == 0:
        return 0

    import networkx as nx

    graph = nx.Graph()
    graph.add_edges_from(edges)
    return nx.number_connected_components(graph)


def count_non_manifold_edges(mesh) -> int:
    """Edges shared by three or more faces.

    Without this a mesh can report "not watertight, no holes", which is true and
    useless -- these edges are the other way a mesh fails to be a solid.
    """
    groups = trimesh.grouping.group_rows(mesh.edges_sorted, require_count=None)
    return int(sum(1 for g in groups if len(g) > 2))


def is_manifold(mesh) -> bool:
    """Every edge shared by exactly two faces, and windings agree.

    trimesh's ``is_watertight`` already implies the edge condition, but a mesh
    can be watertight with inconsistent winding, which slices into nonsense.
    """
    return bool(mesh.is_watertight and mesh.is_winding_consistent)


def count_degenerate(mesh) -> int:
    """Zero-area faces. They survive most operations and break some of them."""
    return int((~mesh.nondegenerate_faces()).sum())


def count_duplicate_vertices(mesh) -> int:
    unique = len(np.unique(mesh.vertices, axis=0))
    return int(len(mesh.vertices) - unique)


def overhang_ratio(mesh, degrees: float = OVERHANG_DEGREES) -> float:
    """Fraction of surface area that would need support in the current pose."""
    if mesh.area <= 0:
        return 0.0
    # Downward-facing normals, steeper than the threshold measured from vertical.
    limit = -math.cos(math.radians(90.0 - degrees))
    steep = mesh.face_normals[:, 2] < limit
    return float(mesh.area_faces[steep].sum() / mesh.area)


def flat_base_area(mesh, tolerance: float = BASE_TOLERANCE_MM) -> float:
    """Area actually touching the plate -- the single best predictor of adhesion."""
    z_min = mesh.bounds[0][2]
    face_z = mesh.vertices[mesh.faces][:, :, 2]
    on_plate = (np.abs(face_z - z_min) < tolerance).all(axis=1)
    downward = mesh.face_normals[:, 2] < -0.99
    return float(mesh.area_faces[on_plate & downward].sum())


def sample_wall_thickness(mesh, samples: int = THICKNESS_SAMPLES, seed: int = 0):
    """Estimate wall thickness by shooting rays inward from the surface.

    Returns (thicknesses, points). For each sampled surface point we fire along
    the inward normal and take the distance to the next surface. That is the
    local wall thickness -- the thing that decides whether an ear snaps off.
    """
    if len(mesh.faces) == 0:
        return np.array([]), np.zeros((0, 3))

    # Plain surface sampling, not sample_surface_even: even sampling rejects
    # points to enforce spacing, returns fewer than asked for, and prints about
    # it. We want coverage, not spacing, and we want a quiet library.
    points, face_ids = trimesh.sample.sample_surface(mesh, samples, seed=seed)
    if len(points) == 0:
        return np.array([]), np.zeros((0, 3))

    normals = mesh.face_normals[face_ids]
    # Step inside first, so the ray does not immediately hit its own origin face.
    epsilon = max(mesh.scale * 1e-5, 1e-6)
    origins = points - normals * epsilon

    locations, index_ray, _ = mesh.ray.intersects_location(
        ray_origins=origins, ray_directions=-normals, multiple_hits=False)

    if len(index_ray) == 0:
        return np.array([]), points

    distances = np.linalg.norm(locations - origins[index_ray], axis=1)
    return distances, points[index_ray]


def analyze(mesh, *, unit_guess: str = "mm", check_self_intersection: bool = False,
            nozzle_mm: float = 0.4, thickness_samples: int = THICKNESS_SAMPLES) -> MeshReport:
    """Build the full report. ``mesh`` is expected to already be in millimetres."""
    thicknesses, _ = sample_wall_thickness(mesh, thickness_samples)

    if len(thicknesses):
        # The 1st percentile, not the minimum: a single grazing ray on a sharp
        # edge reads near zero and would condemn every model.
        min_wall = float(np.percentile(thicknesses, 1))
        thin_fraction = float((thicknesses < nozzle_mm * 2).mean())
    else:
        min_wall, thin_fraction = None, 0.0

    return MeshReport(
        watertight=bool(mesh.is_watertight),
        manifold=is_manifold(mesh),
        hole_count=count_holes(mesh),
        non_manifold_edges=count_non_manifold_edges(mesh),
        shell_count=int(mesh.body_count),
        self_intersecting=_self_intersecting(mesh) if check_self_intersection else None,
        inverted_normals=bool(mesh.is_watertight and mesh.volume < 0),
        bbox_mm=tuple(float(v) for v in mesh.extents),
        volume_mm3=float(abs(mesh.volume)),
        surface_area_mm2=float(mesh.area),
        unit_guess=unit_guess,
        min_wall_mm=min_wall,
        thin_fraction=thin_fraction,
        flat_base_area_mm2=flat_base_area(mesh),
        overhang_ratio=overhang_ratio(mesh),
        triangle_count=int(len(mesh.faces)),
        degenerate_faces=count_degenerate(mesh),
        duplicate_vertices=count_duplicate_vertices(mesh),
    )


def _self_intersecting(mesh) -> bool | None:
    """Expensive and rarely decisive, so it is opt-in.

    manifold3d normalises self-intersections away as a side effect of its
    boolean engine; if a round trip changes the volume materially, the input
    was self-intersecting.
    """
    try:
        from manifold3d import Manifold, Mesh as ManifoldMesh
    except ImportError:
        return None

    try:
        m = Manifold(ManifoldMesh(
            vert_properties=np.asarray(mesh.vertices, dtype=np.float32),
            tri_verts=np.asarray(mesh.faces, dtype=np.uint32)))
        if m.is_empty():
            return None
        return not math.isclose(m.volume(), abs(mesh.volume), rel_tol=1e-3)
    except Exception:
        return None
