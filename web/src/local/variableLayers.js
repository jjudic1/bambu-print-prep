/**
 * Variable layer height, worked out here so the file arrives with it on.
 *
 * Bambu Studio's "Variable layer height" (the Adaptive button, Quality/Speed slider at
 * 0.5) is not a setting in project_settings.config: it is a per-object table of
 * (height, layer thickness) pairs, `Metadata/layer_heights_profile.txt`, computed in the
 * slicer's window from the model's surface. Nothing in the profile turns it on, so a file
 * that wants it has to carry the table. This is a port of that computation
 * (SlicingAdaptive in PrusaSlicer and Bambu Studio, after Wasserfall, Hendrich and Zhang,
 * "Adaptive Slicing for the FDM Process Revisited", CASE 2017): thin layers where the
 * surface is close to flat-but-sloped (the top of a dome, where the steps show) and thick
 * ones where the walls run straight up (where they do not).
 *
 * The answer is checked the only way that counts: Bambu Studio slices the file, and the
 * G-code's layer heights vary (web/layers-check.mjs, and the note in docs/HANDOFF.md).
 *
 * Pure: arrays in, array out, no three.js, so the check runs in node.
 */

/** Where the Quality/Speed slider sits when the dialog opens. */
export const QUALITY = 0.5

const EPSILON = 1e-4

/** The slicing numbers for one printer profile (its process settings blob). */
export function slicingParams(settings) {
  const first = (v) => Number(Array.isArray(v) ? v[0] : v)
  const nozzle = first(settings.nozzle_diameter) || 0.4
  const layer = first(settings.layer_height) || 0.2
  let minLayer = first(settings.min_layer_height) || 0.07
  let maxLayer = first(settings.max_layer_height) || 0
  if (!(maxLayer > 0)) maxLayer = 0.75 * nozzle
  minLayer = Math.min(minLayer, layer)
  maxLayer = Math.max(maxLayer, layer)
  const firstLayer = first(settings.initial_layer_print_height) || layer
  return { layer, minLayer, maxLayer, firstLayer }
}

/** Each triangle's z span and how steep it is, sorted by where it starts. */
function faces(vertices, triangles) {
  const out = []
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2]
    const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (!(len > 0)) continue
    const za = vertices[a + 2], zb = vertices[b + 2], zc = vertices[c + 2]
    const lo = Math.min(za, zb, zc), hi = Math.max(za, zb, zc)
    const cos = Math.abs(nz / len)
    out.push({ lo, hi, cos, sin: Math.sqrt(Math.max(0, 1 - cos * cos)) })
  }
  out.sort((p, q) => p.lo - q.lo || p.hi - q.hi)
  return out
}

/** The layer a face of this slope allows (Vojtech's error metric, as the slicer uses). */
function heightFromSlope(face, deviation) {
  return face.cos > 1e-5 ? 1.44 * deviation * Math.sqrt(face.sin / face.cos) : Infinity
}

/**
 * The table Bambu Studio's Adaptive button makes for one object standing on z = 0:
 * [z0, h0, z1, h1, ...], every z where a layer starts and that layer's thickness.
 */
export function adaptiveProfile(vertices, triangles, params, quality = QUALITY) {
  const { layer, minLayer, maxLayer, firstLayer } = params
  let top = 0
  for (let i = 2; i < vertices.length; i += 3) top = Math.max(top, vertices[i])
  const fs = faces(vertices, triangles)

  // Quality 0 allows the coarsest surface, 1 the finest; 0.5 is the profile's own layer.
  const lerp = (a, b, t) => a + (b - a) * t
  const deviation = quality < 0.5
    ? lerp(minLayer, layer, 2 * quality)
    : lerp(maxLayer, layer, 2 * (1 - quality))

  let current = 0
  const next = (z) => {
    let height = maxLayer
    let id = current
    let firstHit = false
    for (; id < fs.length; id++) {
      const f = fs[id]
      if (f.lo >= z) break
      if (f.hi > z) {
        if (!firstHit) {
          firstHit = true
          current = id
        }
        if (f.hi < z + EPSILON) continue
        height = Math.min(height, heightFromSlope(f, deviation))
      }
    }
    height = Math.max(height, minLayer)
    if (height > minLayer) {
      for (; id < fs.length; id++) {
        const f = fs[id]
        if (f.lo >= z + height) break
        if (f.hi < z + EPSILON) continue
        const reduced = heightFromSlope(f, deviation)
        const gap = f.lo - z
        if (reduced < gap) height = Math.max(gap, minLayer)
        else if (reduced < height) height = reduced
      }
      height = Math.max(height, minLayer)
    }
    return height
  }

  const profile = [0, firstLayer, firstLayer, firstLayer]
  let z = firstLayer
  while (z + EPSILON < top) {
    let height = Math.min(next(z), maxLayer)
    if (z + height > top) height = Math.max(top - z, minLayer)
    profile.push(z, height)
    z += height
  }
  const gap = top - profile[profile.length - 2]
  if (gap > 0) profile.push(top, Math.min(Math.max(gap, minLayer), maxLayer))
  return profile.map((v) => Math.round(v * 1e6) / 1e6)
}

/**
 * `Metadata/layer_heights_profile.txt`: one line per object that has a table,
 * `object_id=N|z;h;z;h;...`, N counting the objects from 1 in the order the model lists them.
 */
export function layerHeightsFile(profiles) {
  const lines = []
  profiles.forEach((profile, index) => {
    if (!profile || profile.length < 4) return
    lines.push(`object_id=${index + 1}|${profile.map((v) => v.toFixed(6)).join(';')}`)
  })
  return lines.length ? `${lines.join('\n')}\n` : null
}
