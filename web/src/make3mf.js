/**
 * Write the container MakerWorld accepts, in the browser.
 *
 * A port of prep/write3mf.py, and the point of it is economic rather than
 * technical: if this works, the expensive part of the product needs no server.
 * No Cloud Run bill, no cold start, no queue, no job storage, no rate limit --
 * and "popularity" stops being the thing that breaks it.
 *
 * It is portable because of what the container actually is. Six members are
 * static strings, four are small templates, five are pictures, and one is a
 * settings blob that resolves to the same answer every time for a given
 * printer and material -- so it is baked at build time by
 * spikes/export_web_profiles.py (38 KB gzipped for fourteen printers and four
 * materials). Nothing here needs trimesh, scipy or numpy; write3mf.py never
 * did either.
 *
 * What does NOT come along: repair, analysis and the orientation solver. Those
 * need real mesh libraries and are the judgement half of the product. This is
 * the transport half, and the transport half is the bit nobody else has.
 *
 * Everything below that looks arbitrary was bought with a real upload. See
 * docs/transport-findings.md §A2b before changing any of it.
 */

import { zipSync, zlibSync } from 'fflate'

const enc = new TextEncoder()
const bytes = (s) => enc.encode(s)

export const MESH_OBJECT_ID = 1
export const BUILD_OBJECT_ID = 2
export const OBJECT_PART = '3D/Objects/object_1.model'

// The version we present ourselves as. Bambu Studio ignores the settings in any
// file that does not claim to be its own, and 99 of 380 real files in the local
// corpus carry exactly this string.
export const CLIENT_VERSION = '01.10.01.50'
export const ORIGIN = 'print-prep'

const PRODUCTION_NS =
  'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ' +
  'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" ' +
  'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" ' +
  'requiredextensions="p"'

// --- the six members that never change --------------------------------------

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>
`

const OBJECT_RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/${OBJECT_PART}" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

const SLICE_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="01.10.01.50"/>
  </header>
</config>
`

const CUT_INFORMATION = `<?xml version="1.0" encoding="utf-8"?>
<objects>
 <object id="1">
  <cut_id id="0" check_sum="1" connectors_cnt="0"/>
 </object>
</objects>
`

const FILAMENT_SEQUENCE =
  '{"plate_1":{"nozzle_sequence":[],"optimal_assignment":[],"sequence":[]}}'

// Two of these are in Bambu's own namespace rather than the 3MF standard, and
// are the best guess at how MakerWorld finds a listing's cover image.
function rootRels(withThumbnails) {
  const thumbs = withThumbnails
    ? '\n <Relationship Target="/Metadata/plate_1.png" Id="rel-2" ' +
      'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>' +
      '\n <Relationship Target="/Metadata/plate_1.png" Id="rel-4" ' +
      'Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>' +
      '\n <Relationship Target="/Metadata/plate_1_small.png" Id="rel-5" ' +
      'Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>'
    : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>${thumbs}
</Relationships>
`
}

// --- small helpers that have to agree with Python exactly -------------------

const escapeXml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Python's xml.sax.saxutils.quoteattr: quote, and escape what would break out.
function quoteAttr(s) {
  const e = escapeXml(s).replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')
  return e.includes('"') ? `'${e.replace(/'/g, '&apos;')}'` : `"${e}"`
}

/**
 * Python's "%.8g", which JavaScript has no direct equivalent of.
 *
 * Eight significant digits, trailing zeros dropped, and no exponent for the
 * magnitudes a build plate produces. This matters more than it looks: these
 * twelve numbers are the build transform, and getting them wrong prints
 * mirrored with nothing downstream to catch it.
 */
function g8(v) {
  if (!Number.isFinite(v)) return '0'
  if (v === 0) return '0'
  const s = Number(v.toPrecision(8))
  return String(s)
}

/** A p:UUID in Bambu's shape: an index-ish prefix, then a random tail. */
function uuid(prefix) {
  const hex = () =>
    (crypto.getRandomValues(new Uint8Array(1))[0] + 0x100)
      .toString(16)
      .slice(1)
  const run = (n) => Array.from({ length: n }, hex).join('')
  return `${prefix}-${run(2)}-4${run(2).slice(1)}-${run(2)}-${run(6)}`
}

// Local date, not UTC. toISOString() would give the UTC day, which after
// early evening in western timezones is tomorrow -- so two files written a
// minute apart on the same machine could claim different creation dates, and
// the server's Python (which uses the local day) would disagree with the
// browser's.
function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// --- geometry ---------------------------------------------------------------

/**
 * The 3MF build transform, which is **row-vector**: emit the transpose of a
 * column-vector rotation followed by the translation. Bounding boxes cannot
 * tell the two apart, so getting it backwards silently mirrors every oriented
 * model. Verified against an independent reader in spikes/a1_transform_oracle.py.
 *
 * `m` is a column-vector 4x4 in row-major order (m[row][col]).
 */
export function transformTo3mf(m) {
  const v = [
    m[0][0], m[1][0], m[2][0],
    m[0][1], m[1][1], m[2][1],
    m[0][2], m[1][2], m[2][2],
    m[0][3], m[1][3], m[2][3],
  ]
  return v.map(g8).join(' ')
}

/** Centre on the bed and sit the model on z = 0. */
export function placeOnBed(bounds, printer) {
  const [lo, hi] = bounds
  const cx = (lo[0] + hi[0]) / 2
  const cy = (lo[1] + hi[1]) / 2
  const m = [
    [1, 0, 0, printer.bed_mm[0] / 2 - cx],
    [0, 1, 0, printer.bed_mm[1] / 2 - cy],
    [0, 0, 1, -lo[2]],
    [0, 0, 0, 1],
  ]
  return m
}

function objectModelXml(vertices, triangles) {
  const v = []
  for (let i = 0; i < vertices.length; i += 3) {
    v.push(`     <vertex x="${vertices[i].toFixed(6)}" ` +
           `y="${vertices[i + 1].toFixed(6)}" ` +
           `z="${vertices[i + 2].toFixed(6)}"/>`)
  }
  const t = []
  for (let i = 0; i < triangles.length; i += 3) {
    t.push(`     <triangle v1="${triangles[i]}" v2="${triangles[i + 1]}" ` +
           `v3="${triangles[i + 2]}"/>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${PRODUCTION_NS}>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
  <object id="${MESH_OBJECT_ID}" p:UUID="${uuid('00010000')}" type="model">
   <mesh>
    <vertices>
${v.join('\n')}
    </vertices>
    <triangles>
${t.join('\n')}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>
`
}

function rootModelXml(matrix, title) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${PRODUCTION_NS}>
 <metadata name="Application">BambuStudio-${CLIENT_VERSION}</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="CopyRight"></metadata>
 <metadata name="Copyright"></metadata>
 <metadata name="CreationDate">${today()}</metadata>
 <metadata name="Description"></metadata>
 <metadata name="Designer"></metadata>
 <metadata name="DesignerCover"></metadata>
 <metadata name="DesignerUserId"></metadata>
 <metadata name="License"></metadata>
 <metadata name="ModificationDate">${today()}</metadata>
 <metadata name="Origin">${escapeXml(ORIGIN)}</metadata>
 <metadata name="ProfileCover"></metadata>
 <metadata name="ProfileDescription"></metadata>
 <metadata name="ProfileTitle"></metadata>
 <metadata name="Title">${escapeXml(title)}</metadata>
 <resources>
  <object id="${BUILD_OBJECT_ID}" p:UUID="${uuid('00000001')}" type="model">
   <components>
    <component p:path="/${OBJECT_PART}" objectid="${MESH_OBJECT_ID}" p:UUID="${uuid('00010000')}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build p:UUID="${uuid('00000000')}">
  <item objectid="${BUILD_OBJECT_ID}" p:UUID="${uuid('00000002')}" transform="${transformTo3mf(matrix)}" printable="1"/>
 </build>
</model>
`
}

function modelSettingsXml(title) {
  const name = quoteAttr(title)
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${BUILD_OBJECT_ID}">
    <metadata key="name" value=${name}/>
    <metadata key="extruder" value="1"/>
    <part id="${MESH_OBJECT_ID}" subtype="normal_part">
      <metadata key="name" value=${name}/>
      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>
      <metadata key="source_file" value=${name}/>
      <metadata key="source_object_id" value="0"/>
      <metadata key="source_volume_id" value="0"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <model_instance>
      <metadata key="object_id" value="${BUILD_OBJECT_ID}"/>
      <metadata key="instance_id" value="0"/>
    </model_instance>
  </plate>
</config>
`
}

// --- PNG, without a canvas --------------------------------------------------

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Encode HxWx4 RGBA as PNG. Mirrors prep/render.write_png. */
export function writePng(rgba, width, height) {
  const raw = new Uint8Array(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0                       // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4),
            y * (width * 4 + 1) + 1)
  }

  const chunk = (tag, data) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    out.set(bytes(tag), 4)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    return out
  }

  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width)
  dv.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const png = new Uint8Array(total)
  let at = 0
  for (const p of parts) { png.set(p, at); at += p.length }
  return png
}

// --- the container -----------------------------------------------------------

/**
 * @param {object} o
 * @param {Float32Array|number[]} o.vertices  flat xyz, already placed on the bed
 * @param {Uint32Array|number[]} o.triangles  flat indices
 * @param {object} o.printer                  an entry from printers.json
 * @param {string} o.material                 key into printer.materials
 * @param {number[][]} o.matrix               4x4 column-vector build transform
 * @param {string} o.title
 * @param {object} [o.thumbnails]             {plate, plateSmall, plateNoLight, top, pick}
 * @returns {Uint8Array} the .3mf
 */
export function makeProject3mf({
  vertices, triangles, printer, material = 'PLA', matrix, title = 'model',
  thumbnails = null,
}) {
  const chosen = printer.materials[material] || Object.values(printer.materials)[0]
  if (!chosen) throw new Error(`no material profile for ${printer.model}`)

  // indent=4 to match Python's json.dumps, because the two outputs are diffed.
  const settings = JSON.stringify(chosen.settings, null, 4)

  const files = {
    '[Content_Types].xml': bytes(CONTENT_TYPES),
    '_rels/.rels': bytes(rootRels(Boolean(thumbnails))),
    '3D/3dmodel.model': bytes(rootModelXml(matrix, title)),
    [OBJECT_PART]: bytes(objectModelXml(vertices, triangles)),
    '3D/_rels/3dmodel.model.rels': bytes(OBJECT_RELS),
    'Metadata/project_settings.config': bytes(settings),
    'Metadata/model_settings.config': bytes(modelSettingsXml(title)),
    'Metadata/slice_info.config': bytes(SLICE_INFO),
    'Metadata/cut_information.xml': bytes(CUT_INFORMATION),
    'Metadata/filament_sequence.json': bytes(FILAMENT_SEQUENCE),
  }

  if (thumbnails) {
    files['Metadata/plate_1.png'] = thumbnails.plate
    files['Metadata/plate_1_small.png'] = thumbnails.plateSmall
    files['Metadata/plate_no_light_1.png'] = thumbnails.plateNoLight
    files['Metadata/top_1.png'] = thumbnails.top
    files['Metadata/pick_1.png'] = thumbnails.pick
  }

  return zipSync(files, { level: 6 })
}
