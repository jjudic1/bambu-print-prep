import * as THREE from 'three'
import { unzipSync } from 'fflate'

/**
 * Read a 3MF, including the ones Bambu Studio writes.
 *
 * three.js ships a 3MF loader and it is not enough. It handles a plain 3MF --
 * one object, geometry inline in `3D/3dmodel.model` -- and falls over on the
 * production extension, where the root file holds no geometry at all and points
 * at a separate part with `p:path`. Its objects map has no entry for the
 * referenced id, and it dies on `undefined.mesh`.
 *
 * That is not an edge case here. It is the shape *we* write, and the shape
 * every Bambu Studio project file has, so the app could not open its own output
 * or anything a user exported from the slicer -- while a generic 3MF worked
 * fine, which is a confusing way to fail.
 *
 * Since this project already writes the format, it can read it. The parsing is
 * dull; the transform is the part to be careful about, and it is the same trap
 * in reverse: **3MF transforms are row-vector**, so the twelve numbers are the
 * transpose of a column-vector matrix. Getting it backwards mirrors the model,
 * and no bounding box will tell you.
 */

const NS_MODEL = '3D/3dmodel.model'

/** The exact inverse of make3mf.js's transformTo3mf. */
function parseTransform(text) {
  if (!text) return new THREE.Matrix4()
  const v = text.trim().split(/\s+/).map(Number)
  if (v.length !== 12 || v.some((n) => !Number.isFinite(n))) {
    return new THREE.Matrix4()
  }
  // Row-major arguments to THREE.Matrix4.set, from the row-vector twelve.
  return new THREE.Matrix4().set(
    v[0], v[3], v[6], v[9],
    v[1], v[4], v[7], v[10],
    v[2], v[5], v[8], v[11],
    0, 0, 0, 1,
  )
}

function parsePart(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('That file is damaged and cannot be read.')
  }

  const objects = new Map()
  for (const node of doc.getElementsByTagName('object')) {
    const id = node.getAttribute('id')
    if (!id) continue

    const mesh = node.getElementsByTagName('mesh')[0]
    if (mesh) {
      const positions = []
      for (const vertex of mesh.getElementsByTagName('vertex')) {
        positions.push(
          Number(vertex.getAttribute('x')),
          Number(vertex.getAttribute('y')),
          Number(vertex.getAttribute('z')),
        )
      }
      const indices = []
      for (const tri of mesh.getElementsByTagName('triangle')) {
        indices.push(
          Number(tri.getAttribute('v1')),
          Number(tri.getAttribute('v2')),
          Number(tri.getAttribute('v3')),
        )
      }
      objects.set(id, { positions, indices })
      continue
    }

    // A components object: no geometry of its own, only references -- possibly
    // into another part of the zip, which is the case the three.js loader
    // cannot follow.
    const components = []
    for (const c of node.getElementsByTagName('component')) {
      components.push({
        path: c.getAttribute('p:path') || c.getAttribute('path') || null,
        objectid: c.getAttribute('objectid'),
        matrix: parseTransform(c.getAttribute('transform')),
      })
    }
    if (components.length) objects.set(id, { components })
  }

  const build = []
  for (const item of doc.getElementsByTagName('item')) {
    build.push({
      objectid: item.getAttribute('objectid'),
      matrix: parseTransform(item.getAttribute('transform')),
    })
  }

  return { objects, build }
}

export function read3mf(buffer) {
  const files = unzipSync(new Uint8Array(buffer))
  const decode = (name) => new TextDecoder().decode(files[name])

  const rootName = Object.keys(files).includes(NS_MODEL)
    ? NS_MODEL
    : Object.keys(files).find((n) => n.endsWith('.model'))
  if (!rootName) throw new Error('There is no model inside that file.')

  const parts = new Map([[rootName, parsePart(decode(rootName))]])
  const partFor = (path) => {
    const name = (path || rootName).replace(/^\//, '')
    if (!parts.has(name)) {
      if (!files[name]) throw new Error('That file refers to a piece it does not contain.')
      parts.set(name, parsePart(decode(name)))
    }
    return parts.get(name)
  }

  const positions = []
  const indices = []

  // Resolve an object into flat geometry, following components across parts.
  // `seen` guards against a file that references itself -- untrusted input, and
  // the alternative is a hung tab.
  function collect(partName, objectid, matrix, seen = new Set()) {
    const key = `${partName}#${objectid}`
    if (seen.has(key)) return
    seen.add(key)

    const part = partFor(partName)
    const object = part.objects.get(objectid)
    if (!object) return

    if (object.components) {
      for (const c of object.components) {
        collect(c.path || partName, c.objectid,
                matrix.clone().multiply(c.matrix), seen)
      }
      return
    }

    const base = positions.length / 3
    const v = new THREE.Vector3()
    for (let i = 0; i < object.positions.length; i += 3) {
      v.set(object.positions[i], object.positions[i + 1], object.positions[i + 2])
      v.applyMatrix4(matrix)
      positions.push(v.x, v.y, v.z)
    }
    for (const index of object.indices) indices.push(base + index)
  }

  const root = parts.get(rootName)
  for (const item of root.build) {
    collect(rootName, item.objectid, item.matrix)
  }

  // A file with no build section is unusual but not wrong; take every object
  // that carries geometry rather than showing the user an empty plate.
  if (!positions.length) {
    for (const [id, object] of root.objects) {
      if (object.positions) collect(rootName, id, new THREE.Matrix4())
    }
  }

  if (!positions.length) throw new Error('That file has no shape in it we can read.')

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position',
    new THREE.Float32BufferAttribute(positions, 3))
  if (indices.length) geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
