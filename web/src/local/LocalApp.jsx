import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

import Viewer from '../Viewer.jsx'
import printerData from '../data/printers.json'
import { makeProject3mf, placeOnBed } from '../make3mf.js'
import { IDENTITY, turn } from '../orientation.js'
import { bakeRotation, plateImages, readModel, toArrays } from './mesh.js'

/**
 * The no-server path.
 *
 * Nothing here talks to an API. The file is parsed in the browser, placed in
 * the browser, photographed in the browser and written in the browser -- so it
 * costs nothing to run, works with the tab offline once loaded, and the model
 * never leaves the device.
 *
 * What it gives up is the judgement half: no repair, no analysis, and no
 * orientation solver, because those need real mesh libraries. You choose which
 * way up. That is the right trade for the case this exists for -- a model that
 * came out of another browser tool and only needs a container MakerWorld will
 * take.
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

export default function LocalApp() {
  const printers = printerData.printers
  const [printerId, setPrinterId] = useState(
    () => printers.find((p) => p.model === 'Bambu Lab P1S')?.id || printers[0].id,
  )
  const [material, setMaterial] = useState('PLA')
  const [geometry, setGeometry] = useState(null)
  const [name, setName] = useState('')
  const [base, setBase] = useState(IDENTITY)
  const [yawDeg, setYawDeg] = useState(0)
  const [longestMm, setLongestMm] = useState(80)
  const [colour, setColour] = useState(COLOURS[0].hex)
  const [measured, setMeasured] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [written, setWritten] = useState(null)
  const sceneRef = useRef(null)

  const printer = useMemo(
    () => printers.find((p) => p.id === printerId) || printers[0],
    [printers, printerId],
  )
  const materials = useMemo(() => Object.keys(printer.materials), [printer])

  useEffect(() => {
    if (!materials.includes(material)) setMaterial(materials[0])
  }, [materials, material])

  const onMeasure = useCallback((m) => setMeasured(m), [])
  const onReady = useCallback((s) => { sceneRef.current = s }, [])
  useEffect(() => { setWritten(null) }, [base, yawDeg, longestMm, printerId, material])

  async function onFile(file) {
    if (!file) return
    setBusy('Reading it...')
    setError('')
    setWritten(null)
    try {
      const g = await readModel(file)
      g.computeBoundingBox()
      const size = g.boundingBox.getSize(new THREE.Vector3())
      setGeometry(g)
      setName(file.name.replace(/\.[^.]+$/, ''))
      setBase(IDENTITY)
      setYawDeg(0)
      setLongestMm(Math.round(Math.max(size.x, size.y, size.z)) || 80)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  function build() {
    setBusy('Writing the file...')
    setError('')
    try {
      // Bake the pose into the geometry and scale it, exactly as the server
      // does -- rotate, ground, scale -- so the file is the same file.
      const baked = bakeRotation(geometry, base, yawDeg)
      baked.computeBoundingBox()
      const own = baked.boundingBox.getSize(new THREE.Vector3())
      const factor = longestMm / (Math.max(own.x, own.y, own.z) || 1)
      baked.applyMatrix4(new THREE.Matrix4().makeScale(factor, factor, factor))
      baked.computeBoundingBox()

      const lo = baked.boundingBox.min
      const hi = baked.boundingBox.max
      const matrix = placeOnBed([[lo.x, lo.y, lo.z], [hi.x, hi.y, hi.z]], printer)

      const { vertices, triangles } = toArrays(baked)
      const scene = sceneRef.current
      const thumbnails = scene
        ? plateImages(scene.scene, scene.camera, { colour })
        : null

      const zip = makeProject3mf({
        vertices, triangles, printer, material, matrix,
        title: `${name}.stl`, thumbnails,
      })

      const size = [hi.x - lo.x, hi.y - lo.y, hi.z - lo.z]
      setWritten({
        url: URL.createObjectURL(new Blob([zip], { type: 'model/3mf' })),
        fileName: `${name}-${Math.round(longestMm)}mm.3mf`,
        bytes: zip.length,
        size,
        fits: size[0] <= printer.bed_mm[0] && size[1] <= printer.bed_mm[1]
          && size[2] <= printer.height_mm,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  if (!geometry) {
    return (
      <main className="landing">
        <h1>EZslicer3D</h1>
        <p className="tagline">3D print&hellip; no computer necessary</p>
        <p className="lede">
          Drop in any model and get one your Bambu printer will take. This page
          does everything on your device &mdash; nothing is uploaded anywhere.
        </p>
        <label className="drop">
          <input type="file" onChange={(e) => onFile(e.target.files[0])} />
          <span>{busy || 'Choose a model'}</span>
        </label>
        <p className="hint">STL, 3MF, OBJ or PLY.</p>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  return (
    <main className="app">
      <Viewer
        geometry={geometry}
        base={base}
        yawDeg={yawDeg}
        longestMm={longestMm}
        bed={printer.bed_mm}
        height={printer.height_mm}
        colour={colour}
        onMeasure={onMeasure}
        onReady={onReady}
      />

      <section className="panel">
        <header className="row">
          <strong>{name}</strong>
          <span className="wordmark">on your device</span>
        </header>
        <div className="row">
          <button className="link" onClick={() => { setGeometry(null); setWritten(null) }}>
            Start over
          </button>
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

        <div className="field">
          <span>
            How big
            <em>
              {measured
                ? ` ${mm(measured.size[0])} x ${mm(measured.size[1])} x ${mm(measured.size[2])}`
                : ''}
            </em>
          </span>
          <input
            type="range" min="10" max="400" value={longestMm}
            onChange={(e) => setLongestMm(Number(e.target.value))}
          />
        </div>

        <div className="field">
          <span>Which way up</span>
          <div className="nudges">
            {TIPS.map((t) => (
              <button key={t.label} onClick={() => { setBase(turn(base, t.axis, t.deg)); }}>
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

        {measured && !measured.fits && (
          <p className="warn">
            Bigger than your printer&rsquo;s bed. Make it smaller.
          </p>
        )}
        {error && <p className="error">{error}</p>}

        {written ? (
          <div className="done">
            <p>
              {written.size.map((v) => Math.round(v)).join(' x ')} mm,{' '}
              {(written.bytes / 1024).toFixed(0)} KB. Written on this device.
            </p>
            <a href={written.url} download={written.fileName}>Save the file</a>
            <p className="hint">
              Upload it to MakerWorld as a private model. If it takes it, the
              whole thing works with no server.
            </p>
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
