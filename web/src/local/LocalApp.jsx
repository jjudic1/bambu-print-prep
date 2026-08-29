import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import PlateViewer from './PlateViewer.jsx'
import PlaneHero from '../PlaneHero.jsx'
import { BRAND, TAGLINE } from '../brand.js'
import Disclaimer from '../disclaimer.jsx'
import { printers, warmSettings, withSettings } from '../data/profiles.js'
import { frameBed } from '../framing.js'
import { makeProject3mf } from '../make3mf.js'
import { MADE, ON_DEVICE, OPENED, READ, SAVED, STEPS, countStep } from '../metrics.js'
import { IDENTITY, sameOrientation, turn } from '../orientation.js'
import { posedGeometry } from './flatten.js'
import { renderHandoff } from './handoff.js'
import { plateImages, readModel, spoken, toArrays } from './mesh.js'
import { arrange, footprint, splitParts } from './parts.js'
import {
  DEFAULT_NOZZLE_MM, models, nozzlesFor, pick, startingPrinter,
} from './printers.js'
import {
  DONATION_LABEL, DONATION_URL, donationsEnabled, muteReminder, reminderMuted,
} from '../support.js'

/**
 * The no-server page.
 *
 * Nothing here talks to an API: the file is parsed, arranged, photographed and
 * written in the browser, so it costs nothing to run and the model never leaves
 * the device. What it gives up is the judgement half -- no repair, no analysis,
 * no orientation solver, because those need real mesh libraries.
 *
 * A pose lives in two places, and that split is what makes the controls behave:
 *
 *   base        the model as a whole. Everything is measured in this frame, so
 *               "Across / Deep / Tall" mean the bed's own directions.
 *   spin, yaw   per part, on top of that: which face this one piece lands on,
 *               and how far it is spun once it is there.
 *
 * Size stays a property of the model rather than of each part, because "make it
 * 80 mm" said of an assembly that has been cut up means 80 mm of assembly. A
 * part tipped onto its side must not become a different size for it.
 *
 * `cutMm` joins spin and yaw as the third per-part property, and belongs with
 * them for the same reason: how much comes off the bottom only means anything
 * once you know which way the part is facing. It is measured in finished
 * millimetres off the plate, so it is applied after the pose and after the
 * size, by `flatten.js`, in the frame the part actually prints in.
 */

const TIPS = [
  { label: 'Tip forward', axis: [1, 0, 0], deg: 90 },
  { label: 'Tip back', axis: [1, 0, 0], deg: -90 },
  { label: 'Roll left', axis: [0, 1, 0], deg: 90 },
  { label: 'Roll right', axis: [0, 1, 0], deg: -90 },
]

/**
 * Where a model comes from, for somebody who has not got one yet.
 *
 * Home pages, not search or category paths: a deep link is a thing that rots
 * without anyone noticing, and every one of these sites has moved its own
 * furniture before. The same reasoning as MAKERWORLD_URL in handoff.js, and
 * for the same reason -- a 404 here is worse than a sentence naming the site
 * and letting somebody type it.
 *
 * MakerWorld first because it is the one the rest of the app ends at: it is
 * where the file has to go to reach a Bambu printer, so a model that starts
 * there is a model whose account is already set up by the time it matters.
 */
const SOURCES = [
  { name: 'MakerWorld', url: 'https://makerworld.com' },
  { name: 'Printables', url: 'https://printables.com' },
  { name: 'Thingiverse', url: 'https://thingiverse.com' },
]

const COLOURS = [
  { name: 'Green', hex: 0x22a45d }, { name: 'Grey', hex: 0xb6bcc4 },
  { name: 'Orange', hex: 0xe07b39 }, { name: 'Red', hex: 0xc4443a },
  { name: 'Blue', hex: 0x3d7fd1 }, { name: 'Black', hex: 0x2b2f36 },
]

const mm = (v) => `${Math.round(v)} mm`

// How much of the bottom comes off, in fifths of a millimetre. Snapped rather
// than trusted: a range input stepping by 0.2 hands back 0.30000000000000004
// often enough, and that value would print with a tail of digits, miss the
// cut cache on every redraw, and never compare equal to the step beside it.
const CUT_STEP = 0.2
const snap = (v) => Number(v.toFixed(1))
const snapDown = (v) => Math.floor(v / CUT_STEP) * CUT_STEP

// A whole-millimetre readout would round away most of what that slider can do
// -- on a 4 mm model every setting reads as "4 mm tall". Only the small end
// needs the decimal: above a couple of centimetres a tenth of a millimetre is
// noise, and the extra digit is just clutter.
const mmFine = (v) => `${v < 20 ? snap(v) : Math.round(v)} mm`

const short = (s) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)
const straight = (part) => sameOrientation(part.spin, IDENTITY) && !part.yaw
const resized = (part) => Math.abs((part.scale ?? 1) - 1) > 1e-6
const flattened = (part) => (part.cutMm ?? 0) > 0
const untouched = (part) => straight(part) && !resized(part) && !flattened(part)
  && part.colour == null

// Never offer to take more than this share of a part's height. Not a judgement
// about how much anyone may remove -- prep/base.py has one of those, and it is
// there because the server is guessing; here the user is looking at the plate.
// This only keeps the slider from reaching a cut that leaves nothing standing,
// which flatten.js would refuse and which would then read as a broken control.
const MOST_OF_IT = 0.9

/**
 * Base64 for a PNG that is about to be inlined into the instructions page.
 *
 * Chunked, because spreading a few hundred thousand bytes into
 * String.fromCharCode as arguments overflows the call stack -- a 512x512 render
 * is comfortably past it.
 */
function toBase64(bytes) {
  let binary = ''
  const size = 0x8000
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size))
  }
  return btoa(binary)
}

/** Hand back the blob URLs from a previous build, so they do not pile up. */
function revoke(written) {
  if (!written) return
  for (const url of [written.url, written.pictureUrl, written.pageUrl]) {
    if (url) URL.revokeObjectURL(url)
  }
}

let nextId = 1

/** A part as it starts life: on the plate, facing the way it arrived. */
const freshPart = (geometry, name, x, y) => ({
  id: nextId++, geometry, name, plate: 0, x, y, spin: IDENTITY, yaw: 0,
  scale: 1, colour: null,       // null: follows the model's colour
  cutMm: 0,                     // how much of the bottom to take off
})

export default function LocalApp() {
  // The machine is remembered; the nozzle is not, and starts at 0.4 every
  // time. See printers.js for why that asymmetry is the safe one.
  const [printerId, setPrinterId] = useState(
    () => startingPrinter(printers, localStorage.getItem('printer')).id)
  const [material, setMaterial] = useState('PLA')
  const [colour, setColour] = useState(
    () => Number(localStorage.getItem('colour')) || COLOURS[0].hex)

  // {id, geometry, name, plate, x, y, spin, yaw}
  const [parts, setParts] = useState([])
  const [plateCount, setPlateCount] = useState(1)
  const [activePlate, setActivePlate] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [beforeSplit, setBeforeSplit] = useState(null)
  const [name, setName] = useState('')

  const [base, setBase] = useState(IDENTITY)
  const [longestMm, setLongestMm] = useState(80)
  const [uniform, setUniform] = useState(true)
  const [sizeMm, setSizeMm] = useState(null)

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [written, setWritten] = useState(null)
  const [hideReminder, setHideReminder] = useState(reminderMuted)
  // Whether the how-to-print page is being read over the top of the app.
  const [steps, setSteps] = useState(false)
  const sceneRef = useRef(null)

  const printer = useMemo(
    () => printers.find((p) => p.id === printerId) || printers[0],
    [printers, printerId])
  const materials = printer.materials
  const machines = useMemo(() => models(printers), [])
  const nozzles = useMemo(() => nozzlesFor(printers, printer.model),
                          [printer.model])

  useEffect(() => { localStorage.setItem('printer', printerId) }, [printerId])
  useEffect(() => { localStorage.setItem('colour', String(colour)) }, [colour])
  useEffect(() => {
    if (!materials.includes(material)) setMaterial(materials[0])
  }, [materials, material])

  /**
   * How big the model is, unscaled, in the frame the sliders talk about.
   *
   * This is what the size controls divide by, and measuring it in the wrong
   * frame is the bug this replaces: taken before `base` was applied, asking for
   * 40 mm deep on a tipped model scaled whichever axis used to be depth, and
   * the readout then disagreed with the slider that had just set it.
   *
   * Keyed on which parts exist rather than on the parts themselves. A part's
   * geometry never changes once it has an id -- only its place on the bed does
   * -- and dragging one across the plate must not re-measure every mesh in the
   * file on every pointer move.
   */
  const shapeKey = parts.map((p) => p.id).join(',')
  const baseSize = useMemo(() => {
    if (!parts.length) return null
    const m = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion(...base))
    const box = new THREE.Box3()
    for (const part of parts) box.union(footprint(part.geometry, m).box)
    const size = box.getSize(new THREE.Vector3())
    return [size.x, size.y, size.z]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, base])

  /** One scale factor per bed axis, whichever control is driving. */
  const factors = useMemo(() => {
    if (!baseSize) return [1, 1, 1]
    if (!uniform && sizeMm) return sizeMm.map((v, i) => v / (baseSize[i] || 1))
    return Array(3).fill(longestMm / (Math.max(...baseSize) || 1))
  }, [baseSize, uniform, sizeMm, longestMm])

  /**
   * The model's own transform: face it down, then scale in that frame.
   *
   * A non-uniform scale and a rotation do not commute, so the order is not free
   * to change -- the scale has to happen in the frame whose axes the labels
   * name.
   */
  const modelMatrix = useMemo(() => {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion(...base))
    return m.premultiply(new THREE.Matrix4().makeScale(...factors))
  }, [base, factors])

  /**
   * Where one part actually ends up: the model's pose, then that part's own.
   *
   * Handed to the viewer and to the writer both, so what is drawn and what is
   * written cannot drift apart.
   */
  const matrixFor = useCallback((part) => {
    const m = modelMatrix.clone()
    // A part's own resize is deliberately uniform, which is why it can sit
    // here rather than inside the model's frame: a uniform scale commutes with
    // rotation, so it means the same thing whichever face the part is on.
    // Per-axis stretching stays a model-level control, because Across/Deep/Tall
    // are directions on the bed and a part tipped on its side has its own idea
    // of which way is across.
    if (part.scale && part.scale !== 1) {
      m.premultiply(new THREE.Matrix4().makeScale(part.scale, part.scale, part.scale))
    }
    if (!sameOrientation(part.spin, IDENTITY)) {
      m.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(
        new THREE.Quaternion(...part.spin)))
    }
    if (part.yaw) {
      m.premultiply(new THREE.Matrix4().makeRotationZ(
        THREE.MathUtils.degToRad(part.yaw)))
    }
    return m
  }, [modelMatrix])

  /**
   * A part's own size on the bed, in millimetres, in its own pose.
   *
   * The whole part, before any of its bottom comes off. Everything that has to
   * agree with `arrange` reads this -- the cut only ever makes a part smaller,
   * so measuring it uncut can reserve a little more room than needed but can
   * never claim something fits that has already been sent to a plate of its
   * own. The height a cut part actually stands is this minus its `cutMm`,
   * which is exact: the cut is a level plane through the bottom.
   */
  const sizeOfPart = useCallback((part) => {
    const box = footprint(part.geometry, matrixFor(part)).box
    const size = box.getSize(new THREE.Vector3())
    return [size.x, size.y, size.z]
  }, [matrixFor])

  /**
   * Pull back any cut that has become deeper than its part is tall.
   *
   * A cut is held in millimetres off the plate, so shrinking the model after
   * setting one can leave a part asking to lose more than it has. Clamped
   * rather than refused: flatten.js would hand back the whole part, and a
   * control that silently stops doing anything reads as broken.
   */
  useEffect(() => {
    setParts((list) => {
      let pulled = false
      const next = list.map((part) => {
        const ceiling = sizeOfPart(part)[2] * MOST_OF_IT
        if ((part.cutMm || 0) <= ceiling) return part
        pulled = true
        return { ...part, cutMm: Math.max(0, snap(snapDown(ceiling))) }
      })
      return pulled ? next : list
    })
  }, [sizeOfPart])

  useEffect(() => { setWritten(null) },
    [modelMatrix, parts, plateCount, printerId, material])

  const onPlate = useMemo(
    () => parts.filter((p) => p.plate === activePlate), [parts, activePlate])
  const selected = useMemo(
    () => parts.find((p) => p.id === selectedId) || null, [parts, selectedId])

  // Size in millimetres, along the bed's axes. The scale is axis-aligned in the
  // base frame, so this is exact rather than a re-measurement -- and with the
  // axes unlocked it hands the slider values straight back, which is the point.
  const measured = useMemo(
    () => (baseSize ? baseSize.map((v, i) => v * factors[i]) : null),
    [baseSize, factors])

  async function onFile(file) {
    if (!file) return
    setBusy('Reading it...')
    setError(''); setNote(''); setWritten(null)
    try {
      // Fetch the settings blobs now, while the user is still deciding how big
      // they want it. Ignored here on purpose: if it fails, withSettings() asks
      // again and reports it at the moment it is actually needed.
      warmSettings().catch(() => {})
      const geometry = await readModel(file)
      geometry.computeBoundingBox()
      const size = geometry.boundingBox.getSize(new THREE.Vector3())
      const [bx, by] = printer.bed_mm

      setParts([freshPart(geometry, file.name, bx / 2, by / 2)])
      setPlateCount(1); setActivePlate(0); setSelectedId(null)
      setBeforeSplit(null)
      setName(file.name.replace(/\.[^.]+$/, ''))
      setBase(IDENTITY); setUniform(true); setSizeMm(null)
      setLongestMm(Math.round(Math.max(size.x, size.y, size.z)) || 80)

      // Past the landing screen. The kind of file is worth knowing -- if the
      // people arriving are all bringing 3MFs, they already have a slicer and
      // the advertising has found the wrong crowd. The name is not sent.
      countStep(OPENED, ON_DEVICE, { kind: (file.name.match(/\.([^.]+)$/)?.[1] || '?').toLowerCase() })
    } catch (e) {
      console.error(e)
      setError(/^[A-Z][^:]*: /.test(e.message) || !/[a-z] [a-z]/.test(e.message)
        ? "We couldn't read that file. Try exporting it again as an STL."
        : e.message)
    } finally { setBusy('') }
  }

  /**
   * Lay a list of parts out, and say where they went.
   *
   * Everything that changes how many parts there are comes through here, so a
   * split never leaves a heap of pieces stacked on one spot -- which is what it
   * used to do, and which looked exactly like the split having failed.
   */
  function layOut(list, lead) {
    const { placements, plateCount: needed, tooBig } =
      arrange(list, printer, matrixFor)
    const byId = new Map(placements.map((p) => [p.id, p]))
    setParts(list.map((p) => ({ ...p, ...byId.get(p.id) })))
    setPlateCount(needed)
    setActivePlate(0)
    setSelectedId(null)

    const where = `${lead || 'Laid out'} across ${needed} plate${needed > 1 ? 's' : ''}.`
    setNote(tooBig.length
      ? `${where} ${tooBig.length} part${tooBig.length > 1 ? 's are' : ' is'} too big for the bed on its own - make it smaller, or turn it onto a different face.`
      : `${where} Tap a part to turn just that one, or drag it about.`)
  }

  function runSplit() {
    try {
      const pieces = []
      for (const part of parts) {
        const split = splitParts(part.geometry)
        if (!split) { pieces.push(part); continue }
        for (const geometry of split) pieces.push({ ...part, id: nextId++, geometry })
      }
      if (pieces.length === parts.length) {
        setNote('That model is one connected piece - there is nothing to split.')
        return
      }
      // Renumbered as a set so the labels match what is on screen. Biggest
      // first, because splitParts has already ordered them that way.
      const named = pieces.map((p, i) => ({ ...p, name: `Part ${i + 1}` }))
      setBeforeSplit(parts)
      layOut(named, `Split into ${named.length} parts, laid out`)
    } catch (e) {
      setError(e.message)
    } finally { setBusy('') }
  }

  function onSplit() {
    setError(''); setNote('')
    setBusy('Splitting it up...')
    // Union-find over a big mesh blocks the thread for a beat, so the label
    // wants a chance to paint first. A timer, not requestAnimationFrame: a tab
    // that is not compositing -- backgrounded, or the preview pane here --
    // never runs the callback at all, and the button sticks on "Splitting it
    // up..." with the whole panel disabled behind it. A timer always fires, and
    // the worst it costs is the label appearing a frame late.
    setTimeout(runSplit, 32)
  }

  function undoSplit() {
    if (!beforeSplit) return
    setParts(beforeSplit)
    setPlateCount(Math.max(1, ...beforeSplit.map((p) => p.plate + 1)))
    setActivePlate(0); setSelectedId(null); setBeforeSplit(null)
    setNote('Put back together.')
  }

  const onMove = useCallback((id, x, y) => {
    setParts((list) => list.map((p) => (p.id === id ? { ...p, x, y } : p)))
  }, [])

  function movePartToPlate(id, plate) {
    const [bx, by] = printer.bed_mm
    setParts((list) => list.map((p) => (
      p.id === id ? { ...p, plate, x: bx / 2, y: by / 2 } : p)))
    setActivePlate(plate)
  }

  // --- turning --------------------------------------------------------------
  //
  // With a part picked, these turn that part. With nothing picked they turn the
  // model, which is what a one-piece file wants and is also the only way to keep
  // the size frame meaning anything: `base` is what Across, Deep and Tall are
  // measured along, so it has to stay a property of the whole model.

  function tip(axis, deg) {
    if (selected) {
      setParts((list) => list.map((p) => (
        p.id === selected.id ? { ...p, spin: turn(p.spin, axis, deg) } : p)))
    } else {
      setBase((b) => turn(b, axis, deg))
    }
  }

  function setYaw(deg) {
    setParts((list) => list.map((p) => (
      !selected || p.id === selected.id ? { ...p, yaw: deg } : p)))
  }

  /**
   * How much of the bottom to take off -- this part, or every part.
   *
   * Every part, not the model, because each one sits on the plate on its own
   * bottom. Cutting "the model" 3 mm would mean nothing to a part standing
   * 40 mm away from the one the plane happened to pass through.
   */
  function setCut(depth) {
    const asked = snap(depth)
    setParts((list) => list.map((p) => (
      !selected || p.id === selected.id ? { ...p, cutMm: asked } : p)))
  }

  function straighten() {
    if (selected) {
      setParts((list) => list.map((p) => (
        p.id === selected.id ? { ...p, spin: IDENTITY, yaw: 0 } : p)))
      return
    }
    setBase(IDENTITY)
    setParts((list) => list.map((p) => ({ ...p, spin: IDENTITY, yaw: 0 })))
  }

  /** Paint the selected part, or the whole model when nothing is picked. */
  function paint(hex) {
    if (selected) {
      setParts((list) => list.map((p) => (
        p.id === selected.id ? { ...p, colour: hex } : p)))
      return
    }
    // Setting the model's colour clears the per-part overrides, because the
    // alternative -- a swatch that visibly does nothing to five of six parts --
    // reads as broken rather than as "those are overridden".
    setColour(hex)
    setParts((list) => list.map((p) => ({ ...p, colour: null })))
  }

  /**
   * Resize one part on its own.
   *
   * Measured against the part at scale 1 rather than against its current size,
   * so dragging the slider does not compound rounding error into a part that
   * drifts a little smaller every time it is touched.
   */
  function resizePart(part, longest) {
    const unit = Math.max(...sizeOfPart({ ...part, scale: 1 }))
    if (!(unit > 0)) return
    setParts((list) => list.map((p) => (
      p.id === part.id ? { ...p, scale: longest / unit } : p)))
  }

  const yawValue = selected
    ? selected.yaw
    : (parts.every((p) => p.yaw === parts[0]?.yaw) ? (parts[0]?.yaw ?? 0) : 0)

  const cutOf = (part) => part?.cutMm ?? 0
  const cutValue = selected
    ? cutOf(selected)
    : (parts.every((p) => cutOf(p) === cutOf(parts[0])) ? cutOf(parts[0]) : 0)

  // The shallowest part decides how far the slider goes, so one setting can be
  // applied to every part without the short one losing everything it has.
  const cutCeiling = useMemo(() => {
    const list = selected ? [selected] : parts
    if (!list.length) return 0
    const shortest = Math.min(...list.map((p) => sizeOfPart(p)[2]))
    return Math.max(CUT_STEP, snap(snapDown(shortest * MOST_OF_IT)))
  }, [selected, parts, sizeOfPart])

  // Only worth saying when one part's height is the answer. Across a mixed
  // batch each part stands at its own height, and the panel says so instead.
  const standing = selected || (parts.length === 1 ? parts[0] : null)
  const turned = selected
    ? !straight(selected)
    : !sameOrientation(base, IDENTITY) || parts.some((p) => !straight(p))
  const partColour = (part) => part.colour ?? colour

  async function build() {
    setBusy('Writing the file...')
    setError('')
    try {
      // The 487 resolved settings for this printer, this nozzle and this
      // material -- fetched rather than bundled, and warmed the moment the
      // model was dropped in, so this is almost always already in hand. Taken
      // first so the one await here is before the scene is read rather than in
      // the middle of reading it.
      const profile = await withSettings(printer)

      const scene = sceneRef.current

      // The pictures are square and the viewer is not, so they are shot with a
      // camera of their own rather than with the one on screen: taking them
      // through a camera framed for someone's phone would crop the plate to the
      // shape of their window, and the file has to be the same file whoever
      // made it.
      const lens = scene?.camera.clone()
      if (lens) {
        lens.aspect = 1
        lens.updateProjectionMatrix()
        frameBed(lens, null, printer.bed_mm, printer.height_mm)
      }

      const plates = []
      for (let index = 0; index < plateCount; index++) {
        const here = parts.filter((p) => p.plate === index)
        if (!here.length) continue          // an empty plate is refused by Bambu

        plates.push({
          objects: here.map((part) => {
            // Posed and then cut, through the same call the viewer draws with,
            // so the file and the picture cannot disagree about where the
            // bottom is.
            const geometry = posedGeometry(part, matrixFor(part))
            geometry.computeBoundingBox()
            const box = geometry.boundingBox
            const centre = box.getCenter(new THREE.Vector3())
            geometry.translate(-centre.x, -centre.y, -box.min.z)

            const { vertices, triangles } = toArrays(geometry)
            return {
              vertices, triangles, name: part.name,
              matrix: [[1, 0, 0, part.x], [0, 1, 0, part.y],
                       [0, 0, 1, 0], [0, 0, 0, 1]],
            }
          }),
          // One picture per plate. The viewer shows the active plate, so only
          // that one gets a true render; the rest reuse it rather than shipping
          // a blank, because a container missing members is untested ground.
          // Colour is not passed: the scene already carries it, per part.
          thumbnails: lens ? plateImages(scene.scene, lens) : null,
        })
      }
      if (!plates.length) throw new Error('There is nothing on any plate yet.')

      const zip = makeProject3mf({
        printer: profile, material, title: `${name}.stl`, plates,
      })

      // The size it actually is, not the slider that happens to be showing.
      // With the axes unlocked `longestMm` is whatever it was before they were
      // unlocked, and a file called 200mm holding a 400 mm model is a lie the
      // user only finds out about on the plate.
      const longest = Math.round(Math.max(...(measured || [longestMm])))
      const stem = `${name}-${longest}mm`
      const sizeText = measured
        ? `${mm(measured[0])} x ${mm(measured[1])} x ${mm(measured[2])}`
        : ''

      // Three files that only work together, the same three the hosted app
      // sends: the model, the picture of it, and the page telling you what to
      // do with them. The picture is the plate render the container already
      // carries -- MakerWorld will not accept it as the listing photo, which is
      // exactly what step 4 of the instructions warns about, but it is what
      // tells the user at a glance that they built the right thing.
      const shot = plates[0].thumbnails?.plate || null
      const page = renderHandoff({
        modelName: name,
        fileName: `${stem}.3mf`,
        printer: printer.model,
        nozzleMm: printer.nozzle_mm,
        sizeText,
        material,
        preview: shot ? toBase64(shot) : null,
      })

      revoke(written)
      setWritten({
        url: URL.createObjectURL(new Blob([zip], { type: 'model/3mf' })),
        fileName: `${stem}.3mf`,
        bytes: zip.length,
        plates: plates.length,
        objects: plates.reduce((n, p) => n + p.objects.length, 0),
        pictureUrl: shot
          ? URL.createObjectURL(new Blob([shot], { type: 'image/png' })) : null,
        pictureName: `${stem}.png`,
        pageUrl: URL.createObjectURL(new Blob([page], { type: 'text/html' })),
        pageName: `How to print ${name}.html`,
        // The same HTML the download is, kept as a string so it can be shown
        // in the app. An iPad cannot open the saved file: Files has no viewer
        // for .html, so tapping it gets an icon and an "Open in..." menu that
        // leads nowhere useful. Saving it is still worth doing -- it is what
        // survives to the printer days later -- but it can no longer be the
        // only way to read it.
        pageHtml: page,
      })

      // A file came out. Plates and parts go with it because "did they need to
      // split it" is the one thing that separates somebody with an A1 mini from
      // somebody who could have used any slicer.
      countStep(MADE, ON_DEVICE, {
        plates: plates.length,
        parts: plates.reduce((n, p) => n + p.objects.length, 0),
        flattened: parts.some(flattened),
      })
    } catch (e) {
      console.error(e)
      setError(e.message)
    } finally { setBusy('') }
  }

  function unlockAxes(next) {
    setUniform(next)
    if (!next) {
      // Hand over the size it is now, so unticking the box changes nothing on
      // its own and the sliders start where the model already is.
      setSizeMm((measured || [50, 50, 50]).map((v) => Math.max(1, Math.round(v))))
      return
    }
    if (sizeMm) setLongestMm(Math.max(1, Math.round(Math.max(...sizeMm))))
  }

  if (!parts.length) {
    return (
      <main className="landing">
        <PlaneHero />
        <h1>{BRAND}</h1>
        <p className="tagline">{TAGLINE}</p>
        <p className="lede">
          Drop in any model and get one your Bambu printer will take. Too big for
          your bed? Split it and spread it over as many plates as it needs. This
          page does everything on your device &mdash; your model is never
          uploaded, and never leaves it.
        </p>
        {/* Narrowed from "nothing is uploaded anywhere", which stopped being
            true when web/src/metrics.js was added. What is counted is visits
            and four step names; the model, its name and everything measured
            from it stay here. Saying which is which is cheap, and the old
            sentence was a claim this page can no longer make. */}
        <p className="hint">
          Visits are counted, anonymously, so we know whether anyone is finding
          this. Your model is not part of that.
        </p>
        <label className="drop">
          {/* NO `accept` HERE, and it is not an oversight. iOS offers Photo
              Library and Take Photo or Video above Choose File, neither of
              which can produce a model, and `accept` cannot take them away:
              WebKit does not implement extension specifiers at all, so
              accept=".stl,.3mf,..." resolves to nothing and the Files browser
              greys out every file on the iPad -- including the .3mf sitting
              right there. Measured on a real iPad, 2026-08-29, and it made the
              app impossible to use. MIME types do not hide the photo entries
              either, and `capture` opens the camera outright. So the menu
              stays, and mesh.js names the wrong turn when someone takes it. */}
          <input type="file" onChange={(e) => onFile(e.target.files[0])} />
          <span>{busy || 'Choose a model'}</span>
        </label>
        <p className="hint">{spoken('or')}.</p>
        {/* What used to be here was the short disclaimer. It has not been
            dropped -- the full one is still on the panel, right above the
            button that makes the file, which is the moment it is actually
            about. On the landing screen it was answering a question nobody
            has yet, in the one place where the question is "where do I even
            get one of these". So that is what the space says now. Named
            entries, because the iOS menu is the thing people get lost in:
            Choose File is the third row, under two that offer photos. */}
        <p className="hint">
          No model yet? Download one from{' '}
          {SOURCES.map((site, i) => (
            <span key={site.name}>
              {i > 0 && (i === SOURCES.length - 1 ? ' or ' : ', ')}
              <a href={site.url} target="_blank" rel="noopener noreferrer">
                {site.name}
              </a>
            </span>
          ))}
          {' '}&mdash; in Safari it lands in Files, under Downloads. Then tap
          Choose a model, pick <b>Choose File</b>, and look in there.
        </p>
        {error && <p className="error">{error}</p>}
        {donationsEnabled() && (
          <p className="support">
            Free, and no account needed.{' '}
            <a href={DONATION_URL} target="_blank" rel="noopener noreferrer">
              {DONATION_LABEL}
            </a>{' '}
            if you want to support the project.
          </p>
        )}
      </main>
    )
  }

  const ceiling = 400

  return (
    <main className="app">
      <PlateViewer
        parts={onPlate}
        bed={printer.bed_mm}
        height={printer.height_mm}
        colour={colour}
        matrixFor={matrixFor}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={onMove}
        onReady={(s) => { sceneRef.current = s }}
      />

      <section className="panel">
        <header className="row">
          <strong>{name}</strong>
          <span className="wordmark">on your device</span>
        </header>
        <div className="row">
          <button className="link" onClick={() => {
            revoke(written)
            setParts([]); setWritten(null); setBeforeSplit(null); setNote('')
          }}>
            Start over
          </button>
          <span className="hint">
            {parts.length} part{parts.length > 1 ? 's' : ''} &middot;{' '}
            {plateCount} plate{plateCount > 1 ? 's' : ''}
          </span>
        </div>

        {/* --- plates ------------------------------------------------------ */}
        <div className="field">
          <span>Plates</span>
          <div className="ticks">
            {Array.from({ length: plateCount }, (_, i) => {
              const count = parts.filter((p) => p.plate === i).length
              return (
                <button
                  key={i}
                  className={i === activePlate ? 'tick on' : 'tick'}
                  onClick={() => { setActivePlate(i); setSelectedId(null) }}
                >
                  Plate {i + 1}
                  <em>{count ? ` ${count}` : ' empty'}</em>
                </button>
              )
            })}
            <button className="tick" onClick={() => {
              setPlateCount((n) => n + 1)
              setActivePlate(plateCount)
              setSelectedId(null)
            }}>
              + Add
            </button>
          </div>
          {plateCount > 1 && !parts.some((p) => p.plate === activePlate) && (
            <p className="reason">
              This plate is empty. Bambu Studio refuses a file with an empty
              plate, so it will be left out unless you put something on it.
            </p>
          )}
        </div>

        {/* --- parts ------------------------------------------------------- */}
        <div className="field">
          <span>
            On this plate
            <em>{onPlate.length ? ' tap one to turn just that part' : ''}</em>
          </span>
          <div className="ticks">
            {parts.length > 1 && (
              <button
                className={selectedId == null ? 'tick on' : 'tick'}
                onClick={() => setSelectedId(null)}
              >
                Everything
              </button>
            )}
            {onPlate.map((part) => (
              <button
                key={part.id}
                className={part.id === selectedId ? 'tick on' : 'tick'}
                onClick={() => setSelectedId(part.id === selectedId ? null : part.id)}
                title={part.name}
              >
                <i className="dot"
                   style={{ background: `#${partColour(part).toString(16).padStart(6, '0')}` }} />
                {short(part.name)}
                <em>{untouched(part) ? '' : ' changed'}</em>
              </button>
            ))}
          </div>
          {selected && plateCount > 1 && (
            <div className="ticks">
              {Array.from({ length: plateCount }, (_, i) => (
                <button
                  key={i} className="tick"
                  disabled={selected.plate === i}
                  onClick={() => movePartToPlate(selected.id, i)}
                >
                  Send to {i + 1}
                </button>
              ))}
            </div>
          )}
          <div className="nudges">
            <button onClick={onSplit} disabled={!!busy}>
              {busy === 'Splitting it up...' ? busy : 'Split into parts'}
            </button>
            {beforeSplit && (
              <button onClick={undoSplit}>Put it back together</button>
            )}
            <button onClick={() => layOut(parts)}>Arrange</button>
          </div>
        </div>

        <label className="field">
          <span>Your printer</span>
          {/* The model and the nozzle are one choice in the data -- a 0.6 is
              its own machine profile -- so both selects set the same id, and
              each keeps the other's half where it is. */}
          <select
            value={printer.model}
            onChange={(e) => setPrinterId(
              pick(printers, e.target.value, printer.nozzle_mm).id)}
          >
            {machines.map((p) => (
              <option key={p.model} value={p.model}>
                {p.model} &mdash; bed {Math.round(p.bed_mm[0])} &times;{' '}
                {Math.round(p.bed_mm[1])} mm
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Nozzle</span>
          <select
            value={printer.nozzle_mm}
            onChange={(e) => setPrinterId(
              pick(printers, printer.model, Number(e.target.value)).id)}
          >
            {nozzles.map((n) => (
              <option key={n} value={n}>
                {n} mm{n === DEFAULT_NOZZLE_MM && ' \u2014 the one it came with'}
              </option>
            ))}
          </select>
          <div className="hint">
            The tip fitted to your printer right now. Most are 0.4 mm and have
            never been changed.
          </div>
        </label>

        <label className="field">
          <span>Material</span>
          <select value={material} onChange={(e) => setMaterial(e.target.value)}>
            {materials.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        {/* --- size -------------------------------------------------------- */}
        {selected ? (
          /* One part on its own. Uniform only -- Across/Deep/Tall are the
             bed's directions, and a part tipped onto its side has its own idea
             of which way is across, so per-axis stretching stays with the
             model. */
          <div className="field">
            <span>
              How big<em>{` ${short(selected.name)}`}</em>
            </span>
            {(() => {
              const size = sizeOfPart(selected)
              const longest = Math.max(...size)
              return (
                <>
                  <div className="hint">
                    {`${mm(size[0])} x ${mm(size[1])} x ${mm(size[2])}`}
                  </div>
                  <input
                    type="range" min="5" max={ceiling}
                    value={Math.min(Math.round(longest), ceiling)}
                    onChange={(e) => resizePart(selected, Number(e.target.value))}
                  />
                </>
              )
            })()}
            {resized(selected) && (
              <button className="link" onClick={() => setParts((list) => list.map(
                (p) => (p.id === selected.id ? { ...p, scale: 1 } : p)))}>
                Back to its share of the model
              </button>
            )}
            <p className="reason">
              This resizes just this part. To resize the whole thing, tap
              Everything above.
            </p>
          </div>
        ) : (
        <div className="field">
          <span>
            How big
            <em>
              {measured
                ? ` ${mm(measured[0])} x ${mm(measured[1])} x ${mm(measured[2])}`
                : ''}
            </em>
          </span>

          {uniform ? (
            <>
              <input
                type="range" min="10" max={ceiling} value={Math.min(longestMm, ceiling)}
                onChange={(e) => setLongestMm(Number(e.target.value))}
              />
              <div className="ticks">
                {[['Keychain', 35], ['Desk size', 100]].map(([label, value]) => (
                  <button
                    key={label}
                    className={Math.abs(longestMm - value) < 2 ? 'tick on' : 'tick'}
                    onClick={() => setLongestMm(value)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  className="tick"
                  onClick={() => {
                    setUniform(true); setSizeMm(null)
                    setLongestMm(Math.round(Math.max(...(baseSize || [80]))))
                  }}
                >
                  Original size
                </button>
              </div>
            </>
          ) : (
            <div className="axes">
              {['Across', 'Deep', 'Tall'].map((label, i) => (
                <label key={label} className="axis">
                  <span>{label}<em>{Math.round(sizeMm?.[i] ?? 0)} mm</em></span>
                  <input
                    type="range" min="1" max={ceiling}
                    value={Math.min(Math.round(sizeMm?.[i] ?? 0), ceiling)}
                    onChange={(e) => setSizeMm((v) => {
                      const next = [...(v || [0, 0, 0])]
                      next[i] = Number(e.target.value)
                      return next
                    })}
                  />
                </label>
              ))}
            </div>
          )}

          <label className="check">
            <input
              type="checkbox" checked={uniform}
              onChange={(e) => unlockAxes(e.target.checked)}
            />
            <span>Keep its shape</span>
          </label>
          {!uniform && (
            <p className="reason">
              Across, deep and tall are the bed&rsquo;s own directions, so they
              follow the model when you turn it over.
            </p>
          )}
          {parts.length > 1 && (
            <p className="reason">
              This sizes the whole model. Tap a part above to resize just that
              one.
            </p>
          )}
        </div>
        )}

        {/* --- orientation -------------------------------------------------- */}
        <div className="field">
          <span>
            Which way up
            <em>
              {selected
                ? ` ${short(selected.name)}`
                : (parts.length > 1 ? ' every part' : '')}
            </em>
          </span>
          <div className="nudges">
            {TIPS.map((t) => (
              <button key={t.label} onClick={() => tip(t.axis, t.deg)}>
                {t.label}
              </button>
            ))}
            {turned && (
              <button onClick={straighten}>
                {selected ? 'Straighten this part' : 'Straighten it up'}
              </button>
            )}
          </div>
          <p className="reason">
            No solver here &mdash; that needs the hosted version. Turn it
            yourself.{' '}
            {parts.length > 1 && (selected
              ? 'This turns one part. Tap it again, or Everything, for the lot.'
              : 'Tap a part above to lay just that one on a different face.')}
          </p>
        </div>

        {/* --- the bottom --------------------------------------------------
            Under "which way up" on purpose: the bottom is whichever face is
            pointing down, so turning the part over moves this. */}
        <div className="field">
          <span>
            Flatten the bottom
            <em>{cutValue ? ` ${snap(cutValue)} mm off` : ' nothing off'}</em>
          </span>
          <input
            type="range" min="0" max={cutCeiling} step={CUT_STEP}
            value={Math.min(cutValue, cutCeiling)}
            onChange={(e) => setCut(Number(e.target.value))}
          />
          {cutValue > 0 && standing && (
            <div className="hint">
              Stands {mmFine(sizeOfPart(standing)[2] - cutOf(standing))} tall.
            </div>
          )}
          {cutValue > 0 && (
            <button className="link" onClick={() => setCut(0)}>
              Leave the bottom alone
            </button>
          )}
          <p className="reason">
            Levels off the bottom so it sits flat on the plate instead of
            balancing on a curve or a point. Nothing above the line moves.{' '}
            {parts.length > 1 && (selected
              ? 'This trims one part.'
              : 'Every part loses the same amount, each from its own bottom.')}
          </p>
        </div>

        <div className="field">
          <span>Turn it round<em>{yawValue}&deg;</em></span>
          <input
            type="range" min="0" max="360" value={yawValue}
            onChange={(e) => setYaw(Number(e.target.value))}
          />
        </div>

        <div className="field">
          <span>
            Colour
            <em>
              {selected
                ? ` ${short(selected.name)}`
                : (parts.length > 1 ? ' every part' : '')}
            </em>
          </span>
          <div className="swatches">
            {COLOURS.map((c) => {
              const on = selected ? partColour(selected) === c.hex : colour === c.hex
              return (
                <button
                  key={c.name}
                  className={on ? 'swatch on' : 'swatch'}
                  style={{ background: `#${c.hex.toString(16).padStart(6, '0')}` }}
                  onClick={() => paint(c.hex)}
                  title={c.name}
                  aria-label={c.name}
                />
              )
            })}
          </div>
          {selected && selected.colour != null && (
            <button className="link" onClick={() => setParts((list) => list.map(
              (p) => (p.id === selected.id ? { ...p, colour: null } : p)))}>
              Use the same colour as the rest
            </button>
          )}
          <p className="reason">
            This is what the picture shows. Your printer prints in whatever
            colour you load into it &mdash; you pick that in Bambu Handy.
          </p>
        </div>

        {note && <p className="reason">{note}</p>}
        {error && <p className="error">{error}</p>}

        <Disclaimer />

        {written ? (
          <div className="done">
            <p>
              {written.objects} part{written.objects > 1 ? 's' : ''} across{' '}
              {written.plates} plate{written.plates > 1 ? 's' : ''},{' '}
              {(written.bytes / 1024).toFixed(0)} KB. Written on this device.
            </p>
            {/* Said here as well as on the slider, because the size above is
                the size the model was set to -- the bottom coming off is a
                separate thing that happened to it, and the file should not be
                the place anyone finds that out. */}
            {parts.some(flattened) && (
              <p className="hint">
                {parts.every(flattened) && parts.length > 1
                  ? 'Every part has had its bottom flattened.'
                  : `${parts.filter(flattened).length === 1 ? 'One part has' : `${parts.filter(flattened).length} parts have`} had the bottom flattened.`}
                {' '}That comes off the height above.
              </p>
            )}
            {/* Tapping save is as far as a browser can follow anyone. What
                happens after -- MakerWorld, Handy, the printer -- is invisible
                from here, and pretending otherwise would be the sort of number
                that gets believed. */}
            <a href={written.url} download={written.fileName}
               onClick={() => countStep(SAVED, ON_DEVICE)}>Save the file</a>
            {/* Reading comes first now. The steps are the part somebody
                actually has to follow, and on an iPad the saved copy of them
                could not be opened -- Files previews an .html as an icon and
                an "Open in..." menu. Same HTML either way, so there is no
                second copy of the instructions to keep in step. */}
            <button type="button" className="read"
                    onClick={() => { setSteps(true); countStep(READ, ON_DEVICE) }}>
              How to print it
            </button>
            <div className="extras">
              {written.pictureUrl && (
                <a href={written.pictureUrl} download={written.pictureName}>
                  Save the picture
                </a>
              )}
              <a href={written.pageUrl} download={written.pageName}
                 onClick={() => countStep(STEPS, ON_DEVICE)}>
                Save the steps too
              </a>
            </div>
            <p className="hint">
              Save the file into Files &mdash; that is the one the printer needs.
              The steps walk you through MakerWorld and Bambu Handy and are the
              same every time, so read them here now, or save them to have at
              the printer later.
            </p>
            {donationsEnabled() && !hideReminder && (
              <div className="support">
                <p>
                  This is free and stays free.{' '}
                  <a href={DONATION_URL} target="_blank" rel="noopener noreferrer">
                    {DONATION_LABEL}
                  </a>{' '}
                  if it was useful.
                </p>
                <label className="check">
                  <input
                    type="checkbox" checked={hideReminder}
                    onChange={(e) => {
                      setHideReminder(e.target.checked); muteReminder(e.target.checked)
                    }}
                  />
                  <span>Don&rsquo;t remind me again</span>
                </label>
              </div>
            )}
          </div>
        ) : (
          <button className="go" disabled={!!busy} onClick={build}>
            {busy || 'Make the file'}
          </button>
        )}
      </section>

      {/* The how-to-print page, read here rather than saved and opened --
          which on an iPad is not a thing that can be done at all.

          An iframe with srcdoc, not a parsed-out fragment: the page is one
          self-contained document with its own styles and the plate picture
          inlined, and putting it in a frame is what keeps this the *same*
          page as the one that gets saved rather than a second rendering of it
          that can drift. Sandboxed, because the document is generated but the
          model's name is in it; allow-popups so the MakerWorld link still
          goes somewhere, and it opens in a new tab rather than navigating the
          app out from under a half-finished file. */}
      {steps && written && (
        <div className="sheet" role="dialog" aria-label="How to print it">
          <div className="sheet-bar">
            <span>How to print it</span>
            <button type="button" onClick={() => setSteps(false)}>Done</button>
          </div>
          <div className="sheet-body">
            <iframe
              title="How to print it"
              srcDoc={written.pageHtml}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        </div>
      )}
    </main>
  )
}
