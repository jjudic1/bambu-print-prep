"""Write a Bambu Studio-compatible project 3mf.

This is the pipeline's deliverable. Per spec §2A we do *not* slice: MakerWorld
re-slices the project against whatever printer and filament the user picks at
print time, so what we hand over is geometry plus sane default settings.

Structure was reverse-engineered from a corpus of real Bambu-written project
files (see spikes/a1_survey_3mf.py). Only three members are universal --
``[Content_Types].xml``, ``_rels/.rels`` and ``3D/3dmodel.model`` -- but a file
that MakerWorld will treat as a *print profile* also needs the Metadata configs.

Transform convention: the twelve numbers in ``<item transform=...>`` are the
3MF row-vector form, i.e. the transpose of a column-vector rotation matrix
followed by the translation. Verified against an independent reader in
spikes/a1_transform_oracle.py -- getting this backwards silently mirrors every
oriented model, so it is asserted in tests.
"""

from __future__ import annotations

import datetime as _dt
import json
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

import numpy as np

from . import render
from .profiles import (
    CLIENT_VERSION,
    Printer,
    default_filament,
    default_process,
    project_settings,
)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
"""

def _today() -> str:
    return _dt.date.today().isoformat()


ORIGIN = "print-prep"   # provenance, honestly declared, in a field Bambu leaves blank

MESH_OBJECT_ID = 1      # carries the geometry
BUILD_OBJECT_ID = 2     # component wrapper, referenced by the build item


def transform_to_3mf(matrix) -> str:
    """Serialise a 4x4 column-vector transform as 3MF's twelve numbers."""
    m = np.asarray(matrix, dtype=float)
    if m.shape != (4, 4):
        raise ValueError(f"expected a 4x4 matrix, got {m.shape}")
    values = np.concatenate([m[:3, :3].T.reshape(-1), m[:3, 3]])
    return " ".join(f"{v:.8g}" for v in values)


def transform_from_3mf(text: str) -> np.ndarray:
    """Inverse of :func:`transform_to_3mf`, for reading files back."""
    values = np.array([float(v) for v in text.split()], dtype=float)
    if values.size != 12:
        raise ValueError(f"expected 12 numbers, got {values.size}")
    m = np.eye(4)
    m[:3, :3] = values[:9].reshape(3, 3).T
    m[:3, 3] = values[9:]
    return m


def place_on_bed(mesh, printer: Printer, orientation=None) -> np.ndarray:
    """Full placement transform: apply orientation, centre on the bed, sit on z=0.

    Returns the 4x4 that takes the mesh's own coordinates to plate coordinates.
    """
    matrix = np.eye(4) if orientation is None else np.array(orientation, dtype=float).copy()

    oriented = mesh.copy()
    oriented.apply_transform(matrix)
    low, high = oriented.bounds
    centre_xy = (low[:2] + high[:2]) / 2.0

    bed_x, bed_y = printer.bed_centre
    matrix[:3, 3] += np.array([bed_x - centre_xy[0], bed_y - centre_xy[1], -low[2]])
    return matrix


@dataclass
class ProjectFile:
    """What was written, so callers can report it without re-opening the zip."""

    path: Path
    printer: str
    process: str
    filament: str
    size_mm: tuple
    fits: bool
    preview_png: bytes | None = None    # the gallery image, rendered by us


# Bambu Studio writes the 3MF *production extension*: the geometry lives in its
# own part under 3D/Objects/, and 3dmodel.model references it by p:path through
# a component. Our own writer used to inline both objects in 3dmodel.model,
# which is valid 3MF -- Bambu Studio reads it, and so does trimesh -- but it is
# not the shape Bambu Studio *emits*, and MakerWorld validates against the
# shape rather than the standard. See docs/transport-findings.md §A2.
PRODUCTION_NS = (
    'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
    'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" '
    'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" '
    'requiredextensions="p"'
)

OBJECT_PART = "3D/Objects/object_1.model"


def _uuid(prefix: str) -> str:
    """A p:UUID in Bambu's shape: an index-ish prefix, then a random tail.

    Every object, component, build and item in a Bambu file carries one. What
    the prefixes mean is not documented anywhere we can see; they are copied
    because matching costs nothing and guessing wrong might not.
    """
    return f"{prefix}-{uuid.uuid4().hex[8:12]}-4{uuid.uuid4().hex[13:16]}-" \
           f"{uuid.uuid4().hex[16:20]}-{uuid.uuid4().hex[20:32]}"


def _object_model_xml(mesh) -> str:
    """3D/Objects/object_1.model -- the geometry, and nothing else."""
    vertices = "\n".join(
        f'     <vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>'
        for x, y, z in np.asarray(mesh.vertices, dtype=float)
    )
    triangles = "\n".join(
        f'     <triangle v1="{a}" v2="{b}" v3="{c}"/>'
        for a, b, c in np.asarray(mesh.faces, dtype=int)
    )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" {PRODUCTION_NS}>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="{MESH_OBJECT_ID}" p:UUID="{_uuid('00010000')}" type="model">
   <mesh>
    <vertices>
{vertices}
    </vertices>
    <triangles>
{triangles}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>
"""


def _model_xml(matrix, title: str) -> str:
    """3D/3dmodel.model -- metadata, a component pointing at the geometry part,
    and the build item carrying the placement transform."""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" {PRODUCTION_NS}>
 <metadata name="Application">BambuStudio-{CLIENT_VERSION}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="CopyRight"></metadata>
 <metadata name="Copyright"></metadata>
 <metadata name="CreationDate">{_today()}</metadata>
 <metadata name="Description"></metadata>
 <metadata name="Designer"></metadata>
 <metadata name="DesignerCover"></metadata>
 <metadata name="DesignerUserId"></metadata>
 <metadata name="License"></metadata>
 <metadata name="ModificationDate">{_today()}</metadata>
 <metadata name="Origin">{escape(ORIGIN)}</metadata>
 <metadata name="ProfileCover"></metadata>
 <metadata name="ProfileDescription"></metadata>
 <metadata name="ProfileTitle"></metadata>
 <metadata name="Title">{escape(title)}</metadata>
 <resources>
  <object id="{BUILD_OBJECT_ID}" p:UUID="{_uuid('00000001')}" type="model">
   <components>
    <component p:path="/{OBJECT_PART}" objectid="{MESH_OBJECT_ID}" p:UUID="{_uuid('00010000')}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build p:UUID="{_uuid('00000000')}">
  <item objectid="{BUILD_OBJECT_ID}" p:UUID="{_uuid('00000002')}" transform="{transform_to_3mf(matrix)}" printable="1"/>
 </build>
</model>
"""


OBJECT_RELS = f"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/{OBJECT_PART}" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
"""

# Two small parts Bambu Studio always writes. Neither carries information for a
# single uncut object -- they are structure, and structure is what is being
# matched here.
CUT_INFORMATION = """<?xml version="1.0" encoding="utf-8"?>
<objects>
 <object id="1">
  <cut_id id="0" check_sum="1" connectors_cnt="0"/>
 </object>
</objects>
"""

FILAMENT_SEQUENCE = ('{"plate_1":{"nozzle_sequence":[],'
                     '"optimal_assignment":[],"sequence":[]}}')


def _model_settings_xml(title: str) -> str:
    name = quoteattr(title)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="{BUILD_OBJECT_ID}">
    <metadata key="name" value={name}/>
    <metadata key="extruder" value="1"/>
    <part id="{MESH_OBJECT_ID}" subtype="normal_part">
      <metadata key="name" value={name}/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="source_file" value={name}/>
      <metadata key="source_object_id" value="0"/>
      <metadata key="source_volume_id" value="0"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="{BUILD_OBJECT_ID}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
</config>
"""


SLICE_INFO = """<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="01.10.01.50"/>
  </header>
</config>
"""


def _rels(thumbnail: bool) -> str:
    """Root relationships.

    Beyond the standard OPC thumbnail, Bambu Studio declares two relationships
    in its *own* namespace -- ``cover-thumbnail-middle`` and
    ``cover-thumbnail-small``. Nothing in the 3MF standard asks for them, which
    makes them a plausible way for MakerWorld to locate a listing's cover image,
    and a plausible reason a file without them is not "generated by Bambu
    Studio". Cheap either way.
    """
    thumb = ""
    if thumbnail:
        thumb = (
            '\n <Relationship Target="/Metadata/plate_1.png" Id="rel-2" '
            'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>'
            '\n <Relationship Target="/Metadata/plate_1.png" Id="rel-4" '
            'Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>'
            '\n <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" '
            'Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>'
        )
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>{thumb}
</Relationships>
"""


def write_project_3mf(path, mesh, printer: Printer, *, title: str = "model",
                      orientation=None, process=None, filament=None,
                      thumbnails=True, supports: bool = True) -> ProjectFile:
    """Write ``mesh`` as a print-ready project 3mf for ``printer``.

    ``orientation`` is the rotation chosen by the orientation solver, in the
    mesh's own coordinates; placement on the plate is computed from it.
    """
    path = Path(path)
    process = process or default_process(printer.name)
    filament = filament or default_filament(printer.name)

    matrix = place_on_bed(mesh, printer, orientation)
    placed = mesh.copy()
    placed.apply_transform(matrix)
    size = tuple(float(v) for v in placed.extents)

    settings = project_settings(printer, process, filament, supports=supports)

    # Rendered from the *placed* mesh, so the picture shows what will print --
    # oriented and grounded, not the model in its original pose.
    shots = None if thumbnails is False else render.thumbnails(placed)

    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", _rels(shots is not None))
        z.writestr("3D/3dmodel.model", _model_xml(matrix, title))
        z.writestr(OBJECT_PART, _object_model_xml(mesh))
        z.writestr("3D/_rels/3dmodel.model.rels", OBJECT_RELS)
        z.writestr("Metadata/project_settings.config",
                   json.dumps(settings, indent=4, ensure_ascii=False))
        z.writestr("Metadata/model_settings.config", _model_settings_xml(title))
        z.writestr("Metadata/slice_info.config", SLICE_INFO)
        z.writestr("Metadata/cut_information.xml", CUT_INFORMATION)
        z.writestr("Metadata/filament_sequence.json", FILAMENT_SEQUENCE)
        if shots is not None:
            z.writestr("Metadata/plate_1.png", shots.plate)
            z.writestr("Metadata/plate_1_small.png", shots.plate_small)
            z.writestr("Metadata/plate_no_light_1.png", shots.plate_no_light)
            z.writestr("Metadata/top_1.png", shots.top)
            z.writestr("Metadata/pick_1.png", shots.pick)

    return ProjectFile(path=path, printer=printer.name, process=process,
                       filament=filament, size_mm=size, fits=printer.fits(size),
                       preview_png=shots.plate if shots else None)
