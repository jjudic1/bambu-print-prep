import { useCallback, useEffect, useMemo, useState } from 'react'

import { BRAND } from '../brand.js'
import { MADE, OPENED, SAVED, STEPS } from '../metrics.js'

/**
 * Is the advertising working.
 *
 * That is the only question this page exists to answer, and it is worth being
 * strict about, because a usage dashboard will happily grow into a wall of
 * numbers that nobody acts on. Everything here is either **how many arrived**,
 * **where they came from**, or **how far they got** -- and the last of those is
 * what turns the first into an answer. A thousand visits from a post that
 * produces no files is a worse result than fifty that produce twenty, and only
 * the funnel can tell those apart.
 *
 * What it cannot see, and does not pretend to: what happens after somebody taps
 * save. MakerWorld, Bambu Handy and the printer are all past the edge of the
 * browser. "Saved the file" is the last honest step, and milestone 6 -- watching
 * one person do the whole thing -- is still the only way to learn the rest.
 *
 * Nothing is drawn from more than one series, so there is no legend and no
 * categorical palette: every bar on the page is a magnitude in the one accent,
 * which the palette validator passes against this surface for lightness,
 * chroma and contrast. Colour never encodes rank here -- the funnel's stages
 * are the axis, not four different things.
 */

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
]

/** The funnel, in order, with the words a person would use for each step. */
const STEPS_SHOWN = [
  { key: null, label: 'Turned up' },
  { key: OPENED, label: 'Opened a model' },
  { key: MADE, label: 'Got a file' },
  { key: SAVED, label: 'Saved it' },
  { key: STEPS, label: 'Took the how-to page' },
]

const KEY_STORE = 'insightsKey'
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
/**
 * Name a day bucket, in the timezone it was counted in.
 *
 * Vercel buckets by UTC day and hands back the midnight that starts it. Read
 * in local time anywhere west of Greenwich, that midnight lands on the
 * previous afternoon -- so every bar on the chart was labelled with the day
 * before its own, and the busiest day of the launch was attributed to the day
 * nothing happened. `timeZone: 'UTC'` keeps the label on the bucket. The
 * locale is still the reader's; only the day boundary is fixed.
 */
const day = (iso) => new Date(iso).toLocaleDateString(undefined,
  { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * A row of a table that is also a bar chart.
 *
 * The bar is the magnitude and the number is the value; the label is text in
 * the ordinary ink rather than in the accent, so identity never rests on
 * colour. Every table on this page is one series, so there is nothing to tell
 * apart and no legend to draw.
 */
function Bars({ title, rows, empty }) {
  const most = Math.max(1, ...rows.map((r) => r.visitors || r.count))
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length ? (
        <table className="bars">
          <tbody>
            {rows.map((row) => {
              const value = row.visitors || row.count
              return (
                <tr key={row.label}>
                  <th scope="row" title={row.label}>{row.label}</th>
                  <td className="track">
                    <span className="fill" style={{ width: `${(value / most) * 100}%` }} />
                  </td>
                  <td className="value">{value}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="reason">{empty}</p>
      )}
    </section>
  )
}

/**
 * Visitors a day.
 *
 * Bars rather than a line because a day is a bucket, not a sample of something
 * continuous -- and because the interesting shape is a spike on the day
 * something was posted, which a line smooths away. Hovering reads out the day
 * rather than labelling all ninety of them.
 */
function Daily({ rows }) {
  const [over, setOver] = useState(null)
  if (!rows.length) return null
  const most = Math.max(1, ...rows.map((r) => r.visitors))
  const shown = over ?? rows[rows.length - 1]

  return (
    <section className="card">
      <h2>
        Visitors a day
        <em>{shown ? `${day(shown.label)} - ${shown.visitors}` : ''}</em>
      </h2>
      <div className="days" onMouseLeave={() => setOver(null)}>
        {rows.map((row) => (
          <button
            key={row.label}
            className={row === shown ? 'day on' : 'day'}
            style={{ '--h': `${Math.max((row.visitors / most) * 100, 1.5)}%` }}
            onMouseEnter={() => setOver(row)}
            onFocus={() => setOver(row)}
            aria-label={`${day(row.label)}: ${row.visitors} visitors`}
          />
        ))}
      </div>
      <div className="span">
        <span>{day(rows[0].label)}</span>
        <span>{day(rows[rows.length - 1].label)}</span>
      </div>
    </section>
  )
}

export default function Dashboard() {
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORE) || '')
  const [typed, setTyped] = useState('')
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!key) return
    setBusy(true); setError('')
    try {
      const answer = await fetch(`/api/insights?days=${days}`,
        { headers: { 'X-Insights-Key': key } })
      if (answer.status === 401) {
        // Wrong key: forget it rather than retrying with it forever.
        localStorage.removeItem(KEY_STORE)
        setKey('')
        throw new Error('That key was refused. Try it again.')
      }
      const body = await answer.json().catch(() => null)
      if (!answer.ok) throw new Error(body?.detail || `The API said ${answer.status}.`)
      setData(body)
    } catch (e) {
      setError(e.message)
      setData(null)
    } finally { setBusy(false) }
  }, [key, days])

  useEffect(() => { load() }, [load])

  const funnel = useMemo(() => {
    if (!data) return []
    const byName = new Map((data.events || []).map((r) => [r.label, r]))
    const arrived = data.totals?.visitors || 0
    return STEPS_SHOWN.map((step) => ({
      ...step,
      visitors: step.key ? (byName.get(step.key)?.visitors || 0) : arrived,
    }))
  }, [data])

  if (!key) {
    return (
      <main className="dash gate">
        <h1>{BRAND}</h1>
        <p className="lede">
          The usage numbers. This needs the key you set as INSIGHTS_KEY in the
          Vercel project&rsquo;s environment variables &mdash; it is kept on this
          device and sent with each request.
        </p>
        <form onSubmit={(e) => {
          e.preventDefault()
          if (!typed.trim()) return
          localStorage.setItem(KEY_STORE, typed.trim())
          setKey(typed.trim())
        }}>
          <input
            type="password" value={typed} autoComplete="off"
            placeholder="Your key" onChange={(e) => setTyped(e.target.value)}
          />
          <button className="go" type="submit">Show me</button>
        </form>
        {error && <p className="error">{error}</p>}
      </main>
    )
  }

  const arrived = data?.totals?.visitors || 0
  const made = funnel.find((s) => s.key === MADE)?.visitors || 0

  // A number that is missing and a number that is zero look identical on a
  // chart, and they mean opposite things: "nobody got that far" versus "this
  // plan will not tell you". Custom events and UTM breakdowns are paid features
  // on Vercel, so where they are refused the panel says so instead of drawing a
  // row of confident zeros.
  const eventsOff = Boolean(data?.unavailable?.events)
  // Same rule as the paid-plan panels: a total we could not read is shown as
  // missing, never as zero. This one is louder, because unlike a plan limit it
  // is a fault -- the other panels drew real numbers from the same request.
  const totalsOff = data?.unavailable?.totals || ''
  const taggingOff = Boolean(data?.unavailable?.utmSource)
  const PAID = 'Vercel keeps this behind a paid plan. The counting still '
    + 'happens, so nothing is being lost -- it would appear here if the plan '
    + 'changed.'

  return (
    <main className="dash">
      <header className="dash-head">
        <div>
          <h1>{BRAND}</h1>
          <p className="tagline">Who is turning up, and how far they get</p>
        </div>
        <div className="ticks">
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={r.days === days ? 'tick on' : 'tick'}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
          <button className="tick" onClick={load} disabled={busy}>
            {busy ? 'Reading...' : 'Refresh'}
          </button>
          <button className="tick" onClick={() => {
            localStorage.removeItem(KEY_STORE); setKey(''); setData(null)
          }}>
            Forget the key
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {data && (
        <>
          {/* Three numbers, not a chart: a single value has no shape to show,
              and a one-bar chart of it is decoration. */}
          <section className="tiles">
            <div className="tile">
              <em>Visitors</em>
              <strong>{totalsOff ? '—' : arrived}</strong>
              <span>{totalsOff ? 'could not be read' : `in the last ${data.days} days`}</span>
            </div>
            <div className="tile">
              <em>Page views</em>
              <strong>{totalsOff ? '—' : (data.totals?.pageviews || 0)}</strong>
              <span>
                {totalsOff ? 'could not be read'
                  : (arrived ? `${(((data.totals?.pageviews || 0) / arrived)).toFixed(1)} each` : '')}
              </span>
            </div>
            <div className="tile">
              <em>Left with a file</em>
              <strong>{eventsOff ? '—' : `${pct(made, arrived)}%`}</strong>
              <span>{eventsOff ? 'needs a paid plan' : `${made} of ${arrived}`}</span>
            </div>
          </section>

          {totalsOff && <p className="reason">{totalsOff}</p>}

          <Daily rows={data.daily || []} />

          {/* The funnel is the point of the page. Where the number falls off a
              cliff is the step to fix; a source that fills the top and none of
              the rest is a source that is not working, however big it looks in
              the referrer table. */}
          <section className="card">
            <h2>How far people get</h2>
            {eventsOff ? (
              <>
                <p className="reason">
                  The four steps are counted as custom events, and {PAID}
                </p>
                <p className="reason">
                  Until then, <b>{arrived} visitor{arrived === 1 ? '' : 's'}</b>
                  {' '}and the tables below are what this can honestly show.
                </p>
              </>
            ) : (
            <table className="bars funnel">
              <tbody>
                {funnel.map((step) => (
                  <tr key={step.label}>
                    <th scope="row">{step.label}</th>
                    <td className="track">
                      <span className="fill"
                            style={{ width: `${pct(step.visitors, arrived)}%` }} />
                    </td>
                    <td className="value">
                      {step.visitors}
                      <em>{step.key ? ` ${pct(step.visitors, arrived)}%` : ''}</em>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
            {!eventsOff && (
              <p className="reason">
                Counted in people, not visits, and only as far as the browser can
                see. What happens after somebody taps save &mdash; MakerWorld,
                Handy, the printer &mdash; is not in here and cannot be.
              </p>
            )}
          </section>

          {/* Two ways of asking the same question, and both are worth having.
              The referrer is where the browser says it came from, whether or
              not you had anything to do with it. The tagged ones are the links
              you posted yourself -- which is the half that answers whether the
              advertising is working, because it is the half you control. */}
          <Bars
            title="Where they came from"
            rows={data.referrers || []}
            empty="Nobody has arrived from a link yet. Anyone typing the address straight in shows as (none)."
          />
          <Bars
            title="Where you posted it"
            rows={data.utmSource || []}
            empty={taggingOff
              ? `Reading the tags off your links is a paid feature. ${PAID} Tagging links is still worth doing -- the tags are being recorded, and "Where they came from" above already tells you a good deal.`
              : 'No tagged links yet. Put ?utm_source=reddit&utm_campaign=launch on the end of a link before you post it, and it lands here.'}
          />
          {(data.utmCampaign || []).length > 0 && (
            <Bars title="Which campaign" rows={data.utmCampaign} empty="" />
          )}
          <Bars
            title="Which page"
            rows={data.pages || []}
            empty="No page views yet."
          />

          {Object.keys(data.unavailable || {}).length > 0 && (
            <section className="card">
              <h2>What could not be read</h2>
              {Object.entries(data.unavailable).map(([name, why]) => (
                <p key={name} className="reason"><b>{name}</b> &mdash; {why}</p>
              ))}
            </section>
          )}

          {arrived === 0 && !Object.keys(data.unavailable || {}).length && (
            <p className="reason">
              Nothing counted yet in this window. If the app has had visitors,
              check that Web Analytics is switched on for the project in Vercel.
            </p>
          )}
        </>
      )}
    </main>
  )
}
