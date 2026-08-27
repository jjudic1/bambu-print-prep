/**
 * The landing screen's animation: a paper plane thrown from beside an iPad at a
 * printer, which prints it.
 *
 * A line drawing rather than a picture, and drawn here rather than fetched:
 * it is a few kB of markup, stays sharp on a Retina iPad, takes the app's own
 * colours from the CSS tokens (so it recolours with the theme and cannot drift
 * from it), and needs no network -- which matters for a page whose whole claim
 * is that it works on the device.
 *
 * The motion is in styles.css next to the rest of the landing. Two clocks
 * there, deliberately: the paper runs on held frames the way stop-motion does,
 * and the machines run smooth, because machines do. Anyone who has asked their
 * device to stop moving things gets the last frame -- the plane, printed -- and
 * nothing moves.
 *
 * Both ends of the throw are a screen lighting up: the iPad pulses and the
 * plane comes out of it, the printer pulses when the plane arrives. Nothing
 * radiates out of the iPad, deliberately -- ripples read as broadcasting, and
 * the whole point of this page is that nothing leaves the device.
 */
export default function PlaneHero() {
  return (
    <div className="hero" aria-hidden="true">
      <svg viewBox="0 62 1200 292" role="img"
           aria-label="A paper plane is thrown from beside an iPad to a printer, which prints the plane">

        {/* the surface it all stands on */}
        <path className="hero-faint" d="M 90 340 H 1140" />

        {/* the iPad, standing on the line rather than propped on a stand */}
        <g id="hero-ipad" className="hero-ink">
          <rect x="196" y="196" width="100" height="144" rx="10" />
          <rect className="hero-screen" x="205" y="205" width="82" height="126" rx="3" />
          <circle className="hero-faint" cx="246" cy="200.5" r="1.6" />
        </g>

        {/* the printer: base, plate, column, and the arm that carries the head */}
        <g id="hero-printer" className="hero-ink">
          <rect x="860" y="296" width="250" height="44" rx="8" />
          <rect x="884" y="284" width="202" height="12" rx="3" />
          <rect x="866" y="116" width="30" height="180" rx="7" />
          <path d="M 881 134 v 146" />
          <g id="hero-gantry">
            <rect x="890" y="166" width="176" height="18" rx="5" />
            <g id="hero-toolhead">
              <rect x="946" y="182" width="40" height="36" rx="6" />
              <path d="M 960 218 L 972 218 L 966 230 Z" />
            </g>
          </g>
        </g>

        {/* what it prints: the same plane, flat on the plate */}
        <g transform="translate(985 271) scale(1.15)">
          <path className="hero-paper hero-printed" d="M 30 0 L -28 -11 L -16 0 L -28 11 Z" />
          <path className="hero-paper hero-printed hero-crease" d="M 30 0 L -16 0" />
        </g>

        {/* the moment it lands */}
        <g transform="translate(930 194)">
          <circle className="hero-paper hero-ring" r="14" />
          <circle className="hero-paper hero-ring b" r="14" />
          <circle className="hero-paper hero-ring c" r="14" />
        </g>

        {/* the plane itself, drawn around its own origin so it can be flown */}
        <g id="hero-plane" className="hero-paper">
          <path d="M 30 0 L -28 -11 L -16 0 L -28 11 Z" />
          <path d="M 30 0 L -16 0" />
        </g>
      </svg>
    </div>
  )
}
