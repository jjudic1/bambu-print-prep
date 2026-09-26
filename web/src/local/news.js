// The little "New" tag that floats on the Advanced drawer.
//
// It says something changed and then gets out of the way: opening the drawer
// counts as reading it, and so does the x. Remembered per device, keyed by
// what is new rather than by a yes/no, so the next thing added to the drawer
// only needs NEWS changed here to show the tag again to everybody -- including
// the people who dismissed the last one. Empty NEWS takes it down.
export const NEWS = 'pattern-walls-supports'

// What the tag says. Outside the drawer, so it keeps to plain words (§6): the
// drawer itself says "infill", because whoever opens it came looking for that.
export const NEWS_LABEL = 'New: pattern, walls, supports'

const KEY = 'seen-advanced-news'

// Storage can throw -- a private window, or site data blocked -- and a tag that
// cannot remember being dismissed is better than a page that fails to load.
export const newsSeen = () => {
  if (!NEWS) return true
  try { return localStorage.getItem(KEY) === NEWS } catch (e) {
    if (e instanceof DOMException) return false
    throw e
  }
}

export const markNewsSeen = () => {
  try { localStorage.setItem(KEY, NEWS) } catch (e) {
    if (!(e instanceof DOMException)) throw e
  }
}
