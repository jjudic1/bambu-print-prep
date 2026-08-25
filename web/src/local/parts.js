import * as THREE from 'three'

/**
 * Splitting a model into parts, and arranging parts across plates.
 *
 * Both exist for one case: a printer whose bed is smaller than the thing being
 * printed. An A1 mini is 180 mm, and a great many models on MakerWorld are not.
 * Splitting is deliberately *not* automatic on import -- a file whose pieces are
 * meant to stay put relative to each other would be ruined by it, and there is
 * no way to tell those apart from an assembly. So it is a button.
 */

/**
 * Separate a geometry into its connected pieces.
 *
 * Union-find over vertices, joined by every triangle. A piece is a set of
 * triangles reachable from each other through shared vertices, which is what a
 * person means by "part" when a file contains several loose objects.
 *
 * Positions are compared exactly rather than by proximity: the geometry has
 * already been through mergeVertices, so anything meant to be one surface
 * already shares indices. Welding by distance here would fuse parts that are
 * merely touching, which is the wrong answer for a print-in-place assembly.
 */
export function splitParts(geometry, { maxParts = 64 } = {}) {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triangleCount = index ? index.count / 3 : position.count / 3
  const vertexOf = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k)

  const parent = new Int32Array(position.count)
  for (let i = 0; i < parent.length; i++) parent[i] = i
  const find = (a) => {
    let root = a
    while (parent[root] !== root) root = parent[root]
    while (parent[a] !== root) { const next = parent[a]; parent[a] = root; a = next }
    return root
  }
  const union = (a, b) => {
    const ra = find(a); const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  for (let t = 0; t < triangleCount; t++) {
    const a = vertexOf(t, 0); const b = vertexOf(t, 1); const c = vertexOf(t, 2)
    union(a, b); union(b, c)
  }

  const buckets = new Map()
  for (let t = 0; t < triangleCount; t++) {
    const key = find(vertexOf(t, 0))
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(t)
  }

  if (buckets.size <= 1) return null            // nothing to split
  if (buckets.size > maxParts) {
    throw new Error(
      `That model comes apart into ${buckets.size} pieces, which is more than ` +
      `this can lay out. It is probably meant to stay whole.`)
  }

  // Biggest first: it is the piece a person is looking for, and it should not
  // arrive last in the list.
  const groups = [...buckets.values()].sort((a, b) => b.length - a.length)

  return groups.map((triangles) => {
    const positions = []
    const remap = new Map()
    const indices = []
    for (const t of triangles) {
      for (let k = 0; k < 3; k++) {
        const v = vertexOf(t, k)
        if (!remap.has(v)) {
          remap.set(v, positions.length / 3)
          positions.push(position.getX(v), position.getY(v), position.getZ(v))
        }
        indices.push(remap.get(v))
      }
    }
    const part = new THREE.BufferGeometry()
    part.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    part.setIndex(indices)
    part.computeVertexNormals()
    part.computeBoundingBox()
    return part
  })
}

/** Footprint of a geometry after the shared rotation and scale. */
export function footprint(geometry, matrix) {
  const box = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position')).applyMatrix4(matrix)
  const size = box.getSize(new THREE.Vector3())
  return { width: size.x, depth: size.y, height: size.z, box }
}

/**
 * Lay parts out across as many plates as it takes.
 *
 * Shelf packing: sort by depth, fill a row until it is full, start a new row,
 * start a new plate when the rows run out. Not optimal -- optimal bin packing
 * is not worth it here -- but it is stable, which matters more: the same parts
 * in the same order land in the same places every time, so pressing Arrange
 * twice does not shuffle the plate.
 *
 * A part too big for the bed on its own is placed anyway, on its own plate, and
 * reported. Refusing to place it would leave the user with no way to see the
 * problem.
 */
export function arrange(parts, printer, matrix, { gap = 6, margin = 8 } = {}) {
  const [bedX, bedY] = printer.bed_mm
  const usableX = bedX - margin * 2
  const usableY = bedY - margin * 2

  const measured = parts.map((part) => ({
    part, ...footprint(part.geometry, matrix),
  }))
  const order = [...measured].sort((a, b) => b.depth - a.depth || b.width - a.width)

  const placed = []
  const tooBig = []
  let plate = 0
  let cursorX = margin
  let cursorY = margin
  let shelfDepth = 0

  const newPlate = () => {
    plate += 1; cursorX = margin; cursorY = margin; shelfDepth = 0
  }

  for (const item of order) {
    if (item.width > usableX || item.depth > usableY) {
      // Its own plate, so at least it is visible and the warning is specific.
      if (placed.some((p) => p.plate === plate)) newPlate()
      placed.push({ ...item, plate, x: bedX / 2, y: bedY / 2 })
      tooBig.push(item.part)
      newPlate()
      continue
    }
    if (cursorX + item.width > margin + usableX) {   // next shelf
      cursorX = margin
      cursorY += shelfDepth + gap
      shelfDepth = 0
    }
    if (cursorY + item.depth > margin + usableY) {   // next plate
      newPlate()
    }
    placed.push({
      ...item, plate,
      x: cursorX + item.width / 2,
      y: cursorY + item.depth / 2,
    })
    cursorX += item.width + gap
    shelfDepth = Math.max(shelfDepth, item.depth)
  }

  return {
    placements: placed.map(({ part, plate: p, x, y }) => ({ id: part.id, plate: p, x, y })),
    plateCount: plate + 1,
    tooBig,
  }
}
