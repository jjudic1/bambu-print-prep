/**
 * The contact form's other half.
 *
 * The app has no server, and this does not give it one back. There is no store,
 * no state and no session here: a POST comes in, one email goes out, nothing is
 * kept. Same shape as `api/insights.js`, and for the same reasons -- one file,
 * no imports, CommonJS, because there is no package.json at the repo root and
 * Vercel's Node runtime has global fetch. Nothing to install, nothing to keep
 * current.
 *
 * **Why a function at all**, when the browser could post to a form service
 * directly: the address people write to, and the credential that reaches it,
 * both stay off the page. A key in the bundle is a key anybody can read out of
 * it and send from, and the address in the markup is an address in every
 * scraper's list by the end of the month.
 *
 * Resend does the sending. Configuration, all from the environment (Vercel
 * project settings -> Environment Variables):
 *
 *   RESEND_API_KEY   re_... -- https://resend.com/api-keys. No key, no service.
 *   CONTACT_TO       where the mail lands. Defaults to the support address.
 *   CONTACT_FROM     what it is sent as. Defaults to Resend's shared sender,
 *                    which needs no domain of ours -- but note that Resend only
 *                    delivers from onboarding@resend.dev to the address the
 *                    Resend account itself was opened with. Sending anywhere
 *                    else means verifying a domain and setting this.
 *
 * Under our own prefix except RESEND_API_KEY, which is the vendor's own name
 * for the vendor's own credential and is what their docs, their dashboard and
 * every other integration call it.
 *
 * Three things it deliberately does:
 *
 * - **It is shut unless a key is set.** No RESEND_API_KEY and every request is
 *   refused with a message saying so, rather than a cheerful 200 over a mail
 *   nobody sent. The form shows what came back, so a misconfigured deploy says
 *   "not switched on" to the one person who tries it, instead of quietly
 *   swallowing everything anyone writes.
 * - **It writes the subject itself.** The topic is chosen from a fixed list by
 *   id and the brand name is a constant here; nothing the sender types reaches
 *   the subject line except a name, stripped of anything that could be a header
 *   of its own. That is what makes the subject trustworthy as a filter, and it
 *   is the whole point of the feature: a mail from the app must be obviously
 *   from the app before it is opened.
 * - **It refuses on its own terms.** Every limit below is enforced here, not
 *   only in the form, because the form is markup on somebody else's device.
 */

/**
 * The brand, spelled out rather than imported.
 *
 * `web/src/brand.js` cannot be reached from here: this file is loaded by
 * Vercel's Node runtime and that one is an ES module inside the Vite app. So it
 * is a constant in two places, and `web/contact-check.mjs` fails if the two
 * ever stop agreeing -- which is cheaper than the alternative, an email subject
 * carrying a name the product stopped using.
 */
const BRAND = 'Handoff3D'

/**
 * What someone can be writing about.
 *
 * Three, because the honest number of things a stranger wants to say here is
 * "it's broken", "it should do X", and "something else". A longer list makes
 * the form a quiz and gets picked at random anyway.
 *
 * Matched by `id`; the label is what goes in the subject. The same list is in
 * `web/src/contact.js` for the picker, and diffed by the check harness -- an id
 * that exists on one side only would either drop a valid message on the floor
 * or offer a choice the server refuses.
 */
const TOPICS = [
  { id: 'support', label: 'Web app support' },
  { id: 'feature', label: 'Feature request' },
  { id: 'other', label: 'Other' },
]

/** As long as a message may be, and every other field with it. */
const LIMITS = { message: 4000, name: 80, email: 160, context: 200 }

const RESEND = 'https://api.resend.com/emails'
const TIMEOUT = 15000

const DEFAULT_TO = 'tresjdesignsupport@gmail.com'
const DEFAULT_FROM = `${BRAND} <onboarding@resend.dev>`

/**
 * Anything that could be a header rather than a value.
 *
 * A newline in a name is how a subject line becomes two headers, and the second
 * one gets to say whatever it likes -- another recipient, most usefully. Resend
 * takes JSON rather than raw RFC 822 and does its own escaping, so this is a
 * belt over a brace; it costs one regex and removes the need to be sure about
 * somebody else's escaping.
 */
const oneLine = (value, cap) =>
  String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, cap)

/**
 * Is this an address, near enough.
 *
 * Deliberately loose. The only thing this decides is whether the address is
 * worth putting in Reply-To; a strict pattern here would refuse somebody's
 * perfectly good mail over a plus sign or a new top-level domain, and the cost
 * of being wrong the other way is a reply that bounces.
 */
const looksLikeEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

/** The body of the mail. Plain text: it is read on a phone, in Gmail. */
function compose({ topic, name, email, message, context }) {
  const lines = [
    `Topic:   ${topic.label}`,
    `From:    ${name || '(no name given)'}`,
    `Reply:   ${email || '(no address given -- you cannot reply to this)'}`,
  ]
  if (context) lines.push(`Page:    ${context}`)
  lines.push('', message, '',
    `-- sent from the ${BRAND} contact form`)
  return lines.join('\n')
}

/** Read the body whether the runtime parsed it or handed over the string. */
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

module.exports = async function contact(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ detail: 'Send this as a POST.' })
  }

  // Trimmed for the same reason every secret in api/insights.js is: a value set
  // from a terminal very easily carries a newline it does not look like it has,
  // and a key with one on the end is refused by the vendor as though it were
  // simply wrong.
  const apiKey = (process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) {
    return response.status(503).json({
      detail: 'The contact form is not switched on. Set RESEND_API_KEY on the '
        + 'project and redeploy.',
    })
  }

  const sent = payload(request)
  if (sent === null) {
    return response.status(400).json({ detail: 'That message did not arrive in one piece. Try again.' })
  }

  // A field no person can see and no person fills in. One line of markup and it
  // stops the sort of robot that posts every form it finds; anything cleverer
  // than that was going to get through a rate limit as well.
  if (oneLine(sent.company, 80)) {
    // Answered as though it worked. A bot told it failed tries again.
    return response.status(200).json({ ok: true })
  }

  const topic = TOPICS.find((t) => t.id === String(sent.topic || ''))
  if (!topic) {
    return response.status(400).json({ detail: 'Pick what this is about.' })
  }

  const message = String(sent.message == null ? '' : sent.message).trim()
  if (!message) {
    return response.status(400).json({ detail: 'Write a message to send.' })
  }
  if (message.length > LIMITS.message) {
    return response.status(400).json({
      detail: `That message is too long -- ${LIMITS.message} characters at most.`,
    })
  }

  const name = oneLine(sent.name, LIMITS.name)
  const email = oneLine(sent.email, LIMITS.email)
  if (email && !looksLikeEmail(email)) {
    return response.status(400).json({
      detail: 'That email address does not look right. Fix it, or leave it empty.',
    })
  }
  const context = oneLine(sent.context, LIMITS.context)

  // The subject, and the reason this endpoint exists rather than a mailto.
  // The brand first, always, in brackets: it is what the address is filtered
  // on, and it has to survive being read on a phone in a list of forty other
  // things. The topic next, because it decides what happens to the mail. A name
  // only if one was given, and only as far as the field allows.
  const subject = `[${BRAND}] ${topic.label}${name ? ` from ${name}` : ''}`

  const mail = {
    from: (process.env.CONTACT_FROM || '').trim() || DEFAULT_FROM,
    to: [(process.env.CONTACT_TO || '').trim() || DEFAULT_TO],
    subject,
    text: compose({ topic, name, email, message, context }),
  }
  // Reply-To only when there is an address to reply to. Set to something
  // invalid it would break the send outright, which would mean one person's
  // typo stopping their own message from arriving at all.
  if (email) mail.reply_to = email

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT)
  try {
    const got = await fetch(RESEND, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mail),
      signal: abort.signal,
    })
    if (!got.ok) {
      // What Resend said goes into the log, not into the reply. It names the
      // sending domain and the state of the account, and the person on the
      // form can do nothing with either.
      let detail = ''
      try {
        detail = JSON.stringify(await got.json())
      } catch {
        detail = `status ${got.status}`
      }
      console.error(`contact: Resend refused (${got.status}): ${detail}`)
      return response.status(502).json({
        detail: 'The message could not be sent just now. Try again in a minute.',
      })
    }
  } catch (error) {
    console.error(`contact: could not reach Resend: ${error.message}`)
    return response.status(502).json({
      detail: 'The message could not be sent just now. Try again in a minute.',
    })
  } finally {
    clearTimeout(timer)
  }

  response.setHeader('Cache-Control', 'no-store')
  return response.status(200).json({ ok: true })
}

// Reached by the check harness, not by Vercel.
module.exports._internals = { BRAND, TOPICS, LIMITS, oneLine, looksLikeEmail, compose }
