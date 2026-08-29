/**
 * Which machine, and which nozzle is screwed into it.
 *
 * Both pickers read the same flat list out of printers.json -- one entry per
 * model *and* nozzle, because the nozzle is not a preference, it is a fact
 * about the machine that changes the file: its own machine profile, its own
 * layer height, its own line widths. There is no "0.6 mm" setting to apply to
 * a printer; there is a "Bambu Lab P1S 0.6 nozzle" that is a different printer
 * as far as the container is concerned.
 *
 * So the two selects are a view of one choice, and everything here is about
 * keeping that view honest when half of it changes: switch the model and the
 * nozzle should follow if that model has it, switch the nozzle and the model
 * must not move.
 *
 * Pure, and takes the list as an argument, so web/printers-check.mjs can run it
 * without a browser.
 */

/** What Bambu sells, and what every model in the vendored tree has a profile
 *  for. Kept here so the UI never invents a size the data cannot back. */
export const NOZZLES_MM = [0.2, 0.4, 0.6, 0.8]

/**
 * The one that comes fitted, and where every session starts.
 *
 * Deliberately not remembered. The printer is remembered -- you own one and it
 * does not change -- but a nozzle is swapped for one print and swapped back,
 * and a remembered 0.8 is a silent wrong answer months later for someone who
 * has long since put the standard one back on. Getting a 0.4 file when the 0.8
 * is fitted is a visibly coarse print; getting an 0.8 file when the 0.4 is
 * fitted is a printer trying to push four times the plastic through a quarter
 * of the hole. The default is the safe half of that.
 */
export const DEFAULT_NOZZLE_MM = 0.4

/** The machine the app starts on when nothing has been remembered. */
export const FALLBACK_MODEL = 'Bambu Lab P1S'

const byModel = (printers, model) => printers.filter((p) => p.model === model)

/**
 * One entry per machine -- what the printer picker lists.
 *
 * The default-nozzle entry stands for the model, and which one it is barely
 * matters: bed, height and bed type are properties of the machine, and the
 * picker shows nothing else. Order is left exactly as the file has it, which
 * is smallest bed first.
 */
export function models(printers) {
  const seen = new Map()
  for (const p of printers) {
    const held = seen.get(p.model)
    if (!held || (held.nozzle_mm !== DEFAULT_NOZZLE_MM
                  && p.nozzle_mm === DEFAULT_NOZZLE_MM)) {
      seen.set(p.model, p)
    }
  }
  return [...seen.values()]
}

/** The nozzles this machine has a profile for, smallest first. */
export function nozzlesFor(printers, model) {
  return [...new Set(byModel(printers, model).map((p) => p.nozzle_mm))]
    .sort((a, b) => a - b)
}

/**
 * The entry for a model and a nozzle.
 *
 * Falls back within the model rather than across it: a machine the data has no
 * 0.6 for should stay the machine the user picked, at whatever nozzle it does
 * have. Answering with a different printer entirely is how someone ends up
 * with a file for a bed they do not own. Null only if the model is unknown.
 */
export function pick(printers, model, nozzleMm) {
  const options = byModel(printers, model)
  return options.find((p) => p.nozzle_mm === nozzleMm)
    || options.find((p) => p.nozzle_mm === DEFAULT_NOZZLE_MM)
    || options[0]
    || null
}

/**
 * Where a session starts: the remembered machine, at the standard nozzle.
 *
 * `remembered` is a profile id from a previous visit and carries a nozzle in
 * it -- that is what localStorage has always held, and what old visitors still
 * have. Only the model half is taken, which is both the backward-compatible
 * reading and the intended one.
 */
export function startingPrinter(printers, remembered) {
  const known = printers.find((p) => p.id === remembered)
  const model = known ? known.model : FALLBACK_MODEL
  return (pick(printers, model, DEFAULT_NOZZLE_MM)
    || pick(printers, printers[0]?.model, DEFAULT_NOZZLE_MM)
    || printers[0]
    || null)
}
