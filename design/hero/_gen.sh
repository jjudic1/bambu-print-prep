GEN="C:/Users/jjudi/.claude/Claude code projects/_shared/openai-media/gen-image.mjs"
OUT="web/public/hero"
STYLE="Hand-painted gouache illustration. Visible dry-brush texture and paper tooth, slightly wobbly hand-drawn ink outline, matte opaque paint, no gradients, no gloss, no photorealism. Limited palette: warm cream, soft warm grey, muted charcoal and one fresh leaf green. Naive picture-book charm, confident simple shapes. No text, no lettering, no watermark."
SPR="Isolated object, centred, transparent background, no drop shadow, no ground, no background scenery."
SCENE="Consistent wide side-on tabletop scene painted on a very dark charcoal background, cinematic wide composition, simple table surface line."

case "$1" in
ipad)    node "$GEN" "$STYLE Subject: a modern tablet computer standing upright on its short edge, seen straight on at a slight three-quarter angle, thin bezel, blank pale screen with a faint green tint. $SPR" "$OUT/ipad.png" --size 1024x1024 --transparent ;;
hand)    node "$GEN" "$STYLE Subject: a simple human hand seen from the side, thumb and index finger pinching together at the right, other fingers curled, wrist and a little forearm running off to the lower left. Warm cream skin painted simply. $SPR" "$OUT/hand.png" --size 1024x1024 --transparent ;;
printer) node "$GEN" "$STYLE Subject: a small boxy desktop 3D printer, front view, open cube frame, a flat build plate inside near the bottom, a horizontal gantry bar across the middle carrying a small print head. Charcoal and warm grey body with fresh green accents. $SPR" "$OUT/printer.png" --size 1024x1024 --transparent ;;
scene)   node "$GEN" "$STYLE $SCENE On the left a tablet computer stands upright on the table. On the right sits a small boxy desktop 3D printer. The middle of the picture is deliberately empty air. No people, no hands, no paper aeroplane anywhere." "$OUT/scene.png" --size 1536x1024 ;;
c1)      node "$GEN" "$STYLE $SCENE Tablet standing upright on the left, small boxy 3D printer on the right. A small cream paper aeroplane hovers in the air just above the tablet." "$OUT/c1.png" --size 1536x1024 ;;
c2)      node "$GEN" "$STYLE $SCENE Tablet on the left, small boxy 3D printer on the right. A hand reaches in from the lower left and pinches a small cream paper aeroplane above the tablet, arm wound back ready to throw." "$OUT/c2.png" --size 1536x1024 ;;
c3)      node "$GEN" "$STYLE $SCENE Tablet on the left, small boxy 3D printer on the right. A cream paper aeroplane has just been released and flies low near the tablet, the throwing hand withdrawing at the lower left." "$OUT/c3.png" --size 1536x1024 ;;
c4)      node "$GEN" "$STYLE $SCENE Tablet on the left, small boxy 3D printer on the right. A cream paper aeroplane is in mid-flight in the centre of the picture, banking over into a loop, with a faint painted arc showing its path." "$OUT/c4.png" --size 1536x1024 ;;
c5)      node "$GEN" "$STYLE $SCENE Tablet small on the left, small boxy 3D printer on the right. A cream paper aeroplane arrives at the printer, nose almost touching it." "$OUT/c5.png" --size 1536x1024 ;;
c6)      node "$GEN" "$STYLE $SCENE Tablet on the left. On the right the small boxy 3D printer glows fresh green as it prints, and a finished cream paper aeroplane lies flat on its build plate." "$OUT/c6.png" --size 1536x1024 ;;
esac
