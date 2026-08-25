/**
 * Read a model, and photograph it, without a server.
 *
 * The two things the no-server path needs that the hosted one got from Python:
 * parsing whatever the user drops in, and producing the five plate pictures the
 * container carries. Both are things a browser is actually good at -- three.js
 * already ships the loaders, and a canvas is a better renderer than the numpy
 * rasteriser in prep/render.py ever was.
 */

import * as THREE from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

import { writePng } from '../make3mf.js'
import { read3mf } from './read3mf.js'

/** Pull every mesh out of a loaded scene into one geometry. */
function flatten(object) {
  const parts = []
  object.updateMatrixWorld(true)
  object.traverse((child) => {
    if (!child.isMesh) return
    const g = child.geometry.clone()
    g.applyMatrix4(child.matrixWorld)
    // Loaders vary in what they attach; keep only what a 3MF carries so the
    // geometries can be merged without arguing about attributes.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position') g.deleteAttribute(name)
    }
    parts.push(g)
  })
  if (!parts.length) throw new Error('That file has no shape in it we can read.')
  if (parts.length === 1) return parts[0]

  const merged = new THREE.BufferGeometry()
  const total = parts.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const positions = new Float32Array(total * 3)
  let at = 0
  for (const g of parts) {
    positions.set(g.getAttribute('position').array, at)
    at += g.getAttribute('position').array.length
  }
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return merged
}

/**
 * Parse a dropped file into geometry, in the browser.
 *
 * STL arrives non-indexed -- every triangle carrying its own three vertices --
 * which would triple the vertex count in the written file for no benefit, so
 * matching positions are merged first.
 */
export async function readModel(file) {
  const name = (file.name || '').toLowerCase()
  const buffer = await file.arrayBuffer()

  let geometry
  if (name.endsWith('.stl')) {
    geometry = new STLLoader().parse(buffer)
  } else if (name.endsWith('.3mf')) {
    // Our own reader, not three.js's -- theirs cannot follow the p:path
    // components that Bambu Studio (and this app) write. See read3mf.js.
    geometry = read3mf(buffer)
  } else if (name.endsWith('.obj')) {
    geometry = flatten(new OBJLoader().parse(new TextDecoder().decode(buffer)))
  } else if (name.endsWith('.ply')) {
    geometry = new PLYLoader().parse(buffer)
  } else {
    throw new Error("We can read STL, 3MF, OBJ and PLY files. That one isn't one of those.")
  }

  for (const attribute of Object.keys(geometry.attributes)) {
    if (attribute !== 'position') geometry.deleteAttribute(attribute)
  }
  const indexed = geometry.index ? geometry : mergeVertices(geometry, 1e-5)
  indexed.computeVertexNormals()

  // A file that parses but describes nothing is a real outcome -- an empty
  // build section, a 3MF of only metadata -- and it should say so rather than
  // handing an empty plate to the viewer.
  if (!indexed.getAttribute('position')?.count) {
    throw new Error('That file has no shape in it we can read.')
  }
  return indexed
}

/** Flat vertex and triangle arrays, in the shape make3mf wants. */
export function toArrays(geometry) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  return {
    vertices: Array.from(position.array, (v) => Number(v)),
    triangles: index
      ? Array.from(index.array, (v) => Number(v))
      : Array.from({ length: position.count }, (_, i) => i),
  }
}

/**
 * The five plate images, rendered offscreen.
 *
 * Offscreen rather than by copying the visible canvas, because a WebGL canvas
 * with preserveDrawingBuffer off reads back empty outside a frame -- and it
 * would also be at whatever size the window happens to be. A render target is
 * exact, works while the tab is hidden, and gives the sizes Bambu writes.
 */
export function plateImages(scene, camera, { colour = 0x22a45d } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setClearColor(0x000000, 0)

  const shoot = (px) => {
    const target = new THREE.WebGLRenderTarget(px, px, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    })
    renderer.setSize(px, px, false)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)

    const buffer = new Uint8Array(px * px * 4)
    renderer.readRenderTargetPixels(target, 0, 0, px, px, buffer)
    target.dispose()

    // WebGL reads bottom-up; PNG rows run top-down.
    const flipped = new Uint8Array(buffer.length)
    const row = px * 4
    for (let y = 0; y < px; y++) {
      flipped.set(buffer.subarray((px - 1 - y) * row, (px - y) * row), y * row)
    }
    return writePng(flipped, px, px)
  }

  const plate = shoot(512)
  const plateSmall = shoot(128)
  const images = {
    plate,
    plateSmall,
    // Bambu writes distinct unlit and top views. Nothing appears to read them,
    // and a container missing members is a difference nobody has tested -- so
    // they are present and honest about being the same picture.
    plateNoLight: plate,
    top: plate,
    pick: plate,
  }
  renderer.dispose()
  return images
}

/** Bake a rotation into the geometry, the way the server bakes orientation. */
export function bakeRotation(geometry, quaternion, yawDeg) {
  const baked = geometry.clone()
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion(...quaternion))
  if (yawDeg) {
    m.premultiply(new THREE.Matrix4().makeRotationZ(
      THREE.MathUtils.degToRad(yawDeg)))
  }
  baked.applyMatrix4(m)
  baked.computeVertexNormals()
  return baked
}
