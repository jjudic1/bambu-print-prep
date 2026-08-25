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

export default function Viewer({ glbUrl, geometry, base, yawDeg, longestMm, sizeMm,
                                 bed, height, colour = MODEL, onMeasure, onReady }) {
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

    const world = new THREE.Group()      // the bed, rebuilt when the printer changes

    // Three nested groups, because a non-uniform scale and a rotation do not
    // commute and the server has a definite opinion about the order. It does:
    // rotate onto the chosen face, scale in *that* frame, then spin on the
    // plate. One Object3D cannot express that -- three.js composes a single
    // matrix as T * R * S, which would scale in the mesh's original frame,
    // before the face came down. Nesting gives R(yaw) * S * R(base), which is
    // the order prepare() uses.
    const model = new THREE.Group()      // placement on the bed, and the spin
    const stretch = new THREE.Group()    // the size, in the model's own frame
    const pose = new THREE.Group()       // which face is down
    stretch.add(pose)
    model.add(stretch)
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

    state.current = { scene, camera, renderer, controls, world, model, stretch, pose }

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
  // Geometry handed in directly -- the no-server path, where the browser parsed
  // the file itself and there is nothing to fetch.
  useEffect(() => {
    const { model, pose } = state.current
    if (!pose || !geometry) return

    pose.clear()
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: colour, roughness: 0.55, metalness: 0.05,
    }))
    pose.add(mesh)
    model.userData.loaded = true
    place()
    onReady?.(state.current)
  }, [geometry])

  useEffect(() => {
    const { model, pose } = state.current
    if (!pose || !glbUrl) return

    let cancelled = false
    new GLTFLoader().load(glbUrl, (gltf) => {
      if (cancelled) return
      pose.clear()
      gltf.scene.traverse((child) => {
        if (!child.isMesh) return

        // trimesh exports GLB with POSITION and nothing else -- no NORMAL
        // attribute, verified by reading the glTF JSON chunk. A lit material
        // with no normals has nothing to shade against, so every surface comes
        // out flat unlit black: the model appears as a silhouette and reads as
        // "the colour is wrong" rather than "the lighting is missing".
        //
        // Computed here rather than exported because normals would roughly
        // double the size of every download, and the browser can derive them
        // in a few milliseconds from geometry it already has.
        if (!child.geometry.getAttribute('normal')) {
          child.geometry.computeVertexNormals()
        }

        child.material = new THREE.MeshStandardMaterial({
          color: colour, roughness: 0.55, metalness: 0.05, flatShading: false,
        })
      })
      pose.add(gltf.scene)
      model.userData.loaded = true
      place()
      onReady?.(state.current)
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
    const { model, stretch, pose } = state.current
    if (!model?.userData.loaded) return

    const [bx, by] = bed

    // Same order prepare() uses: face down, measure, size, spin, sit on the bed.
    model.position.set(0, 0, 0)
    model.quaternion.identity()
    stretch.scale.setScalar(1)
    pose.quaternion.set(...base)
    model.updateMatrixWorld(true)

    // Measured with the face down but before any spin, because that is the
    // frame the sliders speak in. Spinning must not resize anything: turning a
    // 40x30 box a quarter of the way round grows its bounding box to about
    // 49x49, and sizing against that would quietly shrink the object to
    // four-fifths of what was asked for.
    const own = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3())
    const basis = Math.max(own.x, own.y, own.z) || 1

    const factors = sizeMm
      ? [sizeMm[0] / (own.x || 1), sizeMm[1] / (own.y || 1), sizeMm[2] / (own.z || 1)]
      : Array(3).fill(longestMm ? longestMm / basis : 1)

    stretch.scale.set(...factors)
    model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1),
                                      THREE.MathUtils.degToRad(yawDeg || 0))
    model.updateMatrixWorld(true)

    const box = new THREE.Box3().setFromObject(model)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    model.position.set(bx / 2 - centre.x, by / 2 - centre.y, -box.min.z)

    // Too big overrides the chosen colour, and goes back to it when it fits.
    // Warning colour has to win: a red model is telling you something, and a
    // user who picked red would otherwise never see the warning at all.
    const fits = size.x <= bx && size.y <= by && size.z <= height
    model.traverse((c) => {
      if (c.isMesh) c.material.color.setHex(fits ? colour : TOO_BIG)
    })

    // Everything the panel needs to describe and constrain the model. `own` is
    // what the axis sliders are set from and what "original size" restores;
    // maxLongest is the ceiling for the single slider, in that slider's units.
    onMeasure?.({
      size: [size.x, size.y, size.z],
      own: [own.x, own.y, own.z],
      fits,
      nativeLongest: basis,
      // How much bigger the current model could get before something hits a
      // wall, expressed in the single slider's own units.
      maxLongest: (longestMm || basis)
        * Math.min(bx / size.x, by / size.y, height / size.z),
    })
  }

  useEffect(place, [base, yawDeg, longestMm, sizeMm, bed[0], bed[1], height, colour])

  return <div ref={mount} className="viewer" />
}
