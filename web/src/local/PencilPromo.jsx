import { useState } from 'react'

import { BRAND, PENCIL_APP_STORE_URL, PENCIL_URL } from '../brand.js'
import { outward, standalone } from './outside.js'

/**
 * Pencil to Part, the iPad CAD app from the same maker, in two places: on the
 * landing screen beside the test model ("where do I get a model?" -- draw one),
 * and in the panel right after the file is saved, when somebody has just been
 * through the whole route and it worked.
 *
 * Until launch it carries the launch-list form, which posts to api/notify.js on
 * this same site (the function that holds the Resend key). At launch, set
 * PENCIL_APP_STORE_URL in brand.js and both cards become an App Store link
 * instead; nothing else changes.
 *
 * Someone who has signed up is remembered on this device, so the card after the
 * save does not ask again. Best effort: storage can be off, and then it asks.
 */

const SIGNED_UP = 'handoff3d.pencilNotified'

const remembered = () => {
  try {
    return localStorage.getItem(SIGNED_UP) === '1'
  } catch {
    return false
  }
}

const remember = () => {
  try {
    localStorage.setItem(SIGNED_UP, '1')
  } catch {
    // Private browsing or storage off: the card simply asks again next time.
  }
}

const outwardTab = standalone()
  ? {}
  : { target: '_blank', rel: 'noopener noreferrer' }

const WORDS = {
  landing: {
    title: 'Want to make your own?',
    body: 'Pencil to Part is CAD for iPad from the makers of ' + BRAND + '. Draw a '
      + 'part with Apple Pencil, design it, and print it on your Bambu Lab '
      + 'printer -- idea to finished print on an iPad alone.',
  },
  saved: {
    title: 'Next time, design it yourself',
    body: 'Pencil to Part is CAD for iPad from the makers of ' + BRAND + ': draw '
      + 'a part with Apple Pencil and print it the same way you just did, with '
      + 'no computer.',
  },
}

export default function PencilPromo({ where }) {
  const words = WORDS[where]
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [already] = useState(remembered)
  const [state, setState] = useState(already ? 'done' : 'idle')
  const [problem, setProblem] = useState('')

  if (PENCIL_APP_STORE_URL) {
    return (
      <div className={'pencil ' + where}>
        <p className="pencil-title">{words.title}</p>
        <p>{words.body.replace(/ -- /g, ' — ')}</p>
        <a className="pencil-go" href={outward(PENCIL_APP_STORE_URL)} {...outwardTab}>
          Get Pencil to Part on the App Store
        </a>
      </div>
    )
  }

  // After the save, someone already on the list is not asked twice. (Someone
  // who signs up from this card still sees the thank-you: `already` is fixed
  // at the moment the card appeared.)
  if (where === 'saved' && already) return null

  async function submit(event) {
    event.preventDefault()
    setProblem('')
    setState('sending')
    try {
      const got = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, company }),
      })
      const body = await got.json().catch(() => ({}))
      if (got.ok) {
        remember()
        setState('done')
      } else if (got.status === 503) {
        setProblem('Sign-up is not open yet. Email TresJDesignSupport@gmail.com and we will tell you.')
        setState('idle')
      } else {
        setProblem(body.detail || 'That did not go through just now. Try again in a minute.')
        setState('idle')
      }
    } catch {
      setProblem('That did not go through just now. Check your connection and try again.')
      setState('idle')
    }
  }

  return (
    <div className={'pencil ' + where}>
      <p className="pencil-title">
        {words.title} <span className="pencil-soon">Coming soon</span>
      </p>
      <p>
        {words.body.replace(/ -- /g, ' — ')}{' '}
        <a href={outward(PENCIL_URL)} {...outwardTab}>See what it does</a>
      </p>
      {state === 'done' ? (
        <p className="pencil-ok">
          You&rsquo;re on the list. One email when Pencil to Part is in the App Store.
        </p>
      ) : (
        <form className="pencil-form" onSubmit={submit}>
          <input
            type="email" required maxLength={160} autoComplete="email"
            inputMode="email" placeholder="you@example.com"
            aria-label="Your email, to hear when Pencil to Part launches"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
          {/* Nobody sees this field; a robot that fills it is told it worked. */}
          <input
            className="pencil-trap" tabIndex={-1} autoComplete="off" aria-hidden="true"
            value={company} onChange={(e) => setCompany(e.target.value)}
          />
          <button type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Adding...' : 'Notify me'}
          </button>
        </form>
      )}
      {problem && <p className="pencil-problem">{problem}</p>}
      {state !== 'done' && (
        <p className="pencil-fine">One email at launch. Your address is not shared.</p>
      )}
    </div>
  )
}
