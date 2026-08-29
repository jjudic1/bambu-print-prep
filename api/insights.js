/**
 * Read the usage numbers back out of Vercel Web Analytics.
 *
 * The browser cannot ask Vercel for these itself: the Analytics API wants a
 * bearer token, which must not be in a page, and does not answer cross-origin
 * requests anyway. So something server-side has to stand in the middle. This is
 * that, and nothing else -- it holds the token, forwards a fixed set of
 * queries, and reshapes the answers. There is no store and no state; Vercel is
 * the database.
 *
 * **This was Python on Cloud Run until the compute came down.** The rest of that
 * service -- repair, analysis, the orientation solver -- is a 2 GB container
 * that exists to do mesh work, and keeping it deployed to proxy seven GETs was
 * the tail wagging the dog. Ported here it needs no server of ours at all,
 * which is the same argument that moved the writer into the browser in the
 * first place. The Python original is gone rather than kept alongside: this
 * project already maintains two writers and two handoff pages under test, and a
 * third pair with no test diffing them would drift the week nobody looked.
 *
 * It is one file with no imports on purpose. Vercel's Node runtime has global
 * fetch and there is no package.json at the repo root, so this stays CommonJS
 * and pulls in nothing -- no build step, no dependency to keep current, and
 * nothing to install for a function that runs a handful of times a week.
 *
 * Two things it deliberately does not do:
 *
 * - **It is shut unless a key is set.** No INSIGHTS_KEY in the environment and
 *   every request is refused, including one sending no key at all.
 *   Open-by-default would publish where the traffic comes from to anyone who
 *   guessed the path, and "nobody will guess it" is not an access control.
 * - **It never fails as a whole.** Seven queries go upstream and any one can be
 *   refused on its own -- a dimension Vercel does not offer for that dataset, a
 *   plan limit, a project with analytics switched off. Each is reported
 *   separately so the dashboard draws what it has, instead of showing one error
 *   where the numbers should be.
 *
 * Configuration, all from the environment (Vercel project settings):
 *
 *   INSIGHTS_KEY         the shared secret the dashboard sends. No key, no service.
 *   INSIGHTS_TOKEN       https://vercel.com/account/tokens
 *   INSIGHTS_PROJECT_ID  prj_... -- in .vercel/project.json
 *   INSIGHTS_TEAM_ID     team_... -- likewise, as orgId
 *
 * All four under one prefix of our own, and deliberately not VERCEL_*: that
 * namespace belongs to Vercel's own system variables, which it injects into
 * every deployment. Borrowing a vendor's prefix for your own secrets invites a
 * collision with something they add later, and reads as though the platform set
 * these when it did not.
 */

const API = 'https://api.vercel.com/v1/query/web-analytics'
const TIMEOUT = 20000

/**
 * The seven. Between them: how many came, when, what they landed on, where
 * from, which campaign brought them, and how far they got.
 *
 * `by` empty means a count rather than an aggregate -- a different endpoint and
 * a different response shape.
 */
const QUERIES = [
  { name: 'totals', dataset: 'visits', by: [] },
  // chronological: a day series is read left to right. Sorting it by size --
  // which is right for every other table here -- silently reorders the x axis
  // and puts the busiest day first, which looks like a chart and is not one.
  { name: 'daily', dataset: 'visits', by: ['day'], limit: 100, chronological: true },
  { name: 'pages', dataset: 'visits', by: ['requestPath'] },
  { name: 'referrers', dataset: 'visits', by: ['referrerHostname'] },
  { name: 'utmSource', dataset: 'visits', by: ['utmSource'] },
  { name: 'utmCampaign', dataset: 'visits', by: ['utmCampaign'] },
  { name: 'events', dataset: 'events', by: ['eventName'] },
]

/**
 * Compare without leaking how much of the key was right.
 *
 * Not crypto.timingSafeEqual, which throws when the two buffers differ in
 * length -- and the length of a wrong guess is exactly the thing not worth
 * telling anyone. Every byte is compared either way and the lengths are folded
 * into the same accumulator.
 */
function sameKey(given, expected) {
  let differing = given.length ^ expected.length
  for (let i = 0; i < given.length; i++) {
    differing |= given.charCodeAt(i) ^ expected.charCodeAt(i % expected.length)
  }
  return differing === 0
}

/**
 * Say what went wrong in a way that names the fix.
 *
 * 401 and 403 are told apart on purpose, because they are different jobs. A
 * 401 means the token was not accepted at all -- wrong, expired, or with a
 * stray newline from being pasted. A 403 means the token is real but is not
 * allowed to read this project, which almost always means it was created
 * against the wrong scope: a token scoped to a personal account cannot read a
 * team's project, and the scope is a dropdown that is easy to leave alone.
 *
 * Vercel's own message is appended rather than dropped. Swallowing it cost a
 * round of guessing on the day this was first switched on: seven identical
 * "check the token and its scope" lines, when the upstream body said something
 * more specific each time.
 */
function reason(status, body, sentTeam) {
  const said = body ? ` Vercel said: ${body}` : ''
  if (status === 404) {
    return 'Web Analytics is not switched on for this project. '
      + `Vercel dashboard -> the project -> Analytics -> Enable.${said}`
  }
  if (status === 402) {
    // Not a fault and not fixable by fiddling with credentials. Vercel's own
    // wording names the plan, so it is passed through nearly whole -- the only
    // thing worth adding is that nothing is broken and nothing is being lost.
    return `This is not included in the plan. ${body || ''} `.trim()
      + ' Counting continues either way, so the data is being kept and will'
      + ' appear here if the plan changes.'
  }
  if (status === 401) {
    return 'Vercel did not accept INSIGHTS_TOKEN at all -- it is wrong, it has '
      + `expired, or a stray space or newline came with it when it was set.${said}`
  }
  if (status === 403) {
    // Deliberately not confident about which of the two it is. An earlier
    // version asserted the team was missing whenever none was sent, and said so
    // in the imperative -- on an account measured to work *without* a team,
    // which sent somebody to set the one thing known to break it. A wrong
    // certainty in an error message costs more than an honest list.
    return 'Vercel refused INSIGHTS_TOKEN for this project. The likeliest cause '
      + 'is that the stored token is revoked, expired, or not the one you '
      + 'tested -- check it by asking Vercel directly with the same token '
      + 'before storing it again. '
      + (sentTeam
        ? 'INSIGHTS_TEAM_ID is set; on a personal account sending a team is '
          + 'itself refused, so try removing it.'
        : 'INSIGHTS_TEAM_ID is not set, which is right for a personal account '
          + 'but wrong if a real team owns the project.')
      + said
  }
  return `Vercel said ${status}. ${body || ''}`.trim()
}

/**
 * The names a metric can arrive under.
 *
 * Vercel's documented aggregate row is {dimension, count, visitors}, and the
 * documented count response is {pageviews, visitors}. Measured against this
 * project on 2026-08-29, the visits dataset returns neither name for the
 * larger of the two numbers: every row read as zero pageviews while the
 * visitor counts were right, and the totals panel read 0 next to a chart
 * drawn from the same request showing 42. Reading one name and trusting the
 * documentation is what made a wrong number look like a real one, so both
 * metrics are now looked up by a list of names rather than by one.
 *
 * `visitors` is a distinct-people count and `count` a hit count; they are kept
 * apart deliberately, because a synonym list that folded them together would
 * silently answer the wrong question when only one of them is present.
 */
const HITS = ['count', 'pageviews', 'total', 'views', 'events']
const PEOPLE = ['visitors', 'uniques', 'devices']
const METRICS = new Set([...HITS, ...PEOPLE])

/** The first of `names` the object carries as a number, or 0. */
function pick(row, names) {
  for (const name of names) {
    const value = row[name]
    if (typeof value === 'number' || typeof value === 'string') {
      const number = Number(value)
      if (Number.isFinite(number)) return number
    }
  }
  return 0
}

/** Does it carry any metric we know how to read? */
function legible(row) {
  return Object.keys(row).some((key) => METRICS.has(key))
}

/**
 * Normalise an aggregate response into {label, count, visitors}.
 *
 * The dimension's key in each row is not a fixed name -- it follows what was
 * grouped by, and for a nested group like eventData/plan it is the prefix
 * rather than the whole path. So the two counts are lifted out by name and
 * whatever single key is left over is the label.
 *
 * The leftover is now taken as the first key that is not *any* known metric
 * name, not just the first that is neither `count` nor `visitors`. With the
 * old test the label happened to stay right only because the dimension is
 * listed before the metrics in Vercel's JSON; one reordering upstream and
 * every row would have been labelled with a number.
 */
function rows(payload, chronological) {
  const out = []
  for (const row of (payload && payload.data) || []) {
    if (!row || typeof row !== 'object') continue
    const label = Object.keys(row)
      .filter((key) => !METRICS.has(key))
      .map((key) => row[key])[0]
    out.push({
      label: label === undefined || label === null || label === ''
        ? '(none)' : String(label),
      count: pick(row, HITS),
      visitors: pick(row, PEOPLE),
    })
  }
  // Sorted here rather than in the page: the dashboard draws them in the order
  // it gets them, and sorting there would be a second place to get it wrong.
  // A time series is the exception -- its order is its meaning.
  if (chronological) out.sort((a, b) => a.label.localeCompare(b.label))
  else {
    out.sort((a, b) => b.visitors - a.visitors || b.count - a.count
      || a.label.localeCompare(b.label))
  }
  return out
}

/**
 * Normalise a count response into {visitors, pageviews}.
 *
 * Two shapes are accepted because two were seen: the documented object, and a
 * one-element array of it -- the aggregate endpoint's shape, which the count
 * endpoint shares a response schema with. Reading `.visitors` off an array
 * gives undefined, and undefined became 0, and 0 is a number a person will
 * read as an answer.
 *
 * If it carries no name we recognise, that is reported as a failure rather
 * than counted as none. A dashboard cannot tell 0 from "not understood", and
 * this whole page exists to answer whether the advertising is working.
 */
function totals(payload) {
  let data = (payload && payload.data) || {}
  if (Array.isArray(data)) data = data[0] || {}
  if (!data || typeof data !== 'object' || !legible(data)) {
    return [null, 'Vercel answered with fields this page does not know how to '
      + `read: ${Object.keys(data || {}).join(', ') || '(nothing at all)'}. `
      + 'The other panels come from a different endpoint and are unaffected.']
  }
  return [{ visitors: pick(data, PEOPLE), pageviews: pick(data, HITS) }, null]
}

/** One attempt, with or without naming a team. */
async function attempt(query, since, until, settings, withTeam) {
  const params = new URLSearchParams({
    projectId: settings.projectId, since, until,
  })
  if (withTeam && settings.teamId) params.set('teamId', settings.teamId)
  if (query.by.length) {
    params.set('limit', String(query.limit || 20))
    // Appended one at a time, never comma-joined: `by` is an array upstream,
    // and a comma-joined value comes back as a single dimension named "a,b"
    // whose rows quietly stop meaning what they say.
    for (const dimension of query.by) params.append('by', dimension)
  }

  const shape = query.by.length ? 'aggregate' : 'count'
  const answer = await fetch(`${API}/${query.dataset}/${shape}?${params}`, {
    headers: { Authorization: `Bearer ${settings.token}` },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (answer.ok) return { ok: true, payload: await answer.json() }

  let detail = ''
  try {
    const body = await answer.json()
    detail = (body && body.error && body.error.message) || ''
  } catch {
    // The one swallowed error here, and it is around parsing an error body that
    // has already failed. Anything thrown would replace a real upstream status
    // with a parsing complaint about it.
  }
  return { ok: false, status: answer.status, detail }
}

/**
 * One upstream call. Resolves to [payload, null] or [null, why].
 *
 * **Tried both ways when a team is refused.** Measured on this account
 * (2026-08-28, hobby plan): the same token against the same project returns 200
 * with no teamId and **403 "Not authorized" with the correct one** -- the
 * team_... that Vercel itself puts in .vercel/project.json as orgId. A personal
 * account's auto-generated org is not a team the analytics API will answer for.
 *
 * There is no way to tell from here which shape an account has, and guessing
 * wrong produces a 403 that reads exactly like a badly scoped token. That
 * diagnosis cost a round of pointless token-making before it was measured, so
 * the code settles it now instead of the person.
 *
 * So a 403 with a team named is retried once without it, and the error that
 * comes back names both attempts. The retry only happens on the one status that
 * means "you may not", never on a 401 (the token is simply wrong) or a 404
 * (analytics is off) -- retrying those would just double the failures.
 */
async function ask(query, since, until, settings) {
  try {
    const named = Boolean(settings.teamId)
    let got = await attempt(query, since, until, settings, named)
    if (got.ok) return [got.payload, null]

    if (got.status === 403 && named) {
      const alone = await attempt(query, since, until, settings, false)
      if (alone.ok) return [alone.payload, null]
      return [null, reason(403, got.detail, true)
        + ` Asking without the team was refused too (${alone.status}).`]
    }
    return [null, reason(got.status, got.detail, named)]
  } catch (error) {
    return [null, `Could not reach Vercel: ${error.message}`]
  }
}

module.exports = async function insights(request, response) {
  // Trimmed at both ends, because a secret set from a terminal very easily
  // carries a newline it does not look like it has -- PowerShell appends one to
  // anything piped -- and the result is a key that can never be typed
  // correctly. Trimming cannot weaken it: whitespace at either end of a shared
  // secret is not entropy anybody chose.
  const expected = (process.env.INSIGHTS_KEY || '').trim()
  if (!expected) {
    return response.status(503).json({
      detail: 'The usage numbers are switched off. Set INSIGHTS_KEY on the '
        + 'project to turn them on.',
    })
  }
  const given = String(request.headers['x-insights-key'] || '').trim()
  if (!given || !sameKey(given, expected)) {
    return response.status(401).json({ detail: 'That key is not right.' })
  }

  const missing = ['INSIGHTS_TOKEN', 'INSIGHTS_PROJECT_ID']
    .filter((name) => !process.env[name])
  if (missing.length) {
    return response.status(503).json({
      detail: `This service has no Vercel credentials. Set ${
        missing.join(' and ')} on the project and redeploy.`,
    })
  }
  // Every one of these is trimmed, for the same reason the key is: a value set
  // from a terminal very easily carries a newline it does not look like it has.
  // PowerShell appends one to anything piped, and its prompts can refuse a
  // paste outright, so piping is often the only way a long secret gets in at
  // all. A token with a trailing newline is refused by Vercel as 403 Not
  // authorized -- indistinguishable from a revoked one, and the cause of a long
  // hunt through tokens that were all perfectly good.
  const settings = {
    token: process.env.INSIGHTS_TOKEN.trim(),
    projectId: process.env.INSIGHTS_PROJECT_ID.trim(),
    teamId: (process.env.INSIGHTS_TEAM_ID || '').trim(),
  }

  // Off a query string, so user input even though only one person has the key.
  const asked = Number.parseInt(
    (request.query && request.query.days) || '30', 10)
  const days = Math.max(1, Math.min(Number.isFinite(asked) ? asked : 30, 365))

  const now = Date.now()
  const since = new Date(now - days * 86400000).toISOString()
  const until = new Date(now).toISOString()

  const answers = await Promise.all(
    QUERIES.map(async (query) => [query, ...await ask(query, since, until, settings)]))

  const result = { days, since, until, unavailable: {} }
  for (const [query, payload, why] of answers) {
    if (why) {
      result.unavailable[query.name] = why
      result[query.name] = query.by.length ? [] : {}
      continue
    }
    if (query.by.length) {
      result[query.name] = rows(payload, query.chronological)
    } else {
      // The count shape is a single object, not rows.
      const [got, why2] = totals(payload)
      if (why2) {
        result.unavailable[query.name] = why2
        result[query.name] = { visitors: 0, pageviews: 0 }
      } else {
        result[query.name] = got
      }
    }
  }

  // Never cached: the whole point is what happened in the last few minutes.
  response.setHeader('Cache-Control', 'no-store')
  return response.status(200).json(result)
}

// Reached by the check harness, not by Vercel.
module.exports._internals = { rows, totals, pick, sameKey, reason, QUERIES }
