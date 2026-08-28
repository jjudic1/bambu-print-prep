import sceneUrl from './hero/scene.jpg'
import beamUrl from './hero/beam.webp'
import headUrl from './hero/head.webp'
import planeUrl from './hero/plane.webp'

/**
 * The landing screen's animation: a paper plane sitting on the iPad, lifted
 * off it, flown across the room to the printer, and printed.
 *
 * A painting rather than a line drawing. One gouache plate carries the whole
 * tabletop -- iPad, printer, spool, the table itself -- and only the pieces
 * that have to move are laid over it: the plane, and the printer's beam and
 * print head. Those two were cut out of the same painting rather than drawn
 * or generated separately, which is why they cannot drift out of style with
 * the scene they sit on; the hole they left was filled with the wall's own
 * colour and the rail redrawn full width with a capped end.
 *
 * The beam takes the drop and the head rides it, because that is how a
 * cantilever works -- moving the head alone detaches it from the arm.
 *
 * Everything is positioned in cqw against `.hero`, so the whole scene scales
 * with the container and holds together on a phone as well as an iPad. The
 * geometry was authored in a 544px space, which is exactly `.hero`'s
 * max-width, so at full size 1cqw is 5.44px and the numbers are the ones the
 * layout was checked against.
 *
 * The flight is a motion path, not a list of poses. Holding every frame --
 * stop-motion, which is what this did first -- turns a loop-the-loop into a
 * handful of scattered positions and reads as the plane hesitating in mid-air.
 * One curve, travelled smoothly, with `offset-rotate: auto` banking the plane
 * along its own tangent, is both simpler and right; it also deletes the two
 * dozen rotations that otherwise have to be kept consistent by hand.
 *
 * FLIGHT is that curve, and it is used three times over -- as the plane's path,
 * as the dashed trail you can see, and as the mask that draws the trail in
 * behind the plane -- so the trail cannot drift out of step with the plane:
 * they are the same line, driven from the same percentages. Both live in an
 * SVG laid over the painting, in the same 544-wide space everything else is
 * authored in, because an SVG viewBox scales with the container where a motion
 * path measured in pixels would not.
 *
 * The machines still run on their own clock, and anyone who has asked their
 * device to stop moving things gets the last frame -- the plane, printed --
 * and nothing moves.
 *
 * Both ends of the throw are a screen lighting up: the iPad pulses and the
 * plane comes out of it, the printer pulses when the plane arrives. Nothing
 * radiates out of the iPad, deliberately -- ripples read as broadcasting, and
 * the whole point of this page is that nothing leaves the device.
 */
// Off the screen, up, once around, and down onto the plate -- in the same
// 544 x 363 space the painting is authored in, measured to the plane's own
// centre. It leaves flat, because the plane is lying on the iPad when it
// starts and `offset-rotate: auto` would otherwise stand it on its tail. The
// two arcs are the loop: a circle of r=42 about (196, 120), entered and left
// at its lowest point, in the clear air between the iPad and the printer's
// arm. It is 698 long, which styles.css needs for the trail -- `--trail-len`
// there and this path have to be measured together.
const FLIGHT = 'M 79 223 C 100 221 112 210 124 190 C 140 168 164 158 196 162 '
  + 'a 42 42 0 1 0 0 -84 a 42 42 0 1 0 0 84 '
  + 'C 232 166 258 138 286 104 C 314 88 322 132 314 174 C 308 212 320 238 344 251'

export default function PlaneHero() {
  return (
    <div className="hero" aria-hidden="true">
      <div className="hero-stage">
        <div className="hero-scene">
          <img className="hero-plate" src={sceneUrl} alt="" />
          <div className="hero-launch" />
          <img className="hero-part hero-beam" src={beamUrl} alt="" />
          <div className="hero-glow" />
          <img className="hero-made" src={planeUrl} alt="" />
          <img className="hero-part hero-head" src={headUrl} alt="" />

          {/* The air: the flight, and the trail it leaves. A dashed line cannot
              both carry a pattern and be revealed by one, so the reveal is a
              mask -- the same curve under a fat stroke, uncovered on the same
              percentages the plane travels. */}
          <svg className="hero-air" viewBox="0 0 544 363" aria-hidden="true">
            <defs>
              <mask id="hero-trail-mask" maskUnits="userSpaceOnUse"
                    x="0" y="0" width="544" height="363">
                <path className="hero-trail-reveal" d={FLIGHT} />
              </mask>
            </defs>
            <path className="hero-trail" d={FLIGHT} mask="url(#hero-trail-mask)" />
            {/* the painted plane, cut from the same plate, riding the path */}
            <g className="hero-fly"
               style={{ offsetPath: `path("${FLIGHT}")`, offsetRotate: 'auto' }}>
              <image href={planeUrl} x="-30.2" y="-15" width="60.4" height="30" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
}
