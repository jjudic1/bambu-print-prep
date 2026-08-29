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
 * Measured on a real iPad, 2026-08-29: MakerWorld tapped from the Home Screen
 * app opened full Safari. Worth writing down because the scheme is not an
 * Apple-supported API, it is a behaviour -- and because no desktop browser can
 * show this either way, so the next person to doubt it has nowhere to look but
 * a device. If a link ever does nothing when tapped, this is the first thing
 * to take out: `href` alone is the whole change.
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

// There was an `outwardHtml` here that did the same swap across the
// how-to-print page shown in the frame. It is gone, and the reason is worth
// keeping: measured on an iPad 2026-08-29, the scheme is *dead* inside that
// frame. A sandboxed frame will not hand a scheme it does not know to the
// system -- there is no allow-top-navigation, so the navigation is simply
// blocked and the tap does nothing.
//
// The link in the page therefore stays ordinary https, which at worst opens
// the sheet, and LocalApp puts an "Open MakerWorld" on the frame's own bar --
// outside the sandbox, where this does work. The alternative was lifting the
// sandbox on generated markup to buy what a button outside it already gives.
