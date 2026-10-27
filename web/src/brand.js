/**
 * The name on the front of the product.
 *
 * Under test: it was EZslicer3D, which promised a slicer -- the one thing this
 * deliberately is not, and "slice" is a word the copy rules ban from every
 * other user-facing string in the app. Handoff3D says what the product does:
 * the handoff from the iPad to the printer.
 *
 * Kept here, in one constant, because it is being tried rather than settled.
 * Both landing screens and the panel header read it. The two places it is NOT
 * read from are the page titles in web/index.html and web/dashboard.html --
 * static HTML, so change those by hand -- and nothing in prep/ or docs/, which
 * have no brand in them.
 */
export const BRAND = 'Handoff3D'

/** Said under the name, on both landing screens. */
export const TAGLINE = '3D print… no computer necessary'

/**
 * Pencil to Part, the iPad CAD app from the same maker, announced on the landing
 * screen until it ships. The guides carry their own copy (web/guides.mjs) because
 * they are built without the bundle. Becomes the App Store link at launch.
 */
export const PENCIL_URL = 'https://penciltopart-site.vercel.app/'

/**
 * Pencil to Part's App Store page. Empty until launch, and while it is empty the
 * Pencil to Part cards (src/local/PencilPromo.jsx) carry the launch-list form.
 * Set it at launch and they become a link to the App Store instead.
 */
export const PENCIL_APP_STORE_URL = ''
