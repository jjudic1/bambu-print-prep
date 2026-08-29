import { inject, track } from '@vercel/analytics'

/**
 * Counting how many people get through, and where they came from.
 *
 * The question this exists to answer is narrow: **is the advertising working.**
 * Not "how do people use the app" -- that is a different question needing
 * different data, and the honest answer to it is still milestone 6, watching
 * one person do it. This only has to say how many arrived, where from, and how
 * many of them left with a file.
 *
 * Vercel Web Analytics, because it is already under the deploy: it is
 * cookieless, stores no identifier on the device, and needs no database of our
 * own. That last part matters more than it sounds. The whole strategic argument
 * in docs/HANDOFF.md is that `/local` has no server behind it and so cannot
 * cost anything as it grows; standing up an events endpoint and a store to hold
 * them would have put one back, and put it on the page that was the point of
 * not having one.
 *
 * **What this does mean is that /local now speaks to something.** It sends a
 * page view and these four event names. It does not send the model, the file,
 * the file's name, or anything measured from it -- and the landing copy has
 * been narrowed from "nothing is uploaded anywhere" to say exactly what does
 * and does not leave, because the old wording stopped being true the moment
 * this file was added.
 *
 * The four events are a funnel, in order. Each one is a step somebody either
 * takes or drops out at, so the gap between two of them is the thing to fix:
 *
 *   arrived      the page view, counted for free
 *   OPENED       they chose a model -- past the landing screen
 *   MADE         a file came out the other end
 *   SAVED        they tapped save, which is as far as a browser can see
 *
 * `STEPS` is the how-to-print page, saved separately. Somebody who takes that
 * is going to a printer; somebody who takes only the model may just be looking.
 */

export const OPENED = 'model opened'
export const MADE = 'file made'
export const SAVED = 'file saved'
export const STEPS = 'steps saved'

/** Every event name, in funnel order. The dashboard reads this. */
export const FUNNEL = [OPENED, MADE, SAVED, STEPS]

/** Which of the two products the event came from. */
export const ON_DEVICE = 'on device'
export const HOSTED = 'hosted'

/**
 * Start counting.
 *
 * Called from each entry point rather than from a component, so neither app has
 * to know this exists. In development the package logs to the console instead
 * of sending anything, which is what we want -- but its own auto-detection
 * reads process.env.NODE_ENV, which Vite does not define, so the mode is passed
 * in rather than guessed.
 */
export function startCounting() {
  inject({ mode: import.meta.env.PROD ? 'production' : 'development' })
}

/**
 * Count that a step happened.
 *
 * Wrapped rather than calling `track` directly for two reasons: the properties
 * are pinned down in one place, and counting must never be able to break the
 * app. A blocked script, an ad blocker, or an offline iPad all make this throw,
 * and none of them are a reason to fail to write somebody's file.
 *
 * **The clumsy name is the point.** This was `note`, which is also what
 * LocalApp calls the plain-language status line under the controls -- so
 * `const [note, setNote] = useState('')` shadowed the import and every call
 * tried to invoke a string. Nothing failed at build time, the counting silently
 * did not happen, and the user got "R is not a function" under the colour
 * swatches after their file had already been written. A name that cannot read
 * as a local variable cannot be shadowed by one; `web/metrics-check.mjs`
 * checks that no importer redeclares it anyway.
 */
export function countStep(event, where, extra = {}) {
  try {
    track(event, { where, ...extra })
  } catch {
    // Deliberate: a measurement that fails is a measurement we do not have,
    // and nothing more than that.
  }
}
