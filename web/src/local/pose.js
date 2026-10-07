import * as THREE from 'three'

import { IDENTITY, sameOrientation } from '../orientation.js'

/**
 * Where a part ends up, and how a stretch is kept: the arithmetic behind the
 * size and turning controls, out of React so the check harness runs the same
 * code the app does.
 *
 * The chain, applied to a part's geometry from the right:
 *
 *   yaw . spin . scale . [ k . base . modelShape ] . partShape
 *                          '------ the model -----'
 *
 * `base`, `spin` and `yaw` turn; `k` and a part's `scale` are uniform; the two
 * shapes are the stretches -- Across, Deep and Tall set apart.
 *
 * **A stretch belongs to the shape, not to the bed.** Both shapes sit on the
 * geometry side of every turn, so tipping something carries its stretch with
 * it: a side set to 20 mm is still 20 mm after the side has rolled to face up.
 * They used to be applied along the bed's directions, after the turn -- so
 * tipping a stretched model moved the 20 mm onto whichever side now faced that
 * way, and the size readout changed under somebody who had only turned it over
 * (2026-10-07). The sliders still speak the bed's directions; `stretchAlong`
 * is what turns "Tall to 20 mm, as it sits now" into a change to the shape.
 *
 * A shape is a 3x3 matrix, as the nine numbers of THREE.Matrix3 (column-major).
 * It starts as the identity and stays symmetric and positive definite -- every
 * stretch is positive along one direction -- so nothing it does can mirror a
 * part.
 */

export const NO_STRETCH = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1])

export const stretched = (shape) => !!shape
  && shape.some((v, i) => Math.abs(v - NO_STRETCH[i]) > 1e-9)

/** A shape as a 4x4, for chaining with the rest of the pose. */
export function shapeMatrix(shape) {
  const m = new THREE.Matrix4()
  if (shape) m.setFromMatrix3(new THREE.Matrix3().fromArray(shape))
  return m
}

const rotation = (q) => new THREE.Matrix4().makeRotationFromQuaternion(
  new THREE.Quaternion(...q))

/** The model's pose and stretch, before its overall size: base . shape. */
export function modelPose(base, shape) {
  return rotation(base).multiply(shapeMatrix(shape))
}

/** The whole model's own transform: k . base . shape. */
export function modelMatrix(base, shape, k) {
  return modelPose(base, shape).premultiply(new THREE.Matrix4().makeScale(k, k, k))
}

/**
 * Where one part actually ends up: its own turn and size on top of the model,
 * its own stretch underneath. Handed to the viewer and the writer both.
 */
export function partMatrix(model, part) {
  const m = model.clone().multiply(shapeMatrix(part.shape))
  if (part.scale && part.scale !== 1) {
    m.premultiply(new THREE.Matrix4().makeScale(part.scale, part.scale, part.scale))
  }
  if (part.spin && !sameOrientation(part.spin, IDENTITY)) m.premultiply(rotation(part.spin))
  if (part.yaw) m.premultiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(part.yaw)))
  return m
}

/**
 * The shape that stretches by `factor` along bed axis `axis` (0 across, 1 deep,
 * 2 tall), as the thing currently sits.
 *
 * `outside` is everything applied after the shape -- the turns and sizes that
 * put it where it is now. Stretching the posed thing along a bed axis is
 * D . outside . shape; keeping `outside` as it is means the new shape is
 * outside^-1 . D . outside . shape. Exact on the bounding box: the extent along
 * `axis` scales by `factor` and the other two do not move.
 */
export function stretchAlong(shape, outside, axis, factor) {
  const o = new THREE.Matrix3().setFromMatrix4(outside)
  const d = new THREE.Matrix3().identity()
  d.elements[axis * 4] = factor
  const next = o.clone().invert().multiply(d).multiply(o)
    .multiply(new THREE.Matrix3().fromArray(shape || NO_STRETCH))
  // Rounding noise off the identity, so an undone stretch reads as none.
  return next.elements.map((v, i) => (Math.abs(v - NO_STRETCH[i]) < 1e-12 ? NO_STRETCH[i] : v))
}

/** Size of some geometry under a matrix, along the bed's axes. */
export function extent(geometry, matrix) {
  const box = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position')).applyMatrix4(matrix)
  const size = box.getSize(new THREE.Vector3())
  return [size.x, size.y, size.z]
}
