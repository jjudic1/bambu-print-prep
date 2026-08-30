/**
 * Writing to the people who made this.
 *
 * The one place in the app that sends something on purpose. Everything else
 * about `/local` is a promise that the model stays on the device, and this does
 * not touch it: what goes is what somebody typed into three boxes.
 *
 * The endpoint is `api/contact.js`, and the list below is the half of it the
 * picker needs. Two copies of the same list, kept honest by
 * `web/contact-check.mjs`: an id here that the server does not know is a choice
 * that is refused after the message is written, which is the worst moment to
 * find out.
 */

/** Where the message goes. `/api/` is let through the catch-all rewrite. */
export const ENDPOINT = '/api/contact'

/**
 * What someone can be writing about, in the order the buttons appear.
 *
 * `hint` is the picker's own; it never leaves the page. It is there because
 * "Other" with nothing under it makes people pick one of the first two and
 * apologise in the message.
 */
export const TOPICS = [
  {
    id: 'support',
    label: 'Web app support',
    hint: 'Something is not working',
  },
  {
    id: 'feature',
    label: 'Feature request',
    hint: 'Something it should do',
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'Anything else',
  },
]

/** The same caps the server enforces. Shown as a countdown, not as a rule. */
export const LIMITS = { message: 4000, name: 80, email: 160, context: 200 }

/**
 * Send it.
 *
 * Resolves to `{ ok: true }` or `{ ok: false, detail }`, and never throws --
 * an offline iPad, a blocked request and a refusal all have to arrive at the
 * form as a sentence somebody can act on, and a rejected promise here would
 * surface as an unhandled error with the message still in the box.
 *
 * The detail is whatever the server said when it said anything, because it
 * knows things this side does not: that the form is not switched on, that the
 * address does not parse, that Resend is having a morning.
 */
export async function sendContact(fields) {
  let got
  try {
    got = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
  } catch {
    return {
      ok: false,
      detail: 'That did not go anywhere -- check you are online and try again.',
    }
  }

  // A body is not guaranteed: the catch-all rewrite hands back a page of HTML
  // for anything it does not recognise, and JSON.parse on a doctype throws.
  let said = null
  try {
    said = await got.json()
  } catch {
    said = null
  }

  if (got.ok && said && said.ok) return { ok: true }
  return {
    ok: false,
    detail: (said && said.detail)
      || 'The message could not be sent just now. Try again in a minute.',
  }
}
