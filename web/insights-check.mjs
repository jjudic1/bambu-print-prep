/**
 * The usage endpoint, checked by running it.
 *
 * `api/insights.js` holds a Vercel token and reports where the traffic comes
 * from, so the checks that matter are not about shapes of JSON:
 *
 * - **Shut unless switched on.** No INSIGHTS_KEY and it must refuse, including
 *   a request sending no key at all -- the one an accidental deploy gets hit
 *   with first.
 * - **Partly working is a real answer.** Eight queries go upstream and any one
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
    const withTeam = at.searchParams.has('teamId')
    const dataset = at.pathname.includes('/events/') ? 'events' : 'visits'
    const shape = at.pathname.endsWith('/count') ? 'count' : 'aggregate'
    const by = at.searchParams.getAll('by')
    const name = shape === 'count' ? 'totals'
      : ({ day: 'daily', requestPath: 'pages', referrerHostname: 'referrers',
           country: 'countries',
           utmSource: 'utmSource', utmCampaign: 'utmCampaign',
           eventName: dataset === 'events' ? 'events' : '?' }[by[0]] || '?')

    globalThis.__urls.push(at.toString())
    let answer = answers[name]
    // An answer may differ by whether the team was named, which is how the
    // 403-then-retry path is checked.
    if (answer && answer.withTeam !== undefined) {
      answer = withTeam ? answer.withTeam : answer.withoutTeam
    }
    if (typeof answer === 'number') {
      return { ok: false, status: answer, json: async () => ({ error: { message: 'nope' } }) }
    }
    if (answer instanceof Error) throw answer
    return { ok: true, status: 200, json: async () => answer }
  }
}

/** A Vercel request/response pair, enough of one to call the handler with. */
async function call({ key, days, raw, env = {}, answers = {} }) {
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
  const query = {}
  if (days !== undefined) query.days = String(days)
  if (raw !== undefined) query.raw = String(raw)
  await handler(
    { headers: key === undefined ? {} : { 'x-insights-key': key }, query },
    response)

  globalThis.fetch = realFetch
  process.env = before
  return { ...sent, urls: globalThis.__urls }
}

const CREDENTIALS = {
  INSIGHTS_KEY: 'let-me-in',
  INSIGHTS_TOKEN: 'tok',
  INSIGHTS_PROJECT_ID: 'prj_test',
  INSIGHTS_TEAM_ID: 'team_test',
}
const rows = (key, ...pairs) => ({
  data: pairs.map(([label, n]) => ({ [key]: label, count: n, visitors: n })),
})
const ALL = {
  totals: { data: { visitors: 40, pageviews: 91 } },
  daily: rows('day', ['2026-08-27', 10]),
  pages: rows('requestPath', ['/', 30]),
  referrers: rows('referrerHostname', ['reddit.com', 22], ['google.com', 8]),
  countries: rows('country', ['US', 24], ['GB', 9], ['DE', 7]),
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

  // A secret set from a terminal carries whitespace it does not look like it
  // has, and then no typed key can ever match it. Both ends are trimmed, which
  // takes away no entropy anybody chose.
  check('a key stored with a stray newline still lets the right key in',
    (await call({ key: 'let-me-in',
      env: { ...CREDENTIALS, INSIGHTS_KEY: `let-me-in${String.fromCharCode(10)}` } })).code, 200)
  check('and a key typed with a stray space does too',
    (await call({ key: ' let-me-in ', env: CREDENTIALS })).code, 200)
  check('trimming does not let a genuinely wrong key through',
    (await call({ key: 'let me in', env: CREDENTIALS })).code, 401)

  const noToken = await call({
    key: 'let-me-in', env: { ...CREDENTIALS, INSIGHTS_TOKEN: null } })
  check('and it says which credential is missing',
    [noToken.code, noToken.body.detail.includes('INSIGHTS_TOKEN')], [503, true])

  // The CLI's prompts can refuse a paste outright on Windows, so piping is
  // often the only way a long secret gets in at all -- and PowerShell puts a
  // newline on the end of anything piped. Vercel refuses such a token as 403,
  // which reads exactly like a revoked one and sends people hunting through
  // tokens that were all perfectly good.
  const nl = String.fromCharCode(10)
  const piped = await call({
    key: 'let-me-in', answers: ALL,
    env: { ...CREDENTIALS,
      INSIGHTS_TOKEN: `tok${nl}`,
      INSIGHTS_PROJECT_ID: `prj_test ${nl}`,
      INSIGHTS_TEAM_ID: `team_test${nl}` },
  })
  check('credentials piped in with a trailing newline still work',
    [piped.code, 'totals' in piped.body.unavailable], [200, false])
  check('and no newline ever reaches the URL',
    piped.urls.some((u) => u.includes('%0A') || u.includes('%20')), false)
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
  // The one table where sorting by size is wrong: a day series is read left to
  // right, and ordering it by traffic silently reorders the x axis. It drew the
  // busiest day first and looked like a chart while being nonsense.
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: {
    ...ALL, daily: rows('day',
      ['2026-08-26', 1], ['2026-08-28', 99], ['2026-08-27', 40]) } })
  check('the day series stays in date order, not size order',
    got.body.daily.map((r) => r.label),
    ['2026-08-26', '2026-08-27', '2026-08-28'])
}
{
  // A plan limit is not a fault and cannot be fixed with credentials. Saying
  // "check the token" there would send somebody hunting for an hour.
  const got = await call({
    key: 'let-me-in', env: CREDENTIALS, answers: { ...ALL, events: 402 } })
  const why = got.body.unavailable.events
  check('a plan limit says so, and never blames the token',
    [why.includes('not included in the plan'), why.includes('INSIGHTS_TOKEN')],
    [true, false])
  check('and says the counting carries on regardless',
    why.includes('Counting continues'), true)
}
{
  // The reason this file exists at all now. Every fixture above uses the shape
  // Vercel documents, and the live service does not use it: on 2026-08-29 the
  // deployed dashboard showed 0 visitors and 0 page views beside a chart drawn
  // from the same request showing 42, because the hit count arrives under a
  // name the reader did not look for and an unread field became a confident
  // zero. A harness that only ever serves the documented shape cannot catch
  // that, so it now serves the others too.
  const named = async (metric) => call({ key: 'let-me-in', env: CREDENTIALS,
    answers: { ...ALL,
      pages: { data: [{ requestPath: '/', [metric]: 45, visitors: 40 }] } } })
  for (const metric of ['count', 'pageviews', 'total', 'views']) {
    const got = await named(metric)
    check(`a hit count called "${metric}" is read, not counted as none`,
      got.body.pages[0], { label: '/', count: 45, visitors: 40 })
  }
}
{
  // The label used to be "the first key that is not count or visitors", which
  // is right only while Vercel puts the dimension first. Under any other name
  // for the metric, or any other key order, the label became a number.
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: {
    ...ALL, pages: { data: [{ pageviews: 45, visitors: 40, requestPath: '/' }] } } })
  check('the label is the dimension even when the metrics come first',
    got.body.pages[0].label, '/')
}
{
  // The count endpoint shares a response schema with the aggregate one, and an
  // array where an object was expected reads as zero rather than as an error.
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: {
    ...ALL, totals: { data: [{ visitors: 40, pageviews: 91 }] } } })
  check('a total wrapped in an array is still a total',
    [got.body.totals, 'totals' in got.body.unavailable],
    [{ visitors: 40, pageviews: 91 }, false])
}
{
  // The one thing worse than a missing number is a made-up one. If nothing in
  // the answer is recognised, say so and name what did arrive -- that sentence
  // is what a person needs to fix it, and it is cheaper than another deploy.
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: {
    ...ALL, totals: { data: { hits: 91, people: 40 } } } })
  const why = got.body.unavailable.totals
  check('an unreadable total is reported, never shown as zero',
    [got.code, Boolean(why), why.includes('hits'), why.includes('people')],
    [200, true, true, true])
}
{
  // Direct traffic answers "is the advertising working" too, and a blank label
  // in that table reads as a bug rather than as an answer.
  const got = await call({ key: 'let-me-in', env: CREDENTIALS, answers: {
    ...ALL, referrers: rows('referrerHostname', ['', 12]) } })
  check('a row with no referrer is named rather than left blank',
    got.body.referrers[0].label, '(none)')
}

{
  // The escape hatch. Reshaping eight upstream answers with no way to see them
  // is what turned one wrong number into a deploy per guess, so raw mode hands
  // back what Vercel said and the URL it was asked -- behind the same key as
  // everything else, and carrying no secret, because the token is a header.
  const got = await call({ key: 'let-me-in', raw: 1, env: CREDENTIALS, answers: ALL })
  const totals = got.body.asked.find((a) => a.name === 'totals')
  check('raw mode hands back the untouched answer and the URL it was asked',
    [got.code, totals.payload, totals.url.includes('/visits/count?'),
     totals.url.includes('let-me-in') || totals.url.includes('tok')],
    [200, { data: { visitors: 40, pageviews: 91 } }, true, false])
  const shut = await call({ raw: 1, env: CREDENTIALS, answers: ALL })
  check('and is shut to a request with no key, like the rest of it',
    shut.code, 401)
}

{
  // The window, which is the whole reason the totals read zero for a day.
  // Vercel snaps `until` to a day boundary and the two endpoints snap it
  // opposite ways -- the aggregate up, the count down -- so an `until` of "now"
  // asked the count query for a window that ended where today began, and
  // excluded every visit that had arrived in it. Asking in whole days is what
  // makes the two agree, so that is what is checked: both ends on a midnight,
  // the far end after the current moment, and exactly `days` days between them.
  const got = await call({ key: 'let-me-in', days: 30, env: CREDENTIALS, answers: ALL })
  const { since, until } = got.body
  const span = (Date.parse(until) - Date.parse(since)) / 86400000
  check('the window is whole UTC days, and covers today rather than stopping at it',
    [since.endsWith('T00:00:00.000Z'), until.endsWith('T00:00:00.000Z'),
     Date.parse(until) > Date.now(), span],
    [true, true, true, 30])
  check('and every query is asked for that same window',
    got.urls.every((u) => new URL(u).searchParams.get('until') === until), true)
}

{
  // Vercel buckets the day series inclusively at both ends, so a window that
  // closes on a midnight comes back with a bucket for that midnight too --
  // tomorrow, always empty. It drew as the rightmost bar, put a future date on
  // the axis, and because the chart reads out its last bucket by default the
  // page opened by announcing that today had no visitors.
  const got = await call({ key: 'let-me-in', days: 30, env: CREDENTIALS, answers: {
    ...ALL, daily: rows('day',
      ['2026-08-01T00:00:00.000Z', 5],
      [new Date(Date.parse(new Date().toISOString().slice(0, 10)) + 86400000)
        .toISOString(), 0]) } })
  check('a bucket for the day the window closes on is not drawn as a real day',
    [got.body.daily.length, got.body.daily.every(
      (r) => Date.parse(r.label) < Date.parse(got.body.until))],
    [1, true])
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
  // 401 and 403 are different jobs -- a token to replace versus a token to
  // re-scope -- so they must not read the same. And whatever Vercel itself
  // said has to survive: swallowing it cost a round of guessing the day this
  // was first switched on.
  const bad = await call({
    key: 'let-me-in', env: CREDENTIALS, answers: { ...ALL, events: 401 } })
  const forbidden = await call({
    key: 'let-me-in', env: CREDENTIALS, answers: { ...ALL, events: 403 } })

  check('a token Vercel will not accept says so, and is not blamed on scope',
    [bad.body.unavailable.events.includes('did not accept'),
     bad.body.unavailable.events.includes('Scope')], [true, false])
  check('a refusal names the token first and does not order a team to be set',
    [forbidden.body.unavailable.events.includes('refused INSIGHTS_TOKEN'),
     /Set INSIGHTS_TEAM_ID/.test(forbidden.body.unavailable.events)],
    [true, false])

  // The actual cause the day this was switched on, and the message blamed the
  // token instead -- which sent somebody off to create a second token that was
  // never the problem. A refusal with no team named says so first.
  const noTeam = await call({
    key: 'let-me-in', env: { ...CREDENTIALS, INSIGHTS_TEAM_ID: null },
    answers: { ...ALL, events: 403 } })
  check('with no team set it says so, without claiming that is the cause',
    [noTeam.body.unavailable.events.includes('right for a personal account'),
     /Set INSIGHTS_TEAM_ID/.test(noTeam.body.unavailable.events)], [true, false])

  // Whether this account's projects want a teamId cannot be known from here: a
  // personal account still has a team_... org id, and passing it is required
  // for some accounts and refused by others. Guessing wrong looks exactly like
  // a badly scoped token, which has already cost a round of token-making.
  const retried = await call({
    key: 'let-me-in', env: CREDENTIALS,
    answers: { ...ALL, events: { withTeam: 403, withoutTeam: ALL.events } } })
  check('a team Vercel will not accept is dropped and the query retried',
    [retried.body.events.length, 'events' in retried.body.unavailable], [2, false])
  check('the retry only names the team once, on the URL that had it',
    retried.urls.filter((u) => u.includes('eventName') && u.includes('teamId')).length, 1)

  const bothWays = await call({
    key: 'let-me-in', env: CREDENTIALS,
    answers: { ...ALL, events: { withTeam: 403, withoutTeam: 403 } } })
  check('refused both ways, it says so rather than blaming only the team',
    bothWays.body.unavailable.events.includes('without the team was refused too'),
    true)

  const notRetried = await call({
    key: 'let-me-in', env: CREDENTIALS,
    answers: { ...ALL, events: { withTeam: 401, withoutTeam: ALL.events } } })
  check('a 401 is not retried -- a wrong token is wrong either way',
    notRetried.urls.filter((u) => u.includes('eventName')).length, 1)
  check('neither is reported as analytics being switched off',
    [bad, forbidden].some((r) => r.body.unavailable.events.includes('Analytics')),
    false)
  check("and Vercel's own words are passed on rather than swallowed",
    [bad, forbidden].every((r) => r.body.unavailable.events.includes('nope')), true)
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
     got.urls.filter((u) => u.includes('/aggregate?')).length], [1, 7])
  // Vercel's dimension is `country` and it answers in two-letter ISO codes.
  // The names people read are made in the page from those codes, so the codes
  // have to survive this far untouched.
  check('countries are asked for by that name, and arrive as codes',
    [got.urls.some((u) => u.includes('by=country')),
     got.body.countries.map((r) => r.label)], [true, ['US', 'GB', 'DE']])
  check('the team is passed, or a personal token cannot see the project',
    got.urls.every((u) => u.includes('teamId=team_test')), true)
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
