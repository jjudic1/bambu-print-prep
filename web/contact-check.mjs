/**
 * The contact form, checked by running its server half.
 *
 * `api/contact.js` is the only thing in the app that sends anything anybody
 * typed, and it holds the credential that does the sending. Four things about
 * it are worth guarding, and none of them are about the shape of JSON:
 *
 * - **Shut unless switched on.** No RESEND_API_KEY and it must refuse. A form
 *   that accepts a message it cannot send is worse than one that says it is
 *   off: the person walks away believing they have been heard.
 * - **The subject names the product.** That is the whole ask -- a mail landing
 *   in a personal inbox has to be obviously from Handoff3D before it is opened.
 *   So the brand is checked against `web/src/brand.js`, because it is spelled
 *   out separately in the function and two constants drift.
 * - **Nothing typed reaches a header.** A newline in a name is how one subject
 *   line becomes two headers, and the second one gets to name another
 *   recipient.
 * - **The two topic lists agree.** The picker's ids and the server's are the
 *   same list written twice; an id on one side only is a message refused after
 *   it was written.
 *
 * Nothing here reaches Resend and nothing here needs a key: `fetch` is replaced
 * for the duration. Lives in web/ rather than beside the function because
 * anything in api/ is something Vercel would try to deploy.
 *
 *   node web/contact-check.mjs
 */

import handler from '../api/contact.js'

import { BRAND } from './src/brand.js'
import { LIMITS, TOPICS } from './src/contact.js'

const { _internals } = handler
const realFetch = globalThis.fetch

/** Stand in for Resend; `status` other than 200 makes it refuse. */
function serve(status = 200) {
  globalThis.fetch = async (url, options) => {
    globalThis.__sent.push({ url, ...JSON.parse(options.body), headers: options.headers })
    return {
      ok: status < 300,
      status,
      json: async () => (status < 300 ? { id: 'mail_1' } : { message: 'nope' }),
    }
  }
}

const KEYED = { RESEND_API_KEY: 're_test' }

/** A Vercel request/response pair, enough of one to call the handler with. */
async function call({ body, method = 'POST', env = KEYED, upstream = 200 } = {}) {
  const before = { ...process.env }
  for (const [name, value] of Object.entries({ RESEND_API_KEY: null, CONTACT_TO: null, CONTACT_FROM: null, ...env })) {
    if (value === null) delete process.env[name]
    else process.env[name] = value
  }
  globalThis.__sent = []
  serve(upstream)

  const sent = {}
  const response = {
    status(code) { sent.code = code; return response },
    json(payload) { sent.body = payload; return response },
    setHeader(name, value) { sent[name] = value },
  }
  await handler({ method, headers: {}, body }, response)

  globalThis.fetch = realFetch
  process.env = before
  return { ...sent, mails: globalThis.__sent }
}

const ok = { topic: 'support', message: 'The size slider does nothing.' }

const results = []
const check = (label, got, want) => {
  const passed = JSON.stringify(got) === JSON.stringify(want)
  results.push({ label, ok: passed, got, want })
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${label}\n        got ${JSON.stringify(got)}${passed ? '' : `\n        want ${JSON.stringify(want)}`}`)
}

console.log('\n--- shut unless switched on -------------------------------------')
{
  const off = await call({ body: ok, env: {} })
  check('with no key configured it refuses', off.code, 503)
  check('and sends nothing while refusing', off.mails.length, 0)
  check('and says which variable turns it on',
    off.body.detail.includes('RESEND_API_KEY'), true)
  check('a key stored with a stray newline still works',
    (await call({ body: ok, env: { RESEND_API_KEY: `re_test${String.fromCharCode(10)}` } })).code,
    200)
  check('only POST is accepted',
    (await call({ body: ok, method: 'GET' })).code, 405)
}

console.log('\n--- the subject the inbox sees ----------------------------------')
{
  const got = await call({ body: { ...ok, name: 'Jo' } })
  check('it sends, and sends exactly one mail', [got.code, got.mails.length], [200, 1])
  check('the subject leads with the brand, then the topic, then the name',
    got.mails[0].subject, `[${BRAND}] Web app support from Jo`)
  check('the brand in the function is the brand in web/src/brand.js',
    _internals.BRAND, BRAND)
  check('no name given is no name in the subject',
    (await call({ body: ok })).mails[0].subject, `[${BRAND}] Web app support`)

  for (const topic of TOPICS) {
    const one = await call({ body: { ...ok, topic: topic.id } })
    check(`the subject for "${topic.id}" names it`,
      one.mails[0].subject, `[${BRAND}] ${topic.label}`)
  }
}

console.log('\n--- nothing typed becomes a header ------------------------------')
{
  const nasty = await call({
    body: {
      ...ok,
      name: `Jo${String.fromCharCode(13, 10)}Bcc: someone@example.com`,
    },
  })
  const subject = nasty.mails[0].subject
  check('a newline in the name does not survive into the subject',
    [/[\r\n]/.test(subject), subject],
    [false, `[${BRAND}] Web app support from Jo Bcc: someone@example.com`])
  check('a name longer than the limit is cut to it',
    _internals.oneLine('x'.repeat(500), LIMITS.name).length, LIMITS.name)
}

console.log('\n--- what it refuses ---------------------------------------------')
{
  check('a topic that is not one of ours',
    (await call({ body: { ...ok, topic: 'invoices' } })).code, 400)
  check('no topic at all', (await call({ body: { message: 'hi' } })).code, 400)
  check('an empty message', (await call({ body: { ...ok, message: '   ' } })).code, 400)
  check('a message past the limit',
    (await call({ body: { ...ok, message: 'x'.repeat(LIMITS.message + 1) } })).code, 400)
  check('a message right on the limit is fine',
    (await call({ body: { ...ok, message: 'x'.repeat(LIMITS.message) } })).code, 200)
  check('an address that is not one',
    (await call({ body: { ...ok, email: 'jo at example' } })).code, 400)
  check('a body that is not JSON at all',
    (await call({ body: '{ not json' })).code, 400)
  check('nothing sent when a field is refused',
    (await call({ body: { ...ok, topic: 'invoices' } })).mails.length, 0)

  // The honeypot answers cheerfully and sends nothing. A bot told it failed
  // comes back; a bot told it worked does not.
  const trapped = await call({ body: { ...ok, company: 'Acme' } })
  check('a filled honeypot is answered as though it worked, and sends nothing',
    [trapped.code, trapped.body.ok, trapped.mails.length], [200, true, 0])
}

console.log('\n--- the mail itself ---------------------------------------------')
{
  const got = await call({ body: { ...ok, email: 'jo@example.com', context: 'Arrange page' } })
  const mail = got.mails[0]
  check('it goes to the support address by default',
    mail.to, ['tresjdesignsupport@gmail.com'])
  check('and to CONTACT_TO instead when one is set',
    (await call({ body: ok, env: { ...KEYED, CONTACT_TO: 'someone@else.com' } })).mails[0].to,
    ['someone@else.com'])
  check('the reply goes back to whoever wrote it', mail.reply_to, 'jo@example.com')
  check('with no address given there is nothing to reply to',
    (await call({ body: ok })).mails[0].reply_to, undefined)
  check('the body carries the message, the topic and the screen',
    [mail.text.includes(ok.message), mail.text.includes('Web app support'),
     mail.text.includes('Arrange page'), mail.text.includes(BRAND)],
    [true, true, true, true])
  check('the key travels in a header, never in the URL',
    [mail.headers.Authorization, mail.url.includes('re_test')],
    ['Bearer re_test', false])
}

console.log('\n--- when Resend will not ----------------------------------------')
{
  const refused = await call({ body: ok, upstream: 422 })
  check('an upstream refusal is not reported as success', refused.code, 502)
  check('and the reply says nothing about the account',
    [refused.body.detail.includes('resend'), refused.body.detail.includes('422')],
    [false, false])
}

console.log('\n--- the two lists are one list ----------------------------------')
{
  check('the picker offers exactly what the server accepts',
    TOPICS.map((t) => [t.id, t.label]),
    _internals.TOPICS.map((t) => [t.id, t.label]))
  check('and the limits are the same on both sides', LIMITS, _internals.LIMITS)
  check('the three topics asked for are the three that exist',
    TOPICS.map((t) => t.id), ['support', 'feature', 'other'])
}

const fails = results.filter((r) => !r.ok)
console.log(`\n${fails.length ? `${fails.length} FAILED` : 'all checks passed'}\n`)
console.log(`RESULTS ${JSON.stringify(results)}`)
process.exit(fails.length ? 1 : 0)
