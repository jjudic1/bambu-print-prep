import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { Caption, type Beat, BeatCaption } from "../components/Caption";
import { Ipad } from "../components/Ipad";

// One app screen, held, with something to say over it. The slow push is the
// point: a cut that sits still on a single screen reads as a screenshot with a
// timer on it, and the push is small enough not to notice and large enough
// that the frame is never static.
export const ScreenScene: React.FC<{
  eyebrow?: string;
  caption: React.ReactNode;
  children: React.ReactNode;
}> = ({ eyebrow, caption, children }) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill name="Screen scene">
      <Backdrop />
      <Caption eyebrow={eyebrow}>{caption}</Caption>
      <Ipad
        push={interpolate(frame, [0, 120], [1, 1.05], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          output: "perceptual-scale",
        })}
      >
        {children}
      </Ipad>
    </AbsoluteFill>
  );
};

// The single-angle version: same screen, three things said over it. Three
// claims off one screen is what makes an eleven-second cut worth watching to
// the end rather than a still that has been left on too long.
export const BeatScene: React.FC<{ beats: Beat[]; children: React.ReactNode }> = ({
  beats,
  children,
}) => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill name="Beat scene">
      <Backdrop />
      <BeatCaption beats={beats} />
      <Ipad
        push={interpolate(frame, [0, 330], [1, 1.07], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          output: "perceptual-scale",
        })}
      >
        {children}
      </Ipad>
    </AbsoluteFill>
  );
};
