import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import PlateViewer from './PlateViewer.jsx'
import printerData from '../data/printers.json'
import { makeProject3mf } from '../make3mf.js'
import { IDENTITY, turn } from '../orientation.js'
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
 * Orientation and size are shared by every part, which is the right default for
 * the case this exists for: one model, split, laid across plates because the bed
 * is too small. Position and plate are per part.
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
let nextId = 1

export default function LocalApp() {
  const printers = printerData.printers
  const [printerId, setPrinterId] = useState(
    () => localStorage.getItem('printer')
      || printers.find((p) => p.model === 'Bambu Lab P1S')?.id || printers[0].id)
  const [material, setMaterial] = useState('PLA')
  const [colour, setColour] = useState(
    () => Number(localStorage.getItem('colour')) || COLOURS[0].hex)

  const [parts, setParts] = useState([])          // {id, geometry, name, plate, x, y}
  const [plateCount, setPlateCount] = useState(1)
  const [activePlate, setActivePlate] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [name, setName] = useState('')

  const [base, setBase] = useState(IDENTITY)
  const [yawDeg, setYawDeg] = useState(0)
  const [longestMm, setLongestMm] = useState(80)
  const [nativeSize, setNativeSize] = useState(null)
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
   * The rotation and scale every part shares.
   *
   * Built once and handed to the viewer and the writer, so what is drawn and
   * what is written cannot drift. Order matches the server: face down, scale in
   * that frame, then spin on the plate -- a non-uniform scale and a rotation do
   * not commute, so this is not free to reorder.
   */
  const shared = useMemo(() => {
    const m = new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion(...base))
    if (!nativeSize) return m

    const factors = !uniform && sizeMm
      ? sizeMm.map((v, i) => v / (nativeSize[i] || 1))
      : Array(3).fill(longestMm / (Math.max(...nativeSize) || 1))
    m.premultiply(new THREE.Matrix4().makeScale(...factors))
    if (yawDeg) {
      m.premultiply(new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(yawDeg)))
    }
    return m
  }, [base, yawDeg, longestMm, sizeMm, uniform, nativeSize])

  useEffect(() => { setWritten(null) }, [shared, parts, plateCount, printerId, material])

  const onPlate = useMemo(
    () => parts.filter((p) => p.plate === activePlate), [parts, activePlate])

  async function onFile(file) {
    if (!file) return
    setBusy('Reading it...')
    setError(''); setNote(''); setWritten(null)
    try {
      const geometry = await readModel(file)
      geometry.computeBoundingBox()
      const size = geometry.boundingBox.getSize(new THREE.Vector3())
      const [bx, by] = printer.bed_mm

      setParts([{
        id: nextId++, geometry, name: file.name, plate: 0, x: bx / 2, y: by / 2,
      }])
      setNativeSize([size.x, size.y, size.z])
      setPlateCount(1); setActivePlate(0); setSelectedId(null)
      setName(file.name.replace(/\.[^.]+$/, ''))
      setBase(IDENTITY); setYawDeg(0); setUniform(true); setSizeMm(null)
      setLongestMm(Math.round(Math.max(size.x, size.y, size.z)) || 80)
    } catch (e) {
      console.error(e)
      setError(/^[A-Z][^:]*: /.test(e.message) || !/[a-z] [a-z]/.test(e.message)
        ? "We couldn't read that file. Try exporting it again as an STL."
        : e.message)
    } finally { setBusy('') }
  }

  function onSplit() {
    setError(''); setNote('')
    try {
      const pieces = []
      for (const part of parts) {
        const split = splitParts(part.geometry)
        if (!split) { pieces.push(part); continue }
        for (const [i, geometry] of split.entries()) {
          pieces.push({ ...part, id: nextId++, geometry,
                        name: `${part.name} (${i + 1})` })
        }
      }
      if (pieces.length === parts.length) {
        setNote('That model is one connected piece - there is nothing to split.')
        return
      }
      setParts(pieces)
      setNote(`Split into ${pieces.length} parts. Arrange them, or drag them about.`)
    } catch (e) { setError(e.message) }
  }

  function onArrange(list = parts) {
    const { placements, plateCount: needed, tooBig } = arrange(list, printer, shared)
    const byId = new Map(placements.map((p) => [p.id, p]))
    setParts(list.map((p) => ({ ...p, ...byId.get(p.id) })))
    setPlateCount(needed)
    setActivePlate(0)
    setNote(tooBig.length
      ? `${tooBig.length} part${tooBig.length > 1 ? 's are' : ' is'} bigger than the bed on its own - make it smaller or cut it up.`
      : `Laid out across ${needed} plate${needed > 1 ? 's' : ''}.`)
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
            geometry.applyMatrix4(shared)
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
          thumbnails: scene ? plateImages(scene.scene, scene.camera, { colour }) : null,
        })
      }
      if (!plates.length) throw new Error('There is nothing on any plate yet.')

      const zip = makeProject3mf({
        printer, material, title: `${name}.stl`, plates,
      })
      setWritten({
        url: URL.createObjectURL(new Blob([zip], { type: 'model/3mf' })),
        fileName: `${name}-${Math.round(longestMm)}mm.3mf`,
        bytes: zip.length,
        plates: plates.length,
        objects: plates.reduce((n, p) => n + p.objects.length, 0),
      })
    } catch (e) {
      console.error(e)
      setError(e.message)
    } finally { setBusy('') }
  }

  // Everything the sliders need to know about the current, shared pose.
  const measured = useMemo(() => {
    if (!parts.length) return null
    const box = new THREE.Box3()
    for (const part of parts) {
      box.union(footprint(part.geometry, shared).box)
    }
    const size = box.getSize(new THREE.Vector3())
    return [size.x, size.y, size.z]
  }, [parts, shared])

  function unlockAxes(next) {
    setUniform(next)
    if (!next) {
      const scale = nativeSize ? longestMm / (Math.max(...nativeSize) || 1) : 1
      setSizeMm((nativeSize || [50, 50, 50])
        .map((v) => Math.max(1, Math.round(v * scale))))
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
        matrix={shared}
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
          <button className="link" onClick={() => { setParts([]); setWritten(null) }}>
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
                  onClick={() => setActivePlate(i)}
                >
                  Plate {i + 1}
                  <em>{count ? ` ${count}` : ' empty'}</em>
                </button>
              )
            })}
            <button className="tick" onClick={() => {
              setPlateCount((n) => n + 1); setActivePlate(plateCount)
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
            <em>{onPlate.length ? 'tap one, then drag it' : ''}</em>
          </span>
          <div className="ticks">
            {onPlate.map((part) => (
              <button
                key={part.id}
                className={part.id === selectedId ? 'tick on' : 'tick'}
                onClick={() => setSelectedId(part.id)}
                title={part.name}
              >
                {part.name.length > 18 ? `${part.name.slice(0, 17)}…` : part.name}
              </button>
            ))}
          </div>
          {selectedId != null && plateCount > 1 && (
            <div className="ticks">
              {Array.from({ length: plateCount }, (_, i) => (
                <button
                  key={i} className="tick"
                  disabled={parts.find((p) => p.id === selectedId)?.plate === i}
                  onClick={() => movePartToPlate(selectedId, i)}
                >
                  Send to {i + 1}
                </button>
              ))}
            </div>
          )}
          <div className="nudges">
            <button onClick={onSplit}>Split into parts</button>
            <button onClick={() => onArrange()}>Arrange</button>
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
                    setLongestMm(Math.round(Math.max(...(nativeSize || [80]))))
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
                    type="range" min="1" max="400"
                    value={Math.round(sizeMm?.[i] ?? 0)}
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
        </div>

        {/* --- orientation -------------------------------------------------- */}
        <div className="field">
          <span>Which way up</span>
          <div className="nudges">
            {TIPS.map((t) => (
              <button key={t.label} onClick={() => setBase(turn(base, t.axis, t.deg))}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="reason">
            No solver here &mdash; that needs the hosted version. Turn it yourself.
          </p>
        </div>

        <div className="field">
          <span>Turn it round<em>{yawDeg}&deg;</em></span>
          <input
            type="range" min="0" max="360" value={yawDeg}
            onChange={(e) => setYawDeg(Number(e.target.value))}
          />
        </div>

        <div className="field">
          <span>Colour</span>
          <div className="swatches">
            {COLOURS.map((c) => (
              <button
                key={c.name}
                className={colour === c.hex ? 'swatch on' : 'swatch'}
                style={{ background: `#${c.hex.toString(16).padStart(6, '0')}` }}
                onClick={() => setColour(c.hex)}
                title={c.name}
                aria-label={c.name}
              />
            ))}
          </div>
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
            <p className="hint">
              Upload it to MakerWorld as a private model, then print it from
              Bambu Handy.
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
