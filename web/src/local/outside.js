/**
 * Links that leave the app, from an app that has been added to the Home Screen.
 *
 * Added to the Home Screen, this runs as a standalone web app: no address bar,
 * no tabs, no back button. A normal link tapped in there does not reach the
 * Safari the user already has open with their MakerWorld login and their
 * bookmarks -- iOS shows a stripped browser sheet inside our own app instead.
 * It has a Done button and no obvious way to do anything else with the page,
 * which is the wrong shape for every outward link here: all of them are places
 * somebody is meant to arrive at, sign in to and stay a while.
 *
 * `x-safari-https:` is the way out. iOS hands an unknown scheme to the system,
 * and this one is Safari's own, so the address opens as a real Safari tab.
 *
 * Two things keep it from doing harm anywhere else:
 *
 *   - It is applied only when `navigator.standalone` is true. That property is
 *     WebKit's alone and is true only in the Home Screen case, so every desktop
 *     browser, every Android one, and Safari's own tabs are left with an
 *     ordinary https link.
 *   - It is a rewrite at the point of rendering, not a change to any stored
 *     URL. The saved how-to-print page keeps plain https, because that file is
 *     read outside this app and the scheme would mean nothing there.
 *
 * NOT VERIFIED ON A DEVICE. Everything else about the iPad in this project was
 * measured on one; this could not be, because the behaviour only exists inside
 * a Home Screen app. If a link ever does nothing when tapped, this is the first
 * thing to take out -- `href` alone is the whole change.
 */

/** True only inside an iOS Home Screen web app. */
export const standalone = () =>
  typeof navigator !== 'undefined' && navigator.standalone === true

const HTTPS = 'https://'
const SAFARI = 'x-safari-https://'

/**
 * The address to put in an `href` for somewhere outside the app.
 *
 * Anything that is not an https URL is handed back untouched: there is no
 * x-safari- form for a blob or a data URI, and the save links are both.
 */
export const outward = (url) =>
  standalone() && typeof url === 'string' && url.startsWith(HTTPS)
    ? SAFARI + url.slice(HTTPS.length)
    : url

/**
 * The same rewrite, across a whole document, for the how-to-print page shown
 * in a frame. The frame is sandboxed without scripts on purpose, so nothing
 * inside it can do this for itself -- and the string is the copy being read,
 * never the copy being saved.
 */
export const outwardHtml = (html) => {
  if (!standalone()) return html
  return html
    .split(`href="${HTTPS}`).join(`href="${SAFARI}`)
    // The page asks for a new tab, which is right everywhere it is read
    // except here: the scheme above is already a handoff to Safari, and
    // asking for a window as well is how an empty one gets left behind in
    // our own app. Dropped from the copy being shown, never from the file.
    .split(' target="_blank"').join('')
}
