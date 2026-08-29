import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import { frameBed } from '../framing.js'
import { posedGeometry } from './flatten.js'
import { footprint } from './parts.js'

/**
 * One plate, with the parts that sit on it, draggable.
 *
 * Separate from the shared Viewer rather than an option inside it. The two have
 * diverged: this one draws many parts, owns selection and dragging, and shows a
 * single plate at a time, while the hosted app's viewer draws one model and
 * fetches it over HTTP. Folding both into one component would make each harder
 * to reason about than the small amount of bed-drawing they duplicate.
 *
 * Coordinates are the printer's own -- millimetres, Z up, origin at the front
 * left of the bed -- and a part's x/y is where its centre sits on that bed.
 *
 * `matrixFor` gives a part's pose. It is a function, not one shared matrix,
 * because each part can be tipped onto its own face; every part is still
 * re-centred on its own footprint and dropped to the plate afterwards, so
 * turning one part never pushes it through the bed or off the edge.
 */

const UP = new THREE.Vector3(0, 0, 1)
const BED = 0x1b1e24
const GRID = 0x2f343d
const GRID_10 = 0x262b33
const TOO_BIG = 0xc4463a
const SELECTED = 0xffffff

export default function PlateViewer({
  parts, bed, height, colour = 0x22a45d, selectedId, matrixFor,
  onSelect, onMove, onReady,
}) {
  const mount = useRef(null)
  const state = useRef({})
  const live = useRef({})
  live.current = { parts, bed, height, colour, selectedId, matrixFor, onSelect, onMove }

  // --- scene, once ----------------------------------------------------------
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
    controls.maxPolarAngle = Math.PI / 2 - 0.02

    scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1d22, 2.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(1, -1.4, 2)
    scene.add(key)

    const world = new THREE.Group()
    const models = new THREE.Group()
    scene.add(world, models)

    let frame
    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update()
      renderer.render(scene, camera)
    }
    tick()

    // A phone leaves a short, wide strip above the controls and a tablet a box
    // nearly square, so the framing is re-solved for whatever shape the element
    // has -- but only until the user moves the camera themselves. After that,
    // re-framing on a resize would undo their pinch every time iOS shows or
    // hides its address bar. Moved means the camera is no longer where the last
    // framing put it, so tapping a part to select it does not count as moving.
    const placed = new THREE.Vector3()
    let moved = false
    const reframe = () => {
      moved = false
      frameBed(camera, controls, live.current.bed, live.current.height)
      placed.copy(camera.position)
    }
    controls.addEventListener('end', () => { moved = !camera.position.equals(placed) })

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      if (!moved) reframe()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(el)
    resize()

    // --- picking and dragging ----------------------------------------------
    //
    // Dragging happens on the plate's own plane, so a part follows the finger
    // across the bed rather than towards the camera. The grab offset is kept so
    // the part does not jump its centre to the cursor on the first move, which
    // reads as the model leaping away from you.
    const ray = new THREE.Raycaster()
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const pointer = new THREE.Vector2()
    const hit = new THREE.Vector3()
    let dragging = null
    let grabbed = new THREE.Vector2()

    const toPointer = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    const onDown = (event) => {
      toPointer(event)
      ray.setFromCamera(pointer, camera)
      const found = ray.intersectObjects(models.children, true)[0]
      if (!found) return

      let node = found.object
      while (node && node.userData.partId === undefined) node = node.parent
      if (!node) return

      live.current.onSelect?.(node.userData.partId)
      if (ray.ray.intersectPlane(plane, hit)) {
        dragging = node
        grabbed.set(hit.x - node.position.x, hit.y - node.position.y)
        controls.enabled = false           // orbit and drag must not fight
        renderer.domElement.setPointerCapture(event.pointerId)
      }
    }

    const onMoveEvent = (event) => {
      if (!dragging) return
      toPointer(event)
      ray.setFromCamera(pointer, camera)
      if (!ray.ray.intersectPlane(plane, hit)) return

      const [bx, by] = live.current.bed
      // Clamped to the bed: a part dragged off the edge is not a thing anyone
      // means to do, and letting it happen produces a file that silently drops
      // the part when Bambu Studio decides it is on no plate.
      const x = Math.min(Math.max(hit.x - grabbed.x, 0), bx)
      const y = Math.min(Math.max(hit.y - grabbed.y, 0), by)
      dragging.position.set(x, y, dragging.position.z)
      live.current.onMove?.(dragging.userData.partId, x, y)
    }

    const onUp = (event) => {
      if (!dragging) return
      dragging = null
      controls.enabled = true
      try { renderer.domElement.releasePointerCapture(event.pointerId) } catch { /* already gone */ }
    }

    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointermove', onMoveEvent)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointercancel', onUp)

    state.current = { scene, camera, renderer, controls, world, models, reframe }
    onReady?.(state.current)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointermove', onMoveEvent)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointercancel', onUp)
      controls.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  // --- the bed --------------------------------------------------------------
  useEffect(() => {
    const { world } = state.current
    if (!world) return
    world.clear()
    const [bx, by] = bed

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(bx, by, 2),
      new THREE.MeshStandardMaterial({ color: BED, roughness: 0.95 }))
    plate.position.set(bx / 2, by / 2, -1)
    world.add(plate)

    for (const [step, tone] of [[10, GRID_10], [50, GRID]]) {
      const pts = []
      for (let x = 0; x <= bx + 0.001; x += step) pts.push(x, 0, 0.05, x, by, 0.05)
      for (let y = 0; y <= by + 0.001; y += step) pts.push(0, y, 0.05, bx, y, 0.05)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
      world.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: tone })))
    }

    const limit = new THREE.Box3(new THREE.Vector3(0, 0, 0),
                                 new THREE.Vector3(bx, by, height))
    const helper = new THREE.Box3Helper(limit, new THREE.Color(GRID))
    helper.material.transparent = true
    helper.material.opacity = 0.28
    world.add(helper)

    // A new printer is a new bed to look at, so the camera goes back to a view
    // of the whole of it.
    state.current.reframe()
  }, [bed[0], bed[1], height])

  // --- the parts ------------------------------------------------------------
  useEffect(() => {
    const { models } = state.current
    if (!models) return

    models.clear()
    const [bx, by] = bed
    let anyTooBig = false

    for (const part of parts) {
      // Posed and cut through the same call the writer uses, so the plate on
      // screen is the plate in the file.
      const geometry = posedGeometry(part, matrixFor(part))
      geometry.computeBoundingBox()
      const box = geometry.boundingBox
      const centre = box.getCenter(new THREE.Vector3())

      // Centre the geometry on its own origin so position means "where the part
      // is", and drop it onto the plate.
      geometry.translate(-centre.x, -centre.y, -box.min.z)

      // Measured whole, not cut. A cut can only make a part smaller, and this
      // has to answer the same question arrange() answered when it chose where
      // the part goes -- otherwise a part it sent to a plate of its own would
      // sit here in the ordinary colour, saying it fits.
      const size = part.cutMm > 0
        ? footprint(part.geometry, matrixFor(part)).box.getSize(new THREE.Vector3())
        : box.getSize(new THREE.Vector3())

      const fits = size.x <= bx && size.y <= by && size.z <= height
      if (!fits) anyTooBig = true

      // A part may carry its own colour; `colour` is the model's default.
      // Too-big still wins, because that is a warning and not a preference.
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: fits ? (part.colour ?? colour) : TOO_BIG,
        roughness: 0.55,
        metalness: 0.05,
        emissive: part.id === selectedId ? SELECTED : 0x000000,
        emissiveIntensity: part.id === selectedId ? 0.16 : 0,
      }))
      mesh.position.set(part.x, part.y, 0)
      mesh.userData.partId = part.id
      models.add(mesh)
    }

    models.userData.anyTooBig = anyTooBig
  }, [parts, matrixFor, colour, selectedId, bed[0], bed[1], height])

  return <div ref={mount} className="viewer" />
}
