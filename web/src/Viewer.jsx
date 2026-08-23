import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// The scene works in the printer's own frame: millimetres, Z up, origin at the
// front-left corner of the bed. That is not the three.js default (Y up), and it
// is deliberate.
//
// trimesh writes GLB with an identity node transform and no Y-up conversion --
// verified by reading the glTF JSON chunk, not assumed -- so the vertices that
// arrive are already in the pipeline's coordinates. Setting the camera's up
// vector to Z means nothing has to be converted anywhere. Every conversion is a
// chance to mirror the model, and this project has already lost time to exactly
// that (prep/write3mf.py, the row-vector transform). Do not "fix" this by
// rotating the loaded scene into Y-up.
const UP = new THREE.Vector3(0, 0, 1)

const BED = 0x1b1e24
const GRID = 0x2f343d
const GRID_10 = 0x262b33
const MODEL = 0x22a45d
const TOO_BIG = 0xc4463a

export default function Viewer({ glbUrl, base, quaternion, longestMm, bed, height, onMeasure }) {
  const mount = useRef(null)
  const state = useRef({})

  // --- set the scene up once ------------------------------------------------
  useEffect(() => {
    const el = mount.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x101215)

    const camera = new THREE.PerspectiveCamera(38, 1, 1, 8000)
    camera.up.copy(UP)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    el.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // Stop the camera going under the bed -- from below, a printed object reads
    // as a hole and the plate hides it entirely.
    controls.maxPolarAngle = Math.PI / 2 - 0.02

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1d22, 2.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(1, -1.4, 2)
    scene.add(key)

    const world = new THREE.Group()          // holds the bed, rebuilt on change
    const model = new THREE.Group()          // holds the loaded mesh
    scene.add(world, model)

    let frame
    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()

    state.current = { scene, camera, renderer, controls, world, model }

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  // --- the bed, redrawn whenever the printer changes ------------------------
  useEffect(() => {
    const { world, camera, controls } = state.current
    if (!world) return

    world.clear()
    const [bx, by] = bed

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(bx, by, 2),
      new THREE.MeshStandardMaterial({ color: BED, roughness: 0.95 }),
    )
    plate.position.set(bx / 2, by / 2, -1)
    world.add(plate)

    // Two grids: 10 mm to judge small things against, 50 mm to read the bed.
    for (const [step, colour] of [[10, GRID_10], [50, GRID]]) {
      const pts = []
      for (let x = 0; x <= bx + 0.001; x += step) pts.push(x, 0, 0.05, x, by, 0.05)
      for (let y = 0; y <= by + 0.001; y += step) pts.push(0, y, 0.05, bx, y, 0.05)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      world.add(new THREE.LineSegments(
        g, new THREE.LineBasicMaterial({ color: colour }),
      ))
    }

    // The height limit, drawn as a wire box. Without it "will it fit" is only
    // about the footprint, and tall thin models fail the other way.
    const limit = new THREE.Box3(
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(bx, by, height),
    )
    const helper = new THREE.Box3Helper(limit, new THREE.Color(GRID))
    helper.material.transparent = true
    helper.material.opacity = 0.28
    world.add(helper)

    controls.target.set(bx / 2, by / 2, height * 0.18)
    camera.position.set(bx * 1.35, -by * 0.95, height * 0.95)
    controls.update()
  }, [bed[0], bed[1], height])

  // --- the model ------------------------------------------------------------
  useEffect(() => {
    const { model } = state.current
    if (!model || !glbUrl) return

    let cancelled = false
    new GLTFLoader().load(glbUrl, (gltf) => {
      if (cancelled) return
      model.clear()
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.material = new THREE.MeshStandardMaterial({
            color: MODEL, roughness: 0.55, metalness: 0.05, flatShading: false,
          })
        }
      })
      model.add(gltf.scene)
      model.userData.loaded = true
      place()
    })
    return () => { cancelled = true }
  }, [glbUrl])

  // --- orientation and size, applied live -----------------------------------
  //
  // This mirrors what the server does at prepare time: rotate, drop onto the
  // plate, centre, then scale. It cannot show the base-levelling cut, which is
  // real geometry work -- so the size reported back by /prepare is the
  // authoritative one, and this is a preview.
  function place() {
    const { model } = state.current
    if (!model?.userData.loaded) return

    const [bx, by] = bed

    // Measure the size the slider refers to against the *unspun* pose.
    //
    // Measuring the current pose instead is the obvious thing and it is wrong:
    // spinning a 40x30 box a quarter turn grows its axis-aligned box to about
    // 49x49, so holding "longest side = 40 mm" would quietly shrink the object
    // to four-fifths of what was asked for. The user turned it; they did not
    // ask for it to get smaller. The server derives the scale the same way --
    // see prepare() in api/main.py -- and the two must not drift.
    model.position.set(0, 0, 0)
    model.scale.setScalar(1)
    model.quaternion.set(...base)
    model.updateMatrixWorld(true)
    const unspun = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    const basis = Math.max(unspun.x, unspun.y, unspun.z) || 1

    // Now the pose actually shown: the spin goes on afterwards.
    model.quaternion.set(...quaternion)
    model.updateMatrixWorld(true)
    const span = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())

    const scale = longestMm ? longestMm / basis : 1
    model.scale.setScalar(scale)
    model.updateMatrixWorld(true)

    const scaled = new THREE.Box3().setFromObject(model)
    const size = scaled.getSize(new THREE.Vector3())
    const centre = scaled.getCenter(new THREE.Vector3())

    model.position.set(
      bx / 2 - centre.x,
      by / 2 - centre.y,
      -scaled.min.z,
    )

    const fits = size.x <= bx && size.y <= by && size.z <= height
    model.traverse((c) => {
      if (c.isMesh) c.material.color.setHex(fits ? MODEL : TOO_BIG)
    })

    // The parent owns the numbers; the viewer just measured them. maxLongest is
    // what the size slider clamps to, so the control cannot ask for something
    // the bed will not take (§6.2 wants the ceiling shown, not an error after).
    onMeasure?.({
      size: [size.x, size.y, size.z],
      fits,
      nativeLongest: basis,
      // In slider units, which are basis units -- so the ceiling tightens when
      // a spin widens the footprint, and loosens again when it narrows it.
      maxLongest: basis * Math.min(bx / span.x, by / span.y, height / span.z),
    })
  }

  useEffect(place, [base, quaternion, longestMm, bed[0], bed[1], height])

  return <div ref={mount} className="viewer" />
}
