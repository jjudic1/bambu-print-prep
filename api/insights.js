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
  { name: 'daily', dataset: 'visits', by: ['day'], limit: 100 },
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
function reason(status, body) {
  const said = body ? ` Vercel said: ${body}` : ''
  if (status === 404) {
    return 'Web Analytics is not switched on for this project. '
      + `Vercel dashboard -> the project -> Analytics -> Enable.${said}`
  }
  if (status === 401) {
    return 'Vercel did not accept INSIGHTS_TOKEN at all -- it is wrong, it has '
      + `expired, or a stray space or newline came with it when it was set.${said}`
  }
  if (status === 403) {
    return 'INSIGHTS_TOKEN is a real token but is not allowed to read this '
      + 'project. Create it again with its Scope set to the team that owns the '
      + `project, not a personal account.${said}`
  }
  return `Vercel said ${status}. ${body || ''}`.trim()
}

/**
 * Normalise an aggregate response into {label, count, visitors}.
 *
 * The dimension's key in each row is not a fixed name -- it follows what was
 * grouped by, and for a nested group like eventData/plan it is the prefix
 * rather than the whole path. So the two counts are lifted out by name and
 * whatever single key is left over is the label.
 */
function rows(payload) {
  const out = []
  for (const row of (payload && payload.data) || []) {
    if (!row || typeof row !== 'object') continue
    const label = Object.keys(row)
      .filter((key) => key !== 'count' && key !== 'visitors')
      .map((key) => row[key])[0]
    out.push({
      label: label === undefined || label === null || label === ''
        ? '(none)' : String(label),
      count: Number(row.count) || 0,
      visitors: Number(row.visitors) || 0,
    })
  }
  // Sorted here rather than in the page: the dashboard draws them in the order
  // it gets them, and sorting there would be a second place to get it wrong.
  out.sort((a, b) => b.visitors - a.visitors || b.count - a.count
    || a.label.localeCompare(b.label))
  return out
}

/** One upstream call. Resolves to [payload, null] or [null, why]. */
async function ask(query, since, until, settings) {
  const params = new URLSearchParams({
    projectId: settings.projectId, since, until,
  })
  if (settings.teamId) params.set('teamId', settings.teamId)
  if (query.by.length) {
    params.set('limit', String(query.limit || 20))
    // Appended one at a time, never comma-joined: `by` is an array upstream,
    // and a comma-joined value comes back as a single dimension named "a,b"
    // whose rows quietly stop meaning what they say.
    for (const dimension of query.by) params.append('by', dimension)
  }

  const shape = query.by.length ? 'aggregate' : 'count'
  const stop = AbortSignal.timeout(TIMEOUT)
  try {
    const answer = await fetch(`${API}/${query.dataset}/${shape}?${params}`, {
      headers: { Authorization: `Bearer ${settings.token}` },
      signal: stop,
    })
    if (!answer.ok) {
      let detail = ''
      try {
        const body = await answer.json()
        detail = (body && body.error && body.error.message) || ''
      } catch {
        // The one swallowed error here, and it is around parsing an error body
        // that has already failed. Anything thrown would replace a real
        // upstream status with a parsing complaint about it.
      }
      return [null, reason(answer.status, detail)]
    }
    return [await answer.json(), null]
  } catch (error) {
    return [null, `Could not reach Vercel: ${error.message}`]
  }
}

module.exports = async function insights(request, response) {
  const expected = process.env.INSIGHTS_KEY || ''
  if (!expected) {
    return response.status(503).json({
      detail: 'The usage numbers are switched off. Set INSIGHTS_KEY on the '
        + 'project to turn them on.',
    })
  }
  const given = request.headers['x-insights-key'] || ''
  if (!given || !sameKey(String(given), expected)) {
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
  const settings = {
    token: process.env.INSIGHTS_TOKEN,
    projectId: process.env.INSIGHTS_PROJECT_ID,
    teamId: process.env.INSIGHTS_TEAM_ID || '',
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
      result[query.name] = rows(payload)
    } else {
      // The count shape is a single object, not rows.
      const data = (payload && payload.data) || {}
      result[query.name] = {
        visitors: Number(data.visitors) || 0,
        pageviews: Number(data.pageviews) || 0,
      }
    }
  }

  // Never cached: the whole point is what happened in the last few minutes.
  response.setHeader('Cache-Control', 'no-store')
  return response.status(200).json(result)
}

// Reached by the check harness, not by Vercel.
module.exports._internals = { rows, sameKey, reason, QUERIES }
