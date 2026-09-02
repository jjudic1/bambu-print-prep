import React from "react";
import { AbsoluteFill, Interactive, interpolate, useCurrentFrame } from "remotion";
import { brand, font } from "../brand";
import { Backdrop } from "../components/Backdrop";

// Three seconds to say the thing somebody is actually searching for. Not the
// brand -- "Handoff3D" is a word nobody types -- but the problem: there is no
// Bambu Studio for iPad, and they have an iPad.
export const Hook: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill name="Hook" style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop />
      <Interactive.Div
        name="Hook line one"
        style={{
          position: "absolute",
          left: 84,
          right: 84,
          top: 790,
          textAlign: "center",
          color: brand.ink,
          fontFamily: font.display,
          fontSize: 104,
          fontWeight: 800,
          lineHeight: 1.04,
          letterSpacing: -2.4,
          opacity: interpolate(frame, [0, 14, 46, 56], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0, 20], ["0px 34px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        There is no Bambu Studio for iPad.
      </Interactive.Div>
      <Interactive.Div
        name="Hook line two"
        style={{
          position: "absolute",
          left: 84,
          right: 84,
          top: 828,
          textAlign: "center",
          color: brand.accent,
          fontFamily: font.display,
          fontSize: 116,
          fontWeight: 800,
          lineHeight: 1.04,
          letterSpacing: -2.6,
          opacity: interpolate(frame, [54, 68], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [54, 74], [0.9, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      >
        You do not need one.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
