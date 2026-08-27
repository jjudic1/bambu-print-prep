/**
 * Whose job is whose, in the app.
 *
 * The page that ships with the file says this at length (`prep/handoff.py` and
 * `web/src/local/handoff.js`), because that is what the user still has in front
 * of them when they are actually at the printer. This is the short form, and it
 * sits next to the button that makes the file rather than behind a link, since
 * a disclaimer nobody reaches is a disclaimer nobody read.
 *
 * Three things, and only three: nothing here has been printed, the machine and
 * whatever it does are the user's, and MakerWorld will not let a model nobody
 * has printed be made public.
 */

export default function Disclaimer({ short = false }) {
  if (short) {
    return (
      <p className="duty">
        Nothing here has been printed. Check the file on your own printer before
        you trust it, and keep a model private on MakerWorld until you have
        printed it and can photograph the real thing.
      </p>
    )
  }
  return (
    <p className="duty">
      <b>You are the one at the printer.</b> Nobody has printed this file before
      you. Whether these settings suit your machine is yours to check &mdash;
      stay with it for the first few minutes and stop the printer if anything
      does not look right. Any damage to your printer, or to anything else, is
      your responsibility. And keep the model private on MakerWorld until you
      have printed it and can show a photo of the real thing: making one public
      without that photo breaks the terms you agreed to when you signed up.
    </p>
  )
}
