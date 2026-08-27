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
      <div className="hero-stage">
        <div className="hero-scene">
          <img className="hero-plate" src={sceneUrl} alt="" />
          <div className="hero-launch" />
          <img className="hero-part hero-beam" src={beamUrl} alt="" />
          <div className="hero-glow" />
          <img className="hero-made" src={planeUrl} alt="" />
          <img className="hero-part hero-head" src={headUrl} alt="" />
          <img className="hero-fly" src={planeUrl} alt="" />
        </div>
      </div>
    </div>
  )
}
