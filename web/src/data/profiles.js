/**
 * The baked printer profiles, in the two sizes they come in.
 *
 * `printers.json` is the index -- bed, height, nozzle, which materials exist --
 * and at 13 KB it can ride in the bundle, because the pickers need it before
 * anything is on screen.
 *
 * `printer-settings.json` is the other 5.4 MB: 487 resolved settings per
 * printer per material, for 14 models x 4 nozzles x 4 materials. Nothing needs
 * it until someone asks for a file, and imported statically it took the main
 * bundle from 1.9 MB to 5.9 MB of JavaScript to parse before first paint -- on
 * an iPad, which is the entire target. So it is fetched on demand, as its own
 * chunk, and `warmSettings()` starts that the moment a model is dropped in, an
 * age before the button that needs it.
 *
 * Both files are generated together by spikes/export_web_profiles.py. They are
 * one thing split in two, and they go stale in step.
 */

import index from './printers.json'

export const printers = index.printers

let pending = null

/**
 * Start the settings downloading, and hand back the same promise to everyone
 * who asks after that. Safe to call whenever; it is one fetch either way.
 */
export function warmSettings() {
  if (!pending) {
    pending = import('./printer-settings.json')
      .then((m) => m.default)
      // A dropped connection must not be permanent. Holding the rejected
      // promise would mean one bad moment on a train turns into a page that
      // can never write a file again until it is reloaded.
      .catch((e) => { pending = null; throw e })
  }
  return pending
}

/**
 * The printer object the writer wants: an index entry with `materials` turned
 * from a list of names into the real settings, keyed the same way.
 */
export async function withSettings(printer) {
  const all = await warmSettings()
  const materials = all[printer.id]
  if (!materials) {
    throw new Error(
      `There are no settings for a ${printer.model} with a `
      + `${printer.nozzle_mm} mm nozzle.`)
  }
  return { ...printer, materials }
}
