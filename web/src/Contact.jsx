import { useState } from 'react'

import { BRAND } from './brand.js'
import { LIMITS, TOPICS, sendContact } from './contact.js'

/**
 * The contact form, as a sheet over whatever was on the screen.
 *
 * Same furniture as the how-to-print sheet in LocalApp -- a bar with a way out
 * and a body that scrolls -- because it opens from the same two screens and
 * arriving somewhere that looks like a different app is its own small alarm.
 * It is a sheet rather than a page for the plainer reason that this app has no
 * router and half its state is a model somebody has spent five minutes
 * arranging: navigating away from the arrange screen to say "the size slider is
 * odd" would throw away the very thing being described.
 *
 * The address it goes to is not written here, and not in the bundle at all. The
 * server holds it (`api/contact.js`), which keeps it out of the scrapers and
 * means it can change without a deploy of the app.
 *
 * `context` is what screen it was opened from, passed by the caller. One line
 * in the mail, and it is the difference between "the buttons don't work" and
 * knowing whether the person had a model open at the time.
 */
export default function Contact({ context = '', onClose }) {
  const [topic, setTopic] = useState(TOPICS[0].id)
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  // The honeypot. Hidden from sight and from a screen reader, never filled in
  // by a person, and the server answers a filled one with a cheerful 200.
  const [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const trimmed = message.trim()
  const left = LIMITS.message - message.length

  async function submit(event) {
    event.preventDefault()
    if (busy || !trimmed) return
    setBusy(true)
    setError('')
    const got = await sendContact({
      topic, message: trimmed, name, email, company, context,
    })
    setBusy(false)
    if (got.ok) setSent(true)
    else setError(got.detail)
  }

  return (
    <div className="sheet" role="dialog" aria-label={`Contact ${BRAND}`}>
      <div className="sheet-bar">
        <span>Contact us</span>
        <span className="sheet-acts">
          <button type="button" onClick={onClose}>
            {sent ? 'Done' : 'Close'}
          </button>
        </span>
      </div>
      <div className="sheet-body">
        {sent ? (
          <div className="form">
            <p>Sent. Thank you &mdash; it has gone to the people who made this.</p>
            {/* Said only when there is nowhere to reply to. Finding out after
                the fact that nobody could write back is worse than a line of
                text now. */}
            <p className="hint">
              {email
                ? 'If it needs an answer, it will come to the address you gave.'
                : 'You did not leave an address, so there is no way to write back'
                  + ' -- send another one with an email in it if you want a reply.'}
            </p>
            <button type="button" className="go" onClick={onClose}>
              Back to the app
            </button>
          </div>
        ) : (
          <form className="form" onSubmit={submit}>
            <p className="hint">
              A question, something broken, or something it ought to do. This
              goes by email to the people who made {BRAND} &mdash; only what you
              type here is sent, never your model.
            </p>

            <div className="field">
              <span>What is this about</span>
              <div className="options">
                {TOPICS.map((choice) => (
                  <button
                    type="button"
                    key={choice.id}
                    className={topic === choice.id ? 'option on' : 'option'}
                    aria-pressed={topic === choice.id}
                    onClick={() => setTopic(choice.id)}
                  >
                    {choice.label}
                    <em>{choice.hint}</em>
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>
                Message
                {left < 200 && <em>{left} left</em>}
              </span>
              <textarea
                rows={7}
                value={message}
                maxLength={LIMITS.message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened, or what you were trying to do."
              />
            </label>

            <label className="field">
              <span>Your name <em>optional</em></span>
              <input
                type="text" value={name} maxLength={LIMITS.name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="field">
              <span>Your email <em>if you want a reply</em></span>
              <input
                type="email" value={email} maxLength={LIMITS.email}
                autoComplete="email" inputMode="email"
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            {/* Not display:none -- some robots skip what is hidden that way.
                Off the side of the screen, out of the tab order, and hidden
                from anything reading the page aloud. */}
            <label className="trap" aria-hidden="true">
              Company
              <input
                type="text" tabIndex={-1} autoComplete="off"
                value={company} onChange={(e) => setCompany(e.target.value)}
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button className="go" type="submit" disabled={busy || !trimmed}>
              {busy ? 'Sending...' : 'Send'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
