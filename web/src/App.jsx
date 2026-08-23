import { useCallback, useEffect, useMemo, useState } from 'react'
import Viewer from './Viewer.jsx'
import { fileUrl, listPrinters, meshUrl, prepare, uploadModel } from './api.js'
import { IDENTITY, bake, compose, sameOrientation, turn } from './orientation.js'

// Tipping onto a different face. Quarter turns rather than free rotation on
// purpose: the corrections that matter are all quarter turns, and a free-spin
// gizmo on a touchscreen is how you print two degrees off the plate with a
// support forest underneath. Turning *on* the face is the yaw slider's job,
// and that one is continuous because there the angle genuinely is a preference.
const TIPS = [
  { label: 'Tip forward', axis: [1, 0, 0], deg: 90 },
  { label: 'Tip back', axis: [1, 0, 0], deg: -90 },
  { label: 'Roll left', axis: [0, 1, 0], deg: 90 },
  { label: 'Roll right', axis: [0, 1, 0], deg: -90 },
]

const mm = (v) => `${Math.round(v)} mm`
const inches = (v) => `${(v / 25.4).toFixed(1)} in`

export default function App() {
  const [printers, setPrinters] = useState([])
  const [printerId, setPrinterId] = useState(
    () => localStorage.getItem('printer') || '',
  )
  const [job, setJob] = useState(null)
  const [base, setBase] = useState(IDENTITY)
  const [yawDeg, setYawDeg] = useState(0)
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

  // One pose, derived. The viewer and the server must never see anything else,
  // or the preview stops being what gets printed.
  const pose = useMemo(() => compose(base, yawDeg), [base, yawDeg])

  // Tipping changes which face is down, so the spin the user had set stops
  // meaning anything -- but un-spinning what they can see would be a surprise.
  // Fold it in, and give the slider back a zero that means something.
  const tip = (axis, deg) => {
    setBase(turn(bake(base, yawDeg), axis, deg))
    setYawDeg(0)
  }

  async function onFile(file) {
    if (!file) return
    setBusy('Looking at your model...')
    setError('')
    setResult(null)
    try {
      const uploaded = await uploadModel(file)
      setJob(uploaded)
      setBase(uploaded.orientations[0]?.quaternion || IDENTITY)
      setYawDeg(0)
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
      // base and spin go separately, not pre-composed: the server sizes
      // against the unspun pose so that turning the model never resizes it.
      setResult(await prepare(job.job_id, {
        printer: printerId,
        orientation: base,
        yaw_deg: yawDeg,
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
  useEffect(() => { setResult(null) }, [pose, longestMm, printerId])

  // The largest size that still fits, in the units the slider speaks. It comes
  // from the viewer, which measures the real footprint of the current pose --
  // deliberately *not* capped at the bed's side length, because a long model
  // turned across the corner legitimately exceeds it: 300 mm lies down fine on
  // a 256 mm bed at 45 degrees, and capping would forbid the one trick the spin
  // control is for.
  const ceiling = Math.round(measured?.maxLongest || 300)

  // Clamp the state, not just the slider's displayed value. §6.2 wants the
  // ceiling shown rather than an error afterwards, and leaving the state above
  // it produced exactly that error: a model drawn too big, the slider pinned at
  // max, and "Get it ready" disabled, with no visible way out. Safe from
  // feedback because the ceiling is measured at scale 1 and so does not depend
  // on the value being clamped.
  useEffect(() => {
    if (!measured) return
    setLongestMm((v) => Math.min(v, ceiling))
  }, [ceiling, measured])

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
        base={base}
        quaternion={pose}
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
                className={sameOrientation(o.quaternion, base) ? 'option on' : 'option'}
                onClick={() => { setBase(o.quaternion); setYawDeg(0) }}
                title={o.reason}
              >
                {i === 0 ? 'Our pick' : `Option ${i + 1}`}
                <em>{Math.round(o.height_mm)} mm tall</em>
              </button>
            ))}
          </div>
          <p className="reason">
            {job.orientations.find((o) => sameOrientation(o.quaternion, base))
              ?.reason || 'Turned by hand.'}
          </p>
          <div className="nudges">
            {TIPS.map((t) => (
              <button key={t.label} onClick={() => tip(t.axis, t.deg)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>
            Turn it round
            <em>{yawDeg}&deg;</em>
          </span>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={yawDeg}
            onChange={(e) => setYawDeg(Number(e.target.value))}
          />
          <div className="ticks">
            {[0, 45, 90, 180, 270].map((deg) => (
              <button
                key={deg}
                className={yawDeg === deg ? 'tick on' : 'tick'}
                onClick={() => setYawDeg(deg)}
              >
                {deg}&deg;
              </button>
            ))}
          </div>
          <p className="reason">
            Spins it on the plate. The same side stays down, so this never
            changes what it needs to hold it up &mdash; but turning a long model
            across the corner can make it fit a bed it otherwise would not.
          </p>
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
