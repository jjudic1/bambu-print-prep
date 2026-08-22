"""Make a mesh sliceable, cheaply first and brutally only if we must.

Spec §5.3 gives six ordered steps, each conditional on the report. The order
matters: merging vertices first often makes the later steps unnecessary, and
voxel remeshing is last because it always "works" while destroying detail.

§10 is explicit that we should not compete on repair -- the generation platforms
are closing that gap themselves. So this aims at "good enough to slice, honest
when it isn't", not at being a mesh-repair product.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import trimesh

from .analyze import MeshReport, analyze

# A disconnected piece smaller than this share of the largest one is debris,
# not a deliberate part. AI generators leave these behind constantly.
DEBRIS_VOLUME_RATIO = 0.01

# Voxel remesh resolution, as a divisor of the model's longest side. Higher is
# finer and slower; 256 keeps a figurine's face recognisable.
REMESH_RESOLUTION = 256

# A remesh at that resolution can emit millions of triangles. Nothing downstream
# benefits, and the 3mf gets unusably large, so cap it.
MAX_REMESH_FACES = 200_000


@dataclass
class RepairLog:
    """What we did, in order, so the UI can explain itself (§6 copy rules)."""

    steps: list = field(default_factory=list)
    before: MeshReport | None = None
    after: MeshReport | None = None
    succeeded: bool = False
    failure_reason: str | None = None      # plain language, names the recovery

    def record(self, step: str, detail: str = ""):
        self.steps.append(f"{step}: {detail}" if detail else step)

    @property
    def changed(self) -> bool:
        return bool(self.steps)


def merge_and_clean(mesh) -> tuple[trimesh.Trimesh, str | None]:
    """Step 1: merge duplicate vertices, drop degenerate and duplicate faces."""
    before_v, before_f = len(mesh.vertices), len(mesh.faces)

    mesh = mesh.copy()
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()

    dv, df = before_v - len(mesh.vertices), before_f - len(mesh.faces)
    if dv or df:
        return mesh, f"removed {dv} duplicate vertices, {df} bad faces"
    return mesh, None


def drop_debris(mesh, ratio: float = DEBRIS_VOLUME_RATIO) -> tuple[trimesh.Trimesh, str | None]:
    """Step 2: remove floating fragments, but keep deliberate multi-part models.

    The test is relative volume, not absolute: a 2 mm pin on a 10 mm model is
    intentional, the same pin beside a 200 mm dragon is debris.
    """
    parts = mesh.split(only_watertight=False)
    if len(parts) <= 1:
        return mesh, None

    volumes = np.array([abs(p.volume) if p.volume else p.convex_hull.volume for p in parts])
    keep = volumes >= volumes.max() * ratio
    if keep.all():
        return mesh, None

    kept = [p for p, k in zip(parts, keep) if k]
    merged = trimesh.util.concatenate(kept)
    return merged, f"removed {int((~keep).sum())} stray fragment(s)"


def fix_normals(mesh) -> tuple[trimesh.Trimesh, str | None]:
    """Step 3: make winding consistent and normals point outward."""
    if mesh.is_winding_consistent and (not mesh.is_watertight or mesh.volume > 0):
        return mesh, None
    mesh = mesh.copy()
    mesh.fix_normals()
    return mesh, "corrected inside-out surfaces"


def fill_holes(mesh) -> tuple[trimesh.Trimesh, str | None]:
    """Step 4: close the model so it encloses a volume."""
    if mesh.is_watertight:
        return mesh, None

    mesh = mesh.copy()
    if mesh.fill_holes() and mesh.is_watertight:
        return mesh, "closed gaps in the surface"

    # trimesh only bridges simple loops. pymeshfix handles the rest.
    try:
        import pymeshfix
    except ImportError:
        return mesh, None

    fixer = pymeshfix.MeshFix(np.asarray(mesh.vertices, dtype=float),
                              np.asarray(mesh.faces, dtype=np.int32))
    # Keep every component: dropping them is drop_debris's job, and it decides
    # on relative volume rather than discarding whatever is not the largest.
    fixer.repair(remove_smallest_components=False)
    repaired = trimesh.Trimesh(fixer.points, fixer.faces, process=False)
    if repaired.is_watertight and len(repaired.faces):
        return repaired, "rebuilt the surface to close it"
    return mesh, None


def voxel_remesh(mesh, resolution: int = REMESH_RESOLUTION) -> tuple[trimesh.Trimesh, str | None]:
    """Step 5: the fallback that almost always yields something sliceable.

    Slow and detail-destroying, so it only runs when targeted repair has failed.
    """
    pitch = float(max(mesh.extents)) / max(resolution, 1)
    if pitch <= 0:
        return mesh, None

    voxels = mesh.voxelized(pitch=pitch).fill()
    remeshed = voxels.marching_cubes           # needs scikit-image
    remeshed.merge_vertices()
    remeshed.fix_normals()

    if not (remeshed.is_watertight and len(remeshed.faces)):
        return mesh, None

    # The fill floods inward from outside the grid, so an open model lets it
    # leak and the "repair" comes back as a solid blob many times the original.
    # A watertight result is not the same as a correct one -- check the volume.
    hull_volume = mesh.convex_hull.volume
    if hull_volume > 0 and abs(remeshed.volume) > hull_volume * 1.05:
        return mesh, None

    if len(remeshed.faces) > MAX_REMESH_FACES:
        remeshed = remeshed.simplify_quadric_decimation(face_count=MAX_REMESH_FACES)

    return remeshed, "rebuilt the model from scratch to make it printable"


def repair(mesh, *, report: MeshReport | None = None, allow_remesh: bool = True,
           nozzle_mm: float = 0.4) -> tuple[trimesh.Trimesh, RepairLog]:
    """Run the ladder, stopping as soon as the mesh is sliceable.

    Returns the mesh and a log. A failed repair is not an exception: §5.3 wants
    a plain-language failure the UI can show, and the user may still choose to
    print it as-is (§6.3).
    """
    log = RepairLog(before=report or analyze(mesh, nozzle_mm=nozzle_mm))
    working = mesh

    ladder = [merge_and_clean, drop_debris, fix_normals, fill_holes]
    for step in ladder:
        working, detail = _run(step, working, log)
        if detail:
            log.record(step.__name__, detail)

    if not working.is_watertight and allow_remesh:
        working, detail = _run(voxel_remesh, working, log)
        if detail:
            log.record("voxel_remesh", detail)

    log.after = analyze(working, unit_guess=log.before.unit_guess, nozzle_mm=nozzle_mm)
    log.succeeded = log.after.printable

    if not log.succeeded:
        log.failure_reason = _explain(log.after)

    return working, log


def _run(step, mesh, log: RepairLog):
    """Run one ladder step, surviving its failure but never hiding it.

    A step that raises must not kill the job -- a later step may still succeed,
    and the user can print the model as-is (§6.3). But a silently swallowed
    exception once made this whole ladder a no-op, so failures are logged.
    """
    try:
        return step(mesh)
    except Exception as exc:                      # noqa: BLE001 - deliberate
        log.record(f"{step.__name__} failed", f"{type(exc).__name__}: {exc}")
        return mesh, None


def _explain(report: MeshReport) -> str:
    """Name the recovery, not the cause (spec §6 copy rules)."""
    if report.hole_count:
        return ("This model has gaps in its surface that I couldn't close. "
                "Try re-exporting it, or generating it again.")
    if report.non_manifold_edges:
        return ("Parts of this model overlap in a way a printer can't resolve. "
                "Try generating it again, or send me a different version.")
    if not report.watertight:
        return ("This model isn't a solid shape, so it can't be printed. "
                "Try re-exporting it from wherever it came from.")
    return ("Something about this model's surface can't be printed. "
            "Try a different version of it.")
