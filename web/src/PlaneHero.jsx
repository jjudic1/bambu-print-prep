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
 * there, deliberately: the paper world runs on held frames the way stop-motion
 * does, and the machine runs smooth, because a machine does. Anyone who has
 * asked their device to stop moving things gets the last frame -- the plane,
 * printed -- and nothing moves.
 */
export default function PlaneHero() {
  return (
    <div className="hero" aria-hidden="true">
      <svg viewBox="0 62 1200 292" role="img"
           aria-label="A paper plane is thrown from beside an iPad to a printer, which prints the plane">

        {/* the surface it all stands on */}
        <path className="hero-faint" d="M 90 340 H 1140" />

        {/* the iPad */}
        <g transform="rotate(-5 244 258)">
          <rect className="hero-ink" x="196" y="192" width="96" height="132" rx="9" />
          <rect className="hero-faint" x="204" y="200" width="80" height="116" rx="3" />
          <circle className="hero-faint" cx="244" cy="196" r="1.6" />
        </g>
        <path className="hero-ink" d="M 286 320 L 304 340" />

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

        {/* the hand, drawn around the pinch so the plane's tail sits in it */}
        <g id="hero-hand">
          <g className="hero-ink" transform="scale(1.15)">
            <path d="M -8 -7 L -36 -7 q -9 0 -9 7 q 0 7 9 7 L -8 7 q 7 0 7 -7 q 0 -7 -7 -7 Z" />
            <path d="M -16 -6 q -5 -11 3 -14 q 9 -3 12 5 q 2 6 -3 8" />
            <path d="M -45 -3 L -74 15" />
            <path d="M -43 9 L -70 27" />
          </g>
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
