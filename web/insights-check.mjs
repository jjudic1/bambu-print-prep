/**
 * The usage endpoint, checked by running it.
 *
 * `api/insights.js` holds a Vercel token and reports where the traffic comes
 * from, so the checks that matter are not about shapes of JSON:
 *
 * - **Shut unless switched on.** No INSIGHTS_KEY and it must refuse, including
 *   a request sending no key at all -- the one an accidental deploy gets hit
 *   with first.
 * - **Partly working is a real answer.** Seven queries go upstream and any one
 *   can be refused on its own. If a single failure took the whole call down,
 *   the dashboard would show an error on the day one dimension changed name.
 *
 * Nothing here reaches Vercel and nothing here needs a token: `fetch` is
 * replaced for the duration. Lives in web/ rather than beside the function
 * because anything in api/ is something Vercel would try to deploy.
 *
 *   node web/insights-check.mjs
 */

import handler from '../api/insights.js'

// --- standing in for Vercel --------------------------------------------------

const realFetch = globalThis.fetch

/** Answer each upstream query by name; a number means fail with that status. */
function serve(answers) {
  globalThis.fetch = async (url) => {
    const at = new URL(url)
    const dataset = at.pathname.includes('/events/') ? 'events' : 'visits'
    const shape = at.pathname.endsWith('/count') ? 'count' : 'aggregate'
    const by = at.searchParams.getAll('by')
    const name = shape === 'count' ? 'totals'
      : ({ day: 'daily', requestPath: 'pages', referrerHostname: 'referrers',
           utmSource: 'utmSource', utmCampaign: 'utmCampaign',
           eventName: dataset === 'events' ? 'events' : '?' }[by[0]] || '?')

    globalThis.__urls.push(at.toString())
    const answer = answers[name]
    if (typeof answer === 'number') {
      return { ok: false, status: answer, json: async () => ({ error: { message: 'nope' } }) }
    }
    if (answer instanceof Error) throw answer
    return { ok: true, status: 200, json: async () => answer }
  }
}

/** A Vercel request/response pair, enough of one to call the handler with. */
async function call({ key, days, env = {}, answers = {} }) {
  const before = { ...process.env }
  for (const [name, value] of Object.entries(env)) {
    if (value === null) delete process.env[name]
    else process.env[name] = value
  }
  globalThis.__urls = []
  serve(answers)

  const sent = {}
  const response = {
    status(code) { sent.code = code; return response },
    json(body) { sent.body = body; return response },
    setHeader(name, value) { sent[name] = value },
  }
  await handler(
    { headers: key === undefined ? {} : { 'x-insights-key': key },
      query: days === undefined ? {} : { days: String(days) } },
    response)

  globalThis.fetch = realFetch
  process.env = before
  return { ...sent, urls: globalThis.__urls }
}

const CREDENTIALS = {
  INSIGHTS_KEY: 'let-me-in',
  VERCEL_TOKEN: 'tok',
  VERCEL_PROJECT_ID: 'prj_test',
  VERCEL_TEAM_ID: 'team_test',
}
const rows = (key, ...pairs) => ({
  data: pairs.map(([label, n]) => ({ [key]: label, count: n, visitors: n })),
})
const ALL = {
  totals: { data: { visitors: 40, pageviews: 91 } },
  daily: rows('day', ['2026-08-27', 10]),
  pages: rows('requestPath', ['/', 30]),
  referrers: rows('referrerHostname', ['reddit.com', 22], ['google.com', 8]),
  utmSource: rows('utmSource', ['reddit', 22]),
  utmCampaign: rows('utmCampaign', ['launch', 22]),
  events: rows('eventName', ['model opened', 12], ['file made', 5]),
}

// --- the harness -------------------------------------------------------------

const results = []
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok, got, want })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${ok ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

console.log('\n--- shut unless switched on -------------------------------------')
{
  const off = { ...CREDENTIALS, INSIGHTS_KEY: null }
  check('with no key configured it refuses',
    (await call({ key: 'anything', env: off })).code, 503)
  check('a configured key still refuses the wrong one',
    (await call({ key: 'guess', env: CREDENTIALS })).code, 401)
  check('and refuses a request that sends no key at all',
    (await call({ env: CREDENTIALS })).code, 401)
  check('and refuses an empty one',
    (await call({ key: '', env: CREDENTIALS })).code, 401)
  check('a longer wrong guess is refused too, not read past the end',
    (await call({ key: 'let-me-in-and-then-some', env: CREDENTIALS })).code, 401)

  const noToken = await call({
    key: 'let-me-in', env: { ...CREDENTIALS, VERCEL_TOKEN: null } })
  check('and it says which credential is missing',
    [noToken.code, noToken.body.detail.includes('VERCEL_TOKEN')], [503, true])
}

console.log('\n--- what it hands back ------------------------------------------')
{
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: ALL })
  check('every query is reshaped into one answer',
    [got.code, got.body.totals, got.body.unavailable],
    [200, { visitors: 40, pageviews: 91 }, {}])
  check('rows carry a label, a count and a visitor count',
    got.body.events[0], { label: 'model opened', count: 12, visitors: 12 })
  check('the answer is never cached', got['Cache-Control'], 'no-store')
}
{
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: {
    ...ALL, referrers: rows('referrerHostname',
      ['small.com', 1], ['big.com', 99], ['mid.com', 40]) } })
  check('rows come back biggest first, whatever order Vercel used',
    got.body.referrers.map((r) => r.label), ['big.com', 'mid.com', 'small.com'])
}
{
  // Direct traffic answers "is the advertising working" too, and a blank label
  // in that table reads as a bug rather than as an answer.
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: {
    ...ALL, referrers: rows('referrerHostname', ['', 12]) } })
  check('a row with no referrer is named rather than left blank',
    got.body.referrers[0].label, '(none)')
}

console.log('\n--- partly working is a real answer -----------------------------')
{
  const got = await call({
    key: 'let-me-in', env: CREDENTIALS, answers: { ...ALL, events: 400 } })
  check('one refused query does not take the others with it',
    [got.code, got.body.totals.visitors, got.body.events], [200, 40, []])
  check('and the refusal is reported on its own',
    'events' in got.body.unavailable, true)
}
{
  const got = await call({
    key: 'let-me-in', env: CREDENTIALS, answers: { ...ALL, events: 404 } })
  check('analytics being switched off says how to switch it on',
    got.body.unavailable.events.includes('Analytics'), true)
}
{
  const got = await call({
    key: 'let-me-in', env: CREDENTIALS, answers: { ...ALL, events: 403 } })
  check('a refused token is not reported as analytics being off',
    got.body.unavailable.events.includes('VERCEL_TOKEN'), true)
}
{
  const got = await call({ key: 'let-me-in', env: CREDENTIALS,
    answers: { ...ALL, events: new Error('no route to host') } })
  check('vercel being unreachable is reported rather than thrown',
    [got.code, got.body.unavailable.events.includes('reach Vercel')], [200, true])
}

console.log('\n--- what goes upstream ------------------------------------------')
{
  for (const [asked, want] of [[100000, 365], [0, 1], [-5, 1], ['nonsense', 30]]) {
    const got = await call({
      key: 'let-me-in', days: asked, env: CREDENTIALS, answers: ALL })
    check(`a window of ${asked} is clamped to ${want}`, got.body.days, want)
  }

  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: ALL })
  check('each dimension is sent as its own parameter, never comma-joined',
    [got.urls.some((u) => u.includes('by=day')),
     got.urls.some((u) => u.includes('by=day%2C') || u.includes('by=day,'))],
    [true, false])
  check('both shapes are used: a count for the totals, aggregates for the rest',
    [got.urls.filter((u) => u.includes('/count?')).length,
     got.urls.filter((u) => u.includes('/aggregate?')).length], [1, 6])
  check('the team is passed, or a personal token cannot see the project',
    got.urls.every((u) => u.includes('teamId=team_test')), true)
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
