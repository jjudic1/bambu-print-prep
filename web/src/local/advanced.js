/**
 * The few slicer settings worth showing, and the one trap in writing them.
 *
 * The spec's §6 rule is "do not expose layer height, infill percentage, support
 * angle, or any slicer setting *in the primary flow*" -- and it is right, those
 * are places the target user fails. This is not the primary flow. It is a
 * drawer that starts shut, and everything in it has an answer already chosen by
 * the printer's own profile, so somebody who never opens it gets exactly the
 * file they got before. The drawer's own words can use the real names, for the
 * same reason web/guides.mjs does: the person who opens "Advanced" came looking
 * for "gyroid", and a page that will not say the word cannot answer them.
 *
 * ## The trap
 *
 * **Bambu Studio does not trust the values in project_settings.config.** It
 * reloads each system profile named in `*_settings_id` and re-applies only the
 * keys listed in `different_settings_to_system`, so a setting written into the
 * blob but not declared there is silently reverted -- the file says one thing
 * and the slicer shows another, with nothing anywhere saying so. That is not a
 * guess: it is what happened to `enable_support` (docs/transport-findings.md,
 * and `_override_manifest` in prep/profiles.py), which is why the baked blobs
 * already carry `different_settings_to_system: ["enable_support", "", ""]`.
 *
 * So every override here goes in twice: the value, and the declaration. The
 * list is positional -- [process, one slot per filament, printer] -- and all
 * four of these are process settings, so they join slot 0.
 *
 * ## Standard means standard
 *
 * Three of the four choices can be left alone, and `null` is what that means:
 * do not write the key at all, so the printer's profile decides. This is not
 * shyness. The 0.2 mm nozzle profiles ask for four walls and the A1's 0.6 for
 * 25% -- values chosen for those line widths by people who measured them -- and
 * a blanket "2 walls, 15%" default of ours would quietly overrule every one of
 * them for a user who opened the drawer and changed nothing else.
 *
 * Supports are one exception and are a plain on/off, because every one of the
 * 202 baked blobs says `enable_support: "1"` with `support_type: "tree(auto)"`
 * -- we already turn them on for everybody. web/advanced-check.mjs fails if
 * that stops being true, rather than letting the toggle lie about where it
 * started.
 *
 * The pattern is the other, and the one place this app overrules every
 * profile on purpose. All 202 say grid; we start on gyroid, because grid lays
 * each layer as lines that cross, and the nozzle clips the raised crossings on
 * its way over -- the knocks and snags that print fine on paper. Gyroid has no
 * crossings. It costs some time, and Grid is still one tap away. Unlike the
 * density and wall count this is not a figure somebody tuned for a line width:
 * the profiles all say grid because grid is what Bambu ships, not because a
 * 0.2 mm nozzle needs it. Both choices are written out, as supports are, and a
 * key that matches the profile is simply not declared -- so Grid writes the
 * byte-for-byte file this app wrote before gyroid became the default.
 *
 * Nothing here is remembered between sessions, for the reason printers.js does
 * not remember a nozzle: a choice made for one print, hidden behind a shut
 * drawer, is a silent wrong answer months later.
 *
 * Pure, and takes the settings blob as an argument, so web/advanced-check.mjs
 * can run it against the real profiles without a browser.
 */

/**
 * How the inside is laid out. Everything baked says "grid"; we start on
 * gyroid (see "Standard means standard" above for why).
 */
export const PATTERNS = [
  { key: 'gyroid', value: 'gyroid', label: 'Gyroid', note: 'recommended' },
  { key: 'grid', value: 'grid', label: 'Grid', note: 'faster' },
]

/**
 * How much of it there is. `null` leaves the printer's own figure alone.
 *
 * Neither end goes all the way. **100% is not offered**, and that is a
 * decision rather than an oversight: a solid model is hours of extra time and
 * a spool of extra plastic for a part that is usually no stronger than one at
 * 40%, and it warps and curls where a sparse one does not. 90% is the top, and
 * anybody who genuinely wants the last tenth has Bambu Studio.
 *
 * Nothing under 5% either. Below that the lines are far enough apart that the
 * top surface has nothing to bridge onto and sags between them -- and 0% is
 * worse than it sounds: it is not "hollow", it is a model with solid top and
 * bottom skins and nothing holding the top one up.
 */
export const DENSITIES = [
  { value: null, label: 'Standard' },
  { value: 5, label: '5% - as little as holds up' },
  { value: 10, label: '10% - light' },
  { value: 15, label: '15%' },
  { value: 25, label: '25%' },
  { value: 50, label: '50% - strong' },
  { value: 90, label: '90% - nearly solid' },
]

/** How many loops the outside is drawn with. `null` leaves the profile alone. */
export const WALLS = [
  { value: null, label: 'Standard' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4 - stronger' },
  { value: 5, label: '5' },
]

/**
 * Where the drawer opens: gyroid, the profile's own answer for how much and
 * how many walls, and supports on, which is what every profile already asks.
 */
export const DEFAULTS = Object.freeze({
  pattern: 'gyroid', density: null, walls: null, supports: true,
})

/** The support settings we write, and the only kind of support offered.
 *
 * Tree only, deliberately. It is the one that comes off a whimsical shape
 * without taking a face with it, and "which support style" is a question this
 * app has no business asking -- the honest version of it would need the
 * overhang analysis that lives in prep/, on a server that is gone.
 */
export const SUPPORT_TYPE = 'tree(auto)'

/** Every settings key this file will ever write. */
export const KEYS = [
  'enable_support', 'sparse_infill_density', 'sparse_infill_pattern',
  'support_type', 'wall_loops',
]

/**
 * The settings to write for a set of choices.
 *
 * Values are strings because that is how Bambu writes every scalar in the blob
 * -- "15%", "2", "1" -- and a number here would be a type nothing else in the
 * file uses.
 */
export function patchFor(advanced = DEFAULTS) {
  const choice = { ...DEFAULTS, ...advanced }
  const patch = {}

  // Written either way, like supports: gyroid is ours, so it has to be said,
  // and grid matches the profile, so changedKeys() lets it drop out unsaid.
  const pattern = PATTERNS.find((p) => p.key === choice.pattern)
  if (pattern) patch.sparse_infill_pattern = pattern.value
  if (choice.density !== null && choice.density !== undefined) {
    patch.sparse_infill_density = `${choice.density}%`
  }
  if (choice.walls !== null && choice.walls !== undefined) {
    patch.wall_loops = String(choice.walls)
  }

  // Written either way: the profiles turn supports on, so "off" is as much an
  // override as "on" is, and both have to be said out loud.
  patch.enable_support = choice.supports ? '1' : '0'
  if (choice.supports) patch.support_type = SUPPORT_TYPE

  return patch
}

/** What this printer and material already say, for labelling "Standard". */
export function profileValues(settings) {
  if (!settings) return null
  return {
    pattern: settings.sparse_infill_pattern,
    density: settings.sparse_infill_density,
    walls: settings.wall_loops,
    supports: settings.enable_support === '1',
  }
}

/**
 * Which keys a patch actually changes, against the profile it lands on.
 *
 * Writing a value identical to the profile's is not an override and must not
 * be counted as one; it is also harmless to declare, which is why the declared
 * set below only ever grows.
 */
export function changedKeys(settings, patch) {
  return Object.keys(patch).filter((k) => settings[k] !== patch[k]).sort()
}

/**
 * Declare the overrides where Bambu Studio looks for them.
 *
 * Positional: [process settings, one slot per filament, printer]. Keys already
 * declared stay declared -- we do not know what the system profile says for
 * those (only that it differs from the blob), and re-applying a value that
 * happens to match is a no-op, while dropping a declaration is how a setting
 * goes missing.
 */
export function declare(existing, changed) {
  const slots = Array.isArray(existing) && existing.length
    ? [...existing]
    : ['', '', '']
  const already = String(slots[0] || '').split(';').filter(Boolean)
  slots[0] = [...new Set([...already, ...changed])].sort().join(';')
  return slots
}

/**
 * A printer profile with the advanced choices written into it.
 *
 * Copies rather than edits: the settings blob is a fetched JSON module held
 * once for the whole session, so a patch applied in place would follow the user
 * into every later file they wrote, including after they put the drawer back to
 * Standard.
 *
 * Returns the profile untouched when nothing differs -- which, since the
 * default is gyroid, is Grid with everything else left alone: byte-for-byte
 * the file this app wrote before.
 */
export function applyAdvanced(profile, material, advanced = DEFAULTS) {
  const entry = profile?.materials?.[material]
  if (!entry?.settings) return profile

  const patch = patchFor(advanced)
  const changed = changedKeys(entry.settings, patch)
  if (!changed.length) return profile

  const settings = { ...entry.settings, ...patch }
  settings.different_settings_to_system =
    declare(entry.settings.different_settings_to_system, changed)

  return {
    ...profile,
    materials: { ...profile.materials, [material]: { ...entry, settings } },
  }
}

/**
 * The drawer's closed state, in words: what has been changed from where the
 * drawer opens.
 *
 * A shut drawer hiding a 100% solid model is the same class of bug as a
 * remembered nozzle, so the summary line says so without being opened.
 */
export function summarise(advanced = DEFAULTS) {
  const choice = { ...DEFAULTS, ...advanced }
  const said = []
  if (choice.pattern !== DEFAULTS.pattern) {
    said.push(PATTERNS.find((p) => p.key === choice.pattern)?.label || choice.pattern)
  }
  if (choice.density !== null && choice.density !== undefined) {
    said.push(`${choice.density}% inside`)
  }
  if (choice.walls !== null && choice.walls !== undefined) {
    said.push(`${choice.walls} walls`)
  }
  if (!choice.supports) said.push('no supports')
  return said
}
