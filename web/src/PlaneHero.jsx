/**
 * The landing screen's animation: a paper plane shot out of an iPad, flown
 * across the room at a printer, and printed by it.
 *
 * A line drawing rather than a picture, and drawn here rather than fetched:
 * it is a few kB of markup, stays sharp on a Retina iPad, takes the app's own
 * colours from the CSS tokens (so it recolours with the theme and cannot drift
 * from it), and needs no network -- which matters for a page whose whole claim
 * is that it works on the device.
 *
 * The flight is a motion path, not a list of poses. Posing it by hand and
 * holding each frame -- stop-motion, which is what this did first -- turns a
 * loop-the-loop into six scattered positions and reads as the plane hesitating
 * in mid-air. One curve, travelled smoothly, with `offset-rotate: auto` to bank
 * the plane along its own tangent, is both simpler and right. Only the moment
 * it leaves the screen still pops on held frames, where the stutter is the
 * point.
 *
 * FLIGHT is that curve, and it is used three times over -- as the plane's
 * path, as the dashed trail you can see, and as the mask that draws the trail
 * in behind the plane -- so the trail cannot drift out of step with the plane:
 * they are the same line, and both are driven from the same percentage.
 *
 * Both ends of the throw are a screen lighting up: the iPad pulses and the
 * plane comes out of it, the printer pulses when the plane arrives. Nothing
 * radiates out of the iPad, deliberately -- ripples read as broadcasting, and
 * the whole point of this page is that nothing leaves the device.
 *
 * The motion is in styles.css, next to the rest of the landing.
 */

// Out of the screen, up, once around, and a long glide into the printer. The
// two arcs are the loop: a circle of r=40 about (560, 124), entered and left at
// its lowest point, so the plane goes over the top and comes out flying the way
// it came in. The loop sits low enough that the plane, which is 11 units either
// side of the line it rides, clears the top of the frame. Its length is 979,
// which styles.css needs for the trail -- `--trail-len` there and this path
// have to be measured together.
const FLIGHT = 'M 246 268 C 252 246 268 222 296 202 C 340 178 386 172 430 168 '
  + 'C 480 164 526 164 560 164 a 40 40 0 1 0 0 -80 a 40 40 0 1 0 0 80 '
  + 'C 620 162 690 148 760 152 C 830 156 890 174 928 192'

export default function PlaneHero() {
  return (
    <div className="hero" aria-hidden="true">
      <svg viewBox="0 62 1200 292" role="img"
           aria-label="A paper plane is shot out of an iPad and flies to a printer, which prints the plane">

        <defs>
          {/* The trail is dashed and drawn in progressively, and one stroke
              cannot do both: the dashes are the pattern, so the reveal is this
              mask -- the same curve under a fat stroke, uncovered in step with
              the plane. */}
          <mask id="hero-trail-mask" maskUnits="userSpaceOnUse"
                x="0" y="0" width="1200" height="380">
            <path className="hero-trail-reveal" d={FLIGHT} />
          </mask>
        </defs>

        {/* the surface it all stands on */}
        <path className="hero-faint" d="M 90 340 H 1140" />

        {/* where it has been */}
        <path className="hero-trail" d={FLIGHT} mask="url(#hero-trail-mask)" />

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

        {/* The plane, drawn nose-first around its own origin: `offset-rotate:
            auto` points it along the path, so it needs no rotation of its own
            and banks through the loop for free. */}
        <g id="hero-plane" className="hero-paper"
           style={{ offsetPath: `path("${FLIGHT}")`, offsetRotate: 'auto' }}>
          <path d="M 30 0 L -28 -11 L -16 0 L -28 11 Z" />
          <path d="M 30 0 L -16 0" />
        </g>
      </svg>
    </div>
  )
}
