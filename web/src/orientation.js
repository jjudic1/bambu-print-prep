import * as THREE from 'three'

// A pose is two separate things, and keeping them separate is what makes the
// controls predictable:
//
//   base  -- which face is on the plate. The solver's picks, or a quarter turn.
//   yaw   -- how far it is spun on that face. Never changes what is touching
//            the bed, so it can never make a model need supports it did not
//            need a moment ago.
//
// Composition order is the whole game. `a.multiply(b)` in three.js gives a*b,
// which applied to a point does b first and then a -- so putting yaw on the
// LEFT spins the already-placed model about the bed's own Z axis. Put it on
// the right instead and it spins about whatever axis Z used to be before the
// face came down, which looks like the model tumbling off the plate.
//
// The solver already chooses a yaw for every candidate: it aligns to the
// minimum-area footprint, because bringing a face down leaves rotation about Z
// free and an arbitrary choice left a 40x30 box sprawling across 50x49 of
// plate. So yaw 0 is not "unrotated", it is "the solver's answer", and the
// slider turns away from a sensible default rather than from nothing.

export const IDENTITY = [0, 0, 0, 1]

const zSpin = (deg) =>
  new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(deg),
  )

/** The pose actually shown and printed: spin the placed model about bed Z. */
export function compose(base, yawDeg) {
  if (!yawDeg) return base
  return zSpin(yawDeg).multiply(new THREE.Quaternion(...base)).toArray()
}

/** A quarter turn about a world axis, applied to whatever is on screen now. */
export function turn(base, axis, deg) {
  const step = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...axis), THREE.MathUtils.degToRad(deg),
  )
  return step.multiply(new THREE.Quaternion(...base)).toArray()
}

/**
 * Fold the current spin into the base pose.
 *
 * Used when the user tips the model onto a different face. The spin they had
 * set is about to stop meaning anything -- a different face is coming down --
 * but un-spinning what they can see would be a surprise. So the visual result
 * is kept and the slider returns to a zero that means something again.
 */
export const bake = (base, yawDeg) => compose(base, yawDeg)

export const sameOrientation = (a, b) =>
  a.every((v, i) => Math.abs(v - b[i]) < 1e-6)
