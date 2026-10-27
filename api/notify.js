/**
 * The launch list for Pencil to Part: "tell me when it is on the App Store".
 *
 * Not a Handoff3D feature. It lives here because this project already holds
 * the Resend key (stored sensitive, so it cannot be read back and copied to
 * penciltopart-site), and the form on that site posts across to this one --
 * hence the CORS below, open to that one origin only.
 *
 * Same shape as api/contact.js: one file, CommonJS, no imports, Vercel's Node
 * runtime and its global fetch. A POST with an address comes in and one email
 * goes to the support inbox, subject "[Pencil to Part] Launch list:
 * <address>", so a Gmail filter on that subject is the list.
 *
 * Environment (Vercel project settings -> Environment Variables):
 *
 *   RESEND_API_KEY    re_... from https://resend.com/api-keys. No key, no
 *                     service: every request is refused with a 503 saying so,
 *                     and the page falls back to the support address.
 *   NOTIFY_TO         where the mail lands. Defaults to the support address.
 *   NOTIFY_FROM       what it is sent as. Defaults to Resend's shared sender,
 *                     which only delivers to the address the Resend account was
 *                     opened with.
 *   RESEND_AUDIENCE_ID  optional. When set, the address is also added to that
 *                     Resend audience, so the launch mail can go out as one
 *                     broadcast. Needs a full-access key, not a sending one.
 *
 * Nothing is kept here; the inbox (and the audience, if set) is the store.
 */

const BRAND = 'Pencil to Part'
const RESEND = 'https://api.resend.com'
const TIMEOUT = 15000
const MAX_EMAIL = 160

const DEFAULT_TO = 'tresjdesignsupport@gmail.com'
const DEFAULT_FROM = `${BRAND} <onboarding@resend.dev>`

const oneLine = (value, cap) =>
  String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, cap)

const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

function payload(request) {
  const body = request.body
  if (body == null) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }
  if (typeof body === 'object') return body
  return null
}

async function resend(path, apiKey, body) {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT)
  try {
    const got = await fetch(RESEND + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: abort.signal,
    })
    if (got.ok) return true
    let detail = ''
    try {
      detail = JSON.stringify(await got.json())
    } catch {
      detail = `status ${got.status}`
    }
    console.error(`notify: Resend refused ${path} (${got.status}): ${detail}`)
    return false
  } catch (error) {
    console.error(`notify: could not reach Resend for ${path}: ${error.message}`)
    return false
  } finally {
    clearTimeout(timer)
  }
}

const TRY_LATER = 'That did not go through just now. Try again in a minute.'

/** The one page allowed to post here from a browser. */
const ORIGIN = 'https://penciltopart-site.vercel.app'

module.exports = async function notify(request, response) {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Access-Control-Allow-Origin', ORIGIN)
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Vary', 'Origin')
  if (request.method === 'OPTIONS') {
    return response.status(204).end()
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ detail: 'Send this as a POST.' })
  }

  const apiKey = (process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) {
    return response.status(503).json({ detail: 'off' })
  }

  const sent = payload(request)
  if (sent === null) {
    return response.status(400).json({ detail: TRY_LATER })
  }

  // The field no person sees. A bot that fills it is told it worked.
  if (oneLine(sent.company, 80)) {
    return response.status(200).json({ ok: true })
  }

  const email = oneLine(sent.email, MAX_EMAIL)
  if (!looksLikeEmail(email)) {
    return response.status(400).json({ detail: 'That email address does not look right.' })
  }

  const mailed = await resend('/emails', apiKey, {
    from: (process.env.NOTIFY_FROM || '').trim() || DEFAULT_FROM,
    to: [(process.env.NOTIFY_TO || '').trim() || DEFAULT_TO],
    reply_to: email,
    subject: `[${BRAND}] Launch list: ${email}`,
    text: `${email} asked to be told when ${BRAND} is on the App Store.\n\n`
      + `-- sent from the sign-up form on penciltopart-site`,
  })
  if (!mailed) {
    return response.status(502).json({ detail: TRY_LATER })
  }

  // Best effort: the mail above is the record, so a refused audience add is
  // logged rather than shown to the person who signed up.
  const audience = (process.env.RESEND_AUDIENCE_ID || '').trim()
  if (audience) {
    await resend(`/audiences/${encodeURIComponent(audience)}/contacts`, apiKey,
      { email, unsubscribed: false })
  }

  return response.status(200).json({ ok: true })
}

module.exports._internals = { BRAND, ORIGIN, oneLine, looksLikeEmail }
