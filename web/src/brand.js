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
