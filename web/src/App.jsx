import { useCallback, useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import Viewer from './Viewer.jsx'
import { fileUrl, listPrinters, meshUrl, prepare, uploadModel } from './api.js'

const IDENTITY = [0, 0, 0, 1]

// Nudges, for when the solver is close but not right. Ninety degrees rather
// than free rotation on purpose: the useful corrections are all quarter turns,
// and a free-spin gizmo on a touchscreen is how you end up printing something
// two degrees off the plate with a support forest under it.
const NUDGES = [
  { label: 'Tip forward', axis: [1, 0, 0], deg: 90 },
  { label: 'Tip back', axis: [1, 0, 0], deg: -90 },
  { label: 'Roll left', axis: [0, 1, 0], deg: 90 },
  { label: 'Roll right', axis: [0, 1, 0], deg: -90 },
  { label: 'Spin', axis: [0, 0, 1], deg: 90 },
]

function nudge(quaternion, axis, deg) {
  const current = new THREE.Quaternion(...quaternion)
  const step = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(...axis), THREE.MathUtils.degToRad(deg),
  )
  return step.multiply(current).toArray()
}

const mm = (v) => `${Math.round(v)} mm`
const inches = (v) => `${(v / 25.4).toFixed(1)} in`

export default function App() {
  const [printers, setPrinters] = useState([])
  const [printerId, setPrinterId] = useState(
    () => localStorage.getItem('printer') || '',
  )
  const [job, setJob] = useState(null)
  const [quaternion, setQuaternion] = useState(IDENTITY)
  const [longestMm, setLongestMm] = useState(80)
  const [measured, setMeasured] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    listPrinters()
      .then(({ printers }) => {
        setPrinters(printers)
        // Asked once, then remembered -- §8 puts printer choice in setup, not
        // in the per-print flow.
        //
        // The list is ordered smallest bed first, which reads as a size ladder,
        // but the *default* must not be the A1 mini: a first-time visitor with
        // a P1S would be told their model is too big for a printer they do not
        // own, before they have been asked which one they have.
        setPrinterId((id) => {
          if (id && printers.some((p) => p.id === id)) return id
          const common = printers.find((p) => p.model === 'Bambu Lab P1S')
          return (common || printers[0])?.id || ''
        })
      })
      .catch((e) => setError(String(e.message)))
  }, [])

  useEffect(() => {
    if (printerId) localStorage.setItem('printer', printerId)
  }, [printerId])

  const printer = useMemo(
    () => printers.find((p) => p.id === printerId),
    [printers, printerId],
  )

  async function onFile(file) {
    if (!file) return
    setBusy('Looking at your model...')
    setError('')
    setResult(null)
    try {
      const uploaded = await uploadModel(file)
      setJob(uploaded)
      setQuaternion(uploaded.orientations[0]?.quaternion || IDENTITY)
      setLongestMm(Math.round(Math.max(...uploaded.native_size_mm)))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  async function onPrepare() {
    setBusy('Getting it ready...')
    setError('')
    try {
      setResult(await prepare(job.job_id, {
        printer: printerId,
        orientation: quaternion,
        longest_mm: longestMm,
      }))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  // Re-preparing invalidates what was downloaded, so drop it the moment
  // anything it was built from changes.
  const onMeasure = useCallback((m) => setMeasured(m), [])
  useEffect(() => { setResult(null) }, [quaternion, longestMm, printerId])

  const ceiling = Math.min(
    Math.round(measured?.maxLongest || 300),
    printer ? Math.max(printer.bed_mm[0], printer.bed_mm[1]) : 300,
  )

  if (!job) {
    return (
      <main className="landing">
        <h1>Get it printed</h1>
        <p className="lede">
          Bring a model. We&rsquo;ll work out which way up it goes and how big it
          should be, and hand you a file your printer understands.
        </p>
        <label className="drop">
          <input
            type="file"
            accept=".stl,.obj,.3mf,.glb,.ply"
            onChange={(e) => onFile(e.target.files[0])}
          />
          <span>{busy || 'Choose a model'}</span>
        </label>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  return (
    <main className="app">
      <Viewer
        glbUrl={meshUrl(job.job_id)}
        quaternion={quaternion}
        longestMm={longestMm}
        bed={printer?.bed_mm || [256, 256]}
        height={printer?.height_mm || 250}
        onMeasure={onMeasure}
      />

      <section className="panel">
        <header className="row">
          <strong>{job.name}</strong>
          <button className="link" onClick={() => { setJob(null); setResult(null) }}>
            Start over
          </button>
        </header>

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

        <div className="field">
          <span>
            How big
            <em>
              {measured
                ? ` ${mm(measured.size[0])} x ${mm(measured.size[1])} x ${mm(measured.size[2])} (${inches(Math.max(...measured.size))})`
                : ''}
            </em>
          </span>
          <input
            type="range"
            min="10"
            max={ceiling}
            value={Math.min(longestMm, ceiling)}
            onChange={(e) => setLongestMm(Number(e.target.value))}
          />
          <div className="ticks">
            {[
              ['Keychain', 35],
              ['Desk size', 100],
              ['Biggest that fits', ceiling],
            ].map(([label, value]) => (
              <button
                key={label}
                className={Math.abs(longestMm - value) < 2 ? 'tick on' : 'tick'}
                onClick={() => setLongestMm(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Which way up</span>
          <div className="options">
            {job.orientations.map((o, i) => (
              <button
                key={i}
                className={
                  o.quaternion.every((v, k) => Math.abs(v - quaternion[k]) < 1e-6)
                    ? 'option on'
                    : 'option'
                }
                onClick={() => setQuaternion(o.quaternion)}
                title={o.reason}
              >
                {i === 0 ? 'Our pick' : `Option ${i + 1}`}
                <em>{Math.round(o.height_mm)} mm tall</em>
              </button>
            ))}
          </div>
          <p className="reason">
            {job.orientations.find((o) =>
              o.quaternion.every((v, k) => Math.abs(v - quaternion[k]) < 1e-6),
            )?.reason || 'Turned by hand.'}
          </p>
          <div className="nudges">
            {NUDGES.map((n) => (
              <button
                key={n.label}
                onClick={() => setQuaternion(nudge(quaternion, n.axis, n.deg))}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>

        {measured && !measured.fits && (
          <p className="warn">
            This is bigger than your printer&rsquo;s bed. Make it smaller, or pick
            a printer with more room.
          </p>
        )}
        {error && <p className="error">{error}</p>}

        {result ? (
          <div className="done">
            <p>
              Ready &mdash; {result.size_mm.join(' x ')} mm, {result.comparison}.
              {result.flattened ? ` ${result.flattened}` : ''}
            </p>
            {result.files.map((f) => (
              <a key={f.name} href={fileUrl(job.job_id, f.name)} download>
                {f.kind === 'model'
                  ? 'Save the file'
                  : f.kind === 'picture'
                    ? 'Save the picture'
                    : 'How to print it'}
              </a>
            ))}
            <p className="hint">Send all three to your iPad together.</p>
          </div>
        ) : (
          <button
            className="go"
            disabled={!!busy || (measured && !measured.fits)}
            onClick={onPrepare}
          >
            {busy || 'Get it ready'}
          </button>
        )}
      </section>
    </main>
  )
}
