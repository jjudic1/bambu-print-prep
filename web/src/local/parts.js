import * as THREE from 'three'

import { plateOrigin } from '../make3mf.js'
import { modelPose } from './pose.js'

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
 * The most pieces a split will lay out.
 *
 * Not a limit on what fits: the writer follows Bambu Studio's own plate grid
 * however many plates there are. It is a guard against a model that is not a
 * kit at all -- an export that came out as thousands of loose crumbs -- which
 * would freeze the page laying out a part per crumb.
 *
 * It was 64, and that turned away a real kit: Titan 3D's Titan Fighter is 73
 * objects in Bambu Studio and comes apart into 77 pieces, every one at least
 * 19 mm long (contact form, 2026-10-07). Kits of that kind run well past 100.
 */
export const MAX_PARTS = 300

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
export function splitParts(geometry, { maxParts = MAX_PARTS } = {}) {
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

  const pieces = keepCavitiesInside([...buckets.values()], position, vertexOf)
  if (pieces.length <= 1) return null           // nothing to split
  if (pieces.length > maxParts) {
    throw new Error(
      `That model comes apart into ${pieces.length} pieces, which is more than ` +
      `this can lay out. It is probably meant to stay whole.`)
  }

  // Biggest first: it is the piece a person is looking for, and it should not
  // arrive last in the list.
  const groups = pieces.sort((a, b) => b.length - a.length)

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
    // Where the piece came from: its lowest triangle in the geometry it was
    // split out of. A project file says which object owns which triangles
    // (read3mf's `userData.project`), and this is how a piece finds its name
    // and its plate again.
    let first = Infinity
    for (const t of triangles) if (t < first) first = t
    part.userData.from = first
    return part
  })
}

/**
 * Put every sealed pocket back inside the piece it is a pocket of.
 *
 * A hollow sealed inside a part -- a pocket for a magnet or a nut, or just to
 * save plastic -- is a second surface facing inwards, sharing no vertex with
 * the outside. Connected components alone call it a part of its own, and the
 * split then does two wrong things at once: the pocket is laid out and printed
 * as a small inside-out lump, and the part it came from prints solid. Titan
 * 3D's Titan Fighter has two in each front body half; its 73 objects came
 * apart into 77 (2026-10-07).
 *
 * A pocket is told apart by its winding: its signed volume is negative. It goes
 * to the piece that really contains it -- a ray from it crosses that piece's
 * surface an odd number of times -- smallest first, so a pocket in a part that
 * sits in another part's pocket goes to the inner one. A negative piece inside
 * nothing is an inside-out export, not a pocket, and is left alone.
 */
function keepCavitiesInside(groups, position, vertexOf) {
  const at = (t, k) => {
    const v = vertexOf(t, k)
    return [position.getX(v), position.getY(v), position.getZ(v)]
  }
  const info = groups.map((triangles) => {
    let volume = 0
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (const t of triangles) {
      const [a, b, c] = [at(t, 0), at(t, 1), at(t, 2)]
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1])
               - a[1] * (b[0] * c[2] - b[2] * c[0])
               + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
      for (const p of [a, b, c]) {
        for (let i = 0; i < 3; i++) {
          if (p[i] < min[i]) min[i] = p[i]
          if (p[i] > max[i]) max[i] = p[i]
        }
      }
    }
    return { triangles, volume, min, max }
  })
  const pockets = info.filter((g) => g.volume < 0)
  if (!pockets.length) return groups

  const solids = info.filter((g) => g.volume >= 0).sort((a, b) => a.volume - b.volume)
  const encloses = (outer, inner) => inner.min.every((v, i) => v >= outer.min[i])
    && inner.max.every((v, i) => v <= outer.max[i])

  // Parity of a ray along +x from a point. The point is the middle of one of
  // the pocket's triangles, which is on no surface of the solid around it, and
  // the ray is nudged off the axis so it does not run along an edge of a mesh
  // built on a grid.
  const inside = (solid, [px, py, pz]) => {
    let crossings = 0
    for (const t of solid.triangles) {
      const [a, b, c] = [at(t, 0), at(t, 1), at(t, 2)]
      // Where the ray's line meets the triangle's plane, by barycentric
      // coordinates in the y-z projection.
      const d = (b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2])
      if (d === 0) continue
      const u = ((py - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (pz - a[2])) / d
      const w = ((b[1] - a[1]) * (pz - a[2]) - (py - a[1]) * (b[2] - a[2])) / d
      if (u < 0 || w < 0 || u + w > 1) continue
      const x = a[0] + u * (b[0] - a[0]) + w * (c[0] - a[0])
      if (x > px) crossings++
    }
    return crossings % 2 === 1
  }

  const kept = new Set()
  for (const pocket of pockets) {
    const t = pocket.triangles[0]
    const [a, b, c] = [at(t, 0), at(t, 1), at(t, 2)]
    const probe = [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3 + (i ? 1e-4 * i : 0))
    const home = solids.find((s) => encloses(s, pocket) && inside(s, probe))
    if (!home) continue
    home.triangles.push(...pocket.triangles)
    kept.add(pocket)
  }
  return info.filter((g) => !kept.has(g)).map((g) => g.triangles)
}

/**
 * The parts of the bed nothing may stand on, as rectangles in bed millimetres.
 *
 * A P1S, a P1P and every X1 keep an 18 x 28 mm corner at the front left for
 * purging and wiping the nozzle; the A1 family and the H2 machines have none.
 * It is a fact about the machine, carried per printer in the baked profiles,
 * and it is the reason this exists at all: a plate whose parts sit in that
 * corner opens perfectly well and then fails to slice on upload, with nothing
 * on screen having looked wrong.
 *
 * Each region is stored as the polygon the vendor profile writes, and reduced
 * here to the box around it. Every one of them is already a rectangle, and
 * where one day it is not, the box is the conservative read -- it keeps parts
 * further out rather than letting them creep in.
 */
export function keepOuts(printer) {
  return (printer?.exclude_areas || []).map((polygon) => {
    const xs = polygon.map((p) => p[0])
    const ys = polygon.map((p) => p[1])
    return {
      x0: Math.min(...xs), y0: Math.min(...ys),
      x1: Math.max(...xs), y1: Math.max(...ys),
    }
  }).filter((z) => z.x1 > z.x0 && z.y1 > z.y0)
}

/**
 * The first keep-out a footprint lands on, or null. `x`/`y` are its near corner.
 *
 * Touching along an edge is not landing on it: a part parked exactly at the
 * zone's edge is where the packer deliberately puts things, and calling that a
 * clash would push everything a further gap away for no reason.
 */
export function clash(zones, x, y, width, depth) {
  return zones.find((z) => x < z.x1 && x + width > z.x0
                        && y < z.y1 && y + depth > z.y0) || null
}

/** Footprint of a geometry under a given pose. */
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
 *
 * Rows start at the BACK left and fill toward the front. The front of the bed
 * is where the printer purges and wipes before it starts (the line along the
 * front edge, and on a P1S or an X1 the corner at the front left that it will
 * not print on at all), so a plate with a few parts on it keeps them out of
 * that way, and only a full plate reaches the front.
 *
 * The bed it fills is still not always the whole rectangle. A row that runs
 * into a keep-out steps past it, and starts a new row if that leaves no room:
 * rows started at the front left once put the first part of every plate in
 * that corner -- a file that opens, looks right, and is refused at slice time.
 *
 * The packing below works from the back: its y runs from the back edge toward
 * the front (the keep-outs are turned round to match), and each placement is
 * turned back into the bed's own y, which runs from the front.
 *
 * `matrixFor` is a function rather than one matrix because parts no longer share
 * a pose -- each can be tipped onto its own face -- and a part's footprint is
 * what decides where it fits. Passing one shared matrix would lay out the shapes
 * the parts used to be.
 */
export function arrange(parts, printer, matrixFor, { gap = 6, margin = 8 } = {}) {
  const [bedX, bedY] = printer.bed_mm
  const usableX = bedX - margin * 2
  const usableY = bedY - margin * 2
  // The keep-outs as the packing sees them: y from the back edge.
  const zones = keepOuts(printer).map((z) => ({
    x0: z.x0, y0: bedY - z.y1, x1: z.x1, y1: bedY - z.y0,
  }))

  const measured = parts.map((part) => ({
    part, ...footprint(part.geometry, matrixFor(part)),
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

  // Whether a footprint has anywhere to go at all once the keep-outs are taken
  // out of the bed. A part that has nowhere is as unplaceable as one bigger
  // than the bed, and is reported the same way rather than being shuffled
  // around forever.
  //
  // Asked directly -- is any spot clear? -- at the spots the loop below can
  // actually reach: the back-left margin, or just past a keep-out (stepping
  // right of it, or a row behind it). A spot only this check could see would
  // pass a part the loop then has nowhere to put. It used to
  // be a shortcut ("a row past the zones, or a row beyond them") that assumed
  // the zones sat at the start of the rows. Since rows start at the back, the
  // purge corner sits at the *end*, so "beyond" it was off the bed and every
  // part wider than the room beside it was refused: on a P1S, anything over
  // 224 mm across. That flagged both 225 mm body halves of a real kit as too
  // big for a 256 mm bed (Titan Fighter, 2026-10-07).
  const fitsClear = (width, depth) => {
    if (!zones.length) return true
    const xs = [margin, ...zones.map((z) => z.x1 + gap)]
    const ys = [margin, ...zones.map((z) => z.y1 + gap)]
    return xs.some((x) => x >= margin && x + width <= margin + usableX
      && ys.some((y) => y >= margin && y + depth <= margin + usableY
        && !clash(zones, x, y, width, depth)))
  }

  for (const item of order) {
    if (item.width > usableX || item.depth > usableY
        || !fitsClear(item.width, item.depth)) {
      // Its own plate, so at least it is visible and the warning is specific.
      if (placed.some((p) => p.plate === plate)) newPlate()
      placed.push({ ...item, plate, x: bedX / 2, y: bedY / 2 })
      tooBig.push(item.part)
      newPlate()
      continue
    }
    // Find the first spot that is on the bed and clear of every keep-out.
    // Stepping right past a zone can run the row off the edge, wrapping to the
    // next row can drop it back alongside another zone, so this settles rather
    // than tests once. The guard is not expected to bite -- rows only ever move
    // up the bed and plates only ever forwards -- and if it ever did, placing
    // the part is still better than looping.
    for (let settle = 0; settle < 64; settle++) {
      if (cursorX + item.width > margin + usableX) {   // next shelf
        cursorX = margin
        cursorY += shelfDepth + gap
        shelfDepth = 0
      }
      if (cursorY + item.depth > margin + usableY) {   // next plate
        newPlate()
      }
      const zone = clash(zones, cursorX, cursorY, item.width, item.depth)
      if (!zone) break
      cursorX = zone.x1 + gap                          // step past it
    }
    placed.push({
      ...item, plate,
      x: cursorX + item.width / 2,
      y: bedY - (cursorY + item.depth / 2),           // back to the bed's y
    })
    cursorX += item.width + gap
    shelfDepth = Math.max(shelfDepth, item.depth)
  }

  return {
    placements: placed.map(({ part, plate: p, x, y }) => ({ id: part.id, plate: p, x, y })),
    // Counted from where parts went, not from the cursor: a too-big part moves
    // the cursor on to a fresh plate, and when it was the last part that plate
    // stays empty. The viewer showed it; the writer drops it, since Bambu
    // refuses an empty plate -- so the screen said 28 plates for a file of 17.
    plateCount: Math.max(0, ...placed.map((q) => q.plate)) + 1,
    tooBig,
  }
}

/**
 * How big a set of parts is together, unscaled, in the model's frame.
 *
 * The size controls divide by this, which is why taking a part away is not
 * just a filter: the set shrinks, the same "80 mm longest side" now means a
 * bigger scale, and every part left behind grows without anyone asking.
 * `keepScale` is the other half of that.
 *
 * Measured with the model's stretch (`shape`, see pose.js) and its turn, but
 * not its overall size -- that overall size is what the slider sets.
 */
export function modelSize(parts, base, shape = null) {
  if (!parts.length) return null
  const m = modelPose(base, shape)
  const box = new THREE.Box3()
  for (const part of parts) box.union(footprint(part.geometry, m).box)
  const size = box.getSize(new THREE.Vector3())
  return [size.x, size.y, size.z]
}

/**
 * Where a split piece came from, in a Bambu Studio project: its object's name,
 * the plate it was on, and where on that plate it stood.
 *
 * `project` is read3mf's `userData.project`; null when the model was not a
 * project, or the piece cannot be traced (it came out of a part split before).
 * `home` is the centre of the piece on its plate, in plate millimetres -- the
 * same `x`/`y` a part carries here -- and only meaningful on a bed the size of
 * `project.bed`. `object` says which of the file's objects it was: a piece is
 * only where its designer put it if its object came out as that one piece.
 */
export function fromProject(geometry, project) {
  const from = geometry.userData?.from
  if (!project || from === undefined) return null
  const index = project.objects.findIndex((o) => from >= o.start && from < o.start + o.count)
  const object = project.objects[index]
  if (!object || object.plate === null) return null

  let home = null
  if (project.bed) {
    geometry.computeBoundingBox()
    const centre = geometry.boundingBox.getCenter(new THREE.Vector3())
    const [ox, oy] = plateOrigin(object.plate, { bed_mm: project.bed }, project.plateCount)
    home = { x: centre.x - ox, y: centre.y - oy, bed: project.bed }
  }
  return { name: object.name, group: object.plate, home, object: index }
}

/**
 * Lay parts out a plate-group at a time, keeping a file's own plates.
 *
 * A project's plates are somebody's decisions -- parts grouped by colour, or by
 * what is printed together -- so parts carrying a `group` are never mixed with
 * another group's. Groups go in their own order, each starting a fresh plate.
 *
 * With `keepHomes`, a group whose every part still fits where the file had it
 * (same size of bed, on the bed, off the keep-outs, under the height) stays
 * exactly where it was: one plate, the designer's layout. Any other group is
 * packed by `arrange`, onto as many plates as it needs -- which on a smaller
 * bed than the file's may be more than one. Parts with no group are packed
 * together after the rest. Nothing with a group at all is plain `arrange`.
 */
export function arrangeInGroups(parts, printer, matrixFor, { keepHomes = false } = {}) {
  if (!parts.some((p) => p.group !== undefined && p.group !== null)) {
    return { ...arrange(parts, printer, matrixFor), kept: 0 }
  }
  const [bedX, bedY] = printer.bed_mm
  const zones = keepOuts(printer)
  const atHome = (part) => {
    const home = part.home
    if (!home || Math.abs(home.bed[0] - bedX) > 0.5 || Math.abs(home.bed[1] - bedY) > 0.5) return false
    const { width, depth, height } = footprint(part.geometry, matrixFor(part))
    const x0 = home.x - width / 2
    const y0 = home.y - depth / 2
    return x0 >= 0 && y0 >= 0 && x0 + width <= bedX && y0 + depth <= bedY
      && height <= (printer.height_mm ?? Infinity)
      && !clash(zones, x0, y0, width, depth)
  }

  const keys = [...new Set(parts.map((p) => p.group ?? null))]
    .sort((a, b) => (a === null) - (b === null) || a - b)
  const placements = []
  const tooBig = []
  let plate = 0
  let kept = 0
  for (const key of keys) {
    const members = parts.filter((p) => (p.group ?? null) === key)
    if (keepHomes && key !== null && members.every(atHome)) {
      for (const p of members) placements.push({ id: p.id, plate, x: p.home.x, y: p.home.y })
      plate += 1
      kept += 1
      continue
    }
    const packed = arrange(members, printer, matrixFor)
    for (const q of packed.placements) placements.push({ ...q, plate: q.plate + plate })
    tooBig.push(...packed.tooBig)
    plate += packed.plateCount
  }
  return { placements, plateCount: plate, tooBig, kept }
}

/**
 * The size settings that keep the same scale on a different set of parts.
 *
 * The sliders store a size, not a scale, so a change to what is being measured
 * has to move the size by the same ratio or the parts that stayed put change
 * size instead. Unrounded on purpose: a rounded figure is a slightly different
 * scale, and put-back-then-removed would creep.
 */
export function keepScale(before, after, { longestMm, sizeMm }) {
  if (!before || !after) return { longestMm, sizeMm }
  const longest = Math.max(...before) || 1
  return {
    longestMm: longestMm * (Math.max(...after) / longest),
    sizeMm: sizeMm && sizeMm.map((v, i) => v * (after[i] / (before[i] || 1))),
  }
}

/**
 * Take one part off the job. Null when that would leave nothing: the last part
 * is what Start over is for, and a model with no parts has no size to keep.
 *
 * Hands back where it was, so a mis-tap on a touch screen can be put back.
 */
export function withoutPart(parts, id) {
  const index = parts.findIndex((p) => p.id === id)
  if (index < 0 || parts.length < 2) return null
  return {
    parts: [...parts.slice(0, index), ...parts.slice(index + 1)],
    removed: { part: parts[index], index },
  }
}

/**
 * Put a removed part back where it was in the list, and on its plate if that
 * plate still exists -- on the last one if not. Refuses a part already there,
 * which is what "Put it back together" would otherwise make of it.
 */
export function withPartBack(parts, removed, plateCount) {
  if (!removed || parts.some((p) => p.id === removed.part.id)) return null
  const part = { ...removed.part, plate: Math.min(removed.part.plate, plateCount - 1) }
  const at = Math.min(removed.index, parts.length)
  return [...parts.slice(0, at), part, ...parts.slice(at)]
}

/**
 * Take an empty plate away. Null for a plate with anything on it, or for the
 * only one -- there is always a plate 1.
 *
 * Every plate after it moves down one, parts and all, so the numbers on screen
 * stay 1, 2, 3 with no gap. The file has no gaps either: the writer numbers
 * plates by position, and an empty plate in the middle is the one thing
 * Bambu Studio refuses outright.
 */
export function withoutPlate(parts, plate, plateCount) {
  if (plateCount < 2 || plate < 0 || plate >= plateCount) return null
  if (parts.some((p) => p.plate === plate)) return null
  return {
    parts: parts.map((p) => (p.plate > plate ? { ...p, plate: p.plate - 1 } : p)),
    plateCount: plateCount - 1,
  }
}
