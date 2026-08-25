import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import PlateViewer from './PlateViewer.jsx'
import printerData from '../data/printers.json'
import { makeProject3mf } from '../make3mf.js'
import { IDENTITY, sameOrientation, turn } from '../orientation.js'
import { renderHandoff } from './handoff.js'
import { plateImages, readModel, toArrays } from './mesh.js'
import { arrange, footprint, splitParts } from './parts.js'
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
 */

const TIPS = [
  { label: 'Tip forward', axis: [1, 0, 0], deg: 90 },
  { label: 'Tip back', axis: [1, 0, 0], deg: -90 },
  { label: 'Roll left', axis: [0, 1, 0], deg: 90 },
  { label: 'Roll right', axis: [0, 1, 0], deg: -90 },
]

const COLOURS = [
  { name: 'Green', hex: 0x22a45d }, { name: 'Grey', hex: 0xb6bcc4 },
  { name: 'Orange', hex: 0xe07b39 }, { name: 'Red', hex: 0xc4443a },
  { name: 'Blue', hex: 0x3d7fd1 }, { name: 'Black', hex: 0x2b2f36 },
]

const mm = (v) => `${Math.round(v)} mm`
const short = (s) => (s.length > 18 ? `${s.slice(0, 17)}…` : s)
const straight = (part) => sameOrientation(part.spin, IDENTITY) && !part.yaw
const resized = (part) => Math.abs((part.scale ?? 1) - 1) > 1e-6
const untouched = (part) => straight(part) && !resized(part) && part.colour == null

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
})

export default function LocalApp() {
  const printers = printerData.printers
  const [printerId, setPrinterId] = useState(
    () => localStorage.getItem('printer')
      || printers.find((p) => p.model === 'Bambu Lab P1S')?.id || printers[0].id)
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
  const sceneRef = useRef(null)

  const printer = useMemo(
    () => printers.find((p) => p.id === printerId) || printers[0],
    [printers, printerId])
  const materials = useMemo(() => Object.keys(printer.materials), [printer])

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

  /** A part's own size on the bed, in millimetres, in its own pose. */
  const sizeOfPart = useCallback((part) => {
    const box = footprint(part.geometry, matrixFor(part)).box
    const size = box.getSize(new THREE.Vector3())
    return [size.x, size.y, size.z]
  }, [matrixFor])

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
  const turned = selected
    ? !straight(selected)
    : !sameOrientation(base, IDENTITY) || parts.some((p) => !straight(p))
  const partColour = (part) => part.colour ?? colour

  function build() {
    setBusy('Writing the file...')
    setError('')
    try {
      const scene = sceneRef.current
      const plates = []
      for (let index = 0; index < plateCount; index++) {
        const here = parts.filter((p) => p.plate === index)
        if (!here.length) continue          // an empty plate is refused by Bambu

        plates.push({
          objects: here.map((part) => {
            const geometry = part.geometry.clone()
            geometry.applyMatrix4(matrixFor(part))
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
          thumbnails: scene ? plateImages(scene.scene, scene.camera) : null,
        })
      }
      if (!plates.length) throw new Error('There is nothing on any plate yet.')

      const zip = makeProject3mf({
        printer, material, title: `${name}.stl`, plates,
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
        <h1>EZslicer3D</h1>
        <p className="tagline">3D print&hellip; no computer necessary</p>
        <p className="lede">
          Drop in any model and get one your Bambu printer will take. Too big for
          your bed? Split it and spread it over as many plates as it needs. This
          page does everything on your device &mdash; nothing is uploaded anywhere.
        </p>
        <label className="drop">
          <input type="file" onChange={(e) => onFile(e.target.files[0])} />
          <span>{busy || 'Choose a model'}</span>
        </label>
        <p className="hint">STL, 3MF, OBJ or PLY.</p>
        {error && <p className="error">{error}</p>}
        {donationsEnabled() && (
          <p className="support">
            Free, and no account needed.{' '}
            <a href={DONATION_URL} target="_blank" rel="noopener noreferrer">
              {DONATION_LABEL}
            </a>{' '}
            if it saves you some faff.
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
          <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.model} &mdash; bed {Math.round(p.bed_mm[0])} &times;{' '}
                {Math.round(p.bed_mm[1])} mm
              </option>
            ))}
          </select>
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

        {written ? (
          <div className="done">
            <p>
              {written.objects} part{written.objects > 1 ? 's' : ''} across{' '}
              {written.plates} plate{written.plates > 1 ? 's' : ''},{' '}
              {(written.bytes / 1024).toFixed(0)} KB. Written on this device.
            </p>
            <a href={written.url} download={written.fileName}>Save the file</a>
            <div className="extras">
              {written.pictureUrl && (
                <a href={written.pictureUrl} download={written.pictureName}>
                  Save the picture
                </a>
              )}
              <a href={written.pageUrl} download={written.pageName}>
                Save the how-to-print page
              </a>
            </div>
            <p className="hint">
              Save all three into Files. The how-to-print page walks you through
              MakerWorld and Bambu Handy, step by step &mdash; keep it, it is the
              same steps every time.
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
    </main>
  )
}
