import * as THREE from 'three'

/**
 * Take the bottom off a model so it stands on a flat face.
 *
 * The hosted app already does this on its own (`prep/base.py`): it hunts for the
 * smallest cut that gives a real footprint and refuses to take more than 8% of
 * the height, because guessing wrong throws away somebody's model. Here there is
 * no guess to make -- the user is looking at the plate and choosing the height
 * themselves -- so there is no ceiling and no search, just the cut they asked
 * for.
 *
 * **The cut is real geometry, not a squash.** Pulling every low vertex up onto
 * the plane would be four lines and would look right on a dense scan, but on
 * anything coarse -- a cone, a low-poly figure -- the sub-plane triangles
 * survive as slivers and the silhouette at the plate is wrong by however far
 * apart the vertices are. So triangles are clipped against the plane and the
 * opening is capped.
 *
 * **The cap is the hard half.** A horizontal cut through a bust is one loop;
 * through a ring, or a pair of legs, it is several, and one loop can sit inside
 * another (a vase is an outer wall and a hole). Getting that wrong does not
 * raise anything -- it prints as a model with a bottom that is filled in where
 * it should be open, or open where it should be filled. So loops are stitched
 * from the cut edges, nested by containment rather than by winding, and handed
 * to three.js's own ear-clipping triangulator, which takes holes.
 *
 * Everything here works in the *posed* frame: z is up, the plate is at the
 * model's lowest point, and the cut plane is `depth` millimetres above it. That
 * is the only frame in which "the bottom" means anything, and it is the frame
 * the viewer and the writer both hand geometry over in.
 *
 * `web/flatten-check.mjs` checks the results by signed volume and by whether
 * every edge is still shared by exactly two triangles -- a cap that misses a
 * loop leaves the volume plausible and the bounding box perfect.
 */

// Millimetres. A vertex within this of the plane counts as being on it rather
// than above or below it. Positions arrive as float32, whose resolution at a
// 200 mm coordinate is about 1.5e-5 mm, so anything tighter would classify the
// same point differently depending on which triangle asked.
const ON_PLANE = 1e-4

// Refuse a cut that would leave less than this standing. Not a policy about how
// much may be removed -- that is the user's call -- but a guard against handing
// the writer an empty plate.
const MIN_LEFT = 0.05

/** How many cut results to keep. Dragging a part re-poses it every frame. */
const CACHE_SIZE = 16
const cache = new Map()

/** Which side of the plane a height falls on: 1 above, -1 below, 0 on it. */
const side = (d) => (d > ON_PLANE ? 1 : (d < -ON_PLANE ? -1 : 0))

/** Twice the signed area of a loop in the plate's plane. CCW is positive. */
function signedArea(points) {
  let sum = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y)
  }
  return -sum / 2
}

/** Is this point inside that loop? Ray casting, so concave loops are fine. */
function inside(point, loop) {
  let hit = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if ((a.y > point.y) !== (b.y > point.y)
        && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit
    }
  }
  return hit
}

/**
 * Stitch directed cut edges into closed loops.
 *
 * Each triangle that straddles the plane leaves exactly one edge lying in it,
 * pointing the way that triangle was wound. Following those from end to end
 * walks the outline of the opening. A vertex where two loops meet at a point
 * has more than one edge leaving it; any of them closes a loop, so the choice
 * does not matter and the first unused one is taken.
 *
 * An edge that leads nowhere means the model was not closed there to begin
 * with -- a hole in the original -- and that partial walk is dropped rather
 * than capped, because there is no outline to cap.
 */
function loopsFrom(edges) {
  // Edges out of each vertex, as a stack to pop from. Indexed rather than
  // scanned: the outline of a cut through a detailed model runs to thousands of
  // edges, and searching the list for each step would square that.
  const leaving = new Map()
  for (const [from, to] of edges) {
    if (!leaving.has(from)) leaving.set(from, [])
    leaving.get(from).push(to)
  }

  const loops = []
  for (const [start, outgoing] of leaving) {
    while (outgoing.length) {
      const walk = [start]
      let at = outgoing.pop()
      while (at !== start) {
        const next = leaving.get(at)
        if (!next?.length) { walk.length = 0; break }   // open at this end
        walk.push(at)
        at = next.pop()
        if (walk.length > edges.length) { walk.length = 0; break }
      }
      if (walk.length >= 3) loops.push(walk)
    }
  }
  return loops
}

/**
 * Cut everything below `depth` off a posed geometry, and cap the opening.
 *
 * Returns a new geometry, or null when the cut would leave nothing standing.
 * The input is not touched.
 */
export function cutBottom(geometry, depth) {
  if (!(depth > 0)) return geometry

  geometry.computeBoundingBox()
  const plane = geometry.boundingBox.min.z + depth
  if (plane >= geometry.boundingBox.max.z - MIN_LEFT) return null

  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const triangleCount = index ? index.count / 3 : position.count / 3
  const vertexOf = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k)

  const out = []                  // the new vertex list, flat xyz
  const kept = new Map()          // original vertex -> new vertex
  const crossed = new Map()       // "lo_hi" edge -> the new vertex on the plane
  const triangles = []
  const rim = []                  // directed edges lying in the plane

  const keep = (v) => {
    let i = kept.get(v)
    if (i === undefined) {
      i = out.length / 3
      kept.set(v, i)
      // Snapped rather than left a hair off: a vertex the epsilon called "on
      // the plane" has to actually be on it, or the cap it belongs to is not
      // flat and the model rocks on the plate.
      const z = position.getZ(v)
      out.push(position.getX(v), position.getY(v),
               Math.abs(z - plane) <= ON_PLANE ? plane : z)
    }
    return i
  }

  // Keyed on the original pair, and always in the same order, so the two
  // triangles either side of an edge land on one vertex rather than two a
  // rounding error apart -- which would leave the cap outline in pieces.
  const cross = (a, b) => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const key = `${lo}_${hi}`
    let i = crossed.get(key)
    if (i === undefined) {
      const za = position.getZ(lo)
      const zb = position.getZ(hi)
      const t = (plane - za) / (zb - za)
      i = out.length / 3
      crossed.set(key, i)
      out.push(position.getX(lo) + (position.getX(hi) - position.getX(lo)) * t,
               position.getY(lo) + (position.getY(hi) - position.getY(lo)) * t,
               plane)
    }
    return i
  }

  for (let t = 0; t < triangleCount; t++) {
    const v = [vertexOf(t, 0), vertexOf(t, 1), vertexOf(t, 2)]
    const s = v.map((i) => side(position.getZ(i) - plane))

    if (s.every((x) => x <= 0)) continue     // below, or lying in the plane
    if (s.every((x) => x < 0)) continue

    // Sutherland-Hodgman against the half-space above the plane. Three corners
    // in, three or four out.
    const poly = []
    for (let k = 0; k < 3; k++) {
      const a = v[k]
      const b = v[(k + 1) % 3]
      if (s[k] >= 0) poly.push({ at: keep(a), on: s[k] === 0 })
      if (s[k] * s[(k + 1) % 3] < 0) poly.push({ at: cross(a, b), on: true })
    }
    if (poly.length < 3) continue

    for (let k = 1; k < poly.length - 1; k++) {
      const [a, b, c] = [poly[0].at, poly[k].at, poly[k + 1].at]
      if (a !== b && b !== c && c !== a) triangles.push(a, b, c)
    }

    // The edge this triangle leaves in the plane, wound the way the triangle
    // was. Following those is what draws the outline of the opening.
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k]
      const b = poly[(k + 1) % poly.length]
      if (a.on && b.on && a.at !== b.at) rim.push([a.at, b.at])
    }
  }

  if (!triangles.length) return null

  // --- the cap -------------------------------------------------------------

  const loops = loopsFrom(rim)
  const flat = loops.map((loop) => loop.map(
    (i) => new THREE.Vector2(out[i * 3], out[i * 3 + 1])))

  // A loop inside an odd number of others is a hole; inside an even number it
  // is solid. Nesting rather than winding, because a model that arrived with a
  // face wound the wrong way would otherwise turn its bottom inside out.
  const depthOf = flat.map((loop, i) => flat.reduce(
    (n, other, j) => (j !== i && inside(loop[0], other) ? n + 1 : n), 0))

  const holes = []
  const outers = []
  flat.forEach((loop, i) => (depthOf[i] % 2 ? holes : outers).push(i))

  for (const o of outers) {
    // Whichever holes sit directly in this outline: inside it, and inside no
    // other outline that is itself inside this one.
    const mine = holes.filter((h) => depthOf[h] === depthOf[o] + 1
      && inside(flat[h][0], flat[o]))

    const turn = (i, wantCcw) => {
      const points = flat[i].slice()
      const ids = loops[i].slice()
      if ((signedArea(points) > 0) !== wantCcw) { points.reverse(); ids.reverse() }
      return { points, ids }
    }

    const contour = turn(o, true)
    const inner = mine.map((h) => turn(h, false))
    const ids = [...contour.ids, ...inner.flatMap((h) => h.ids)]

    let faces
    try {
      faces = THREE.ShapeUtils.triangulateShape(
        contour.points, inner.map((h) => h.points))
    } catch {
      // A self-touching outline defeats ear clipping. Leaving that one opening
      // uncapped is a far better outcome than losing the whole cut.
      continue
    }
    // Wound backwards from the outline, so the new face looks down at the
    // plate. Every other face on the model looks outward; this one has to as
    // well or the printer is told the bottom is the inside.
    for (const [a, b, c] of faces) triangles.push(ids[c], ids[b], ids[a])
  }

  const cut = new THREE.BufferGeometry()
  cut.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  cut.setIndex(triangles)
  cut.computeVertexNormals()
  cut.computeBoundingBox()
  return cut
}

/**
 * A part's geometry in its place on the plate: posed, then cut.
 *
 * The viewer and the writer both go through this, so what is drawn and what is
 * written cannot disagree about where the bottom is. Always a fresh geometry --
 * both callers translate what they get back.
 *
 * Cut results are kept, because posing a part happens on every frame of a drag
 * while the cut itself changes only when a slider moves.
 */
export function posedGeometry(part, matrix) {
  const depth = part.cutMm || 0
  if (depth <= 0) {
    const posed = part.geometry.clone()
    posed.applyMatrix4(matrix)
    return posed
  }

  const key = `${part.geometry.uuid}|${depth}|${
    matrix.elements.map((n) => n.toFixed(6)).join(',')}`
  let hit = cache.get(key)
  if (hit === undefined) {
    const posed = part.geometry.clone()
    posed.applyMatrix4(matrix)
    // A cut that leaves nothing is not silently the whole model: null is
    // remembered, and the caller falls back to the uncut shape so the user can
    // see what they did and drag the slider back.
    hit = cutBottom(posed, depth)
    if (hit === null) hit = posed
    cache.set(key, hit)
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value)
  }
  return hit.clone()
}
