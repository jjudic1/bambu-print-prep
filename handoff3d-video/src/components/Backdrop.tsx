import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { brand } from "../brand";

// The app's own background, with one slow green bloom behind the device so a
// static screen is never sitting on a flat rectangle.
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill name="Backdrop" style={{ backgroundColor: brand.bg }}>
      <AbsoluteFill
        name="Bloom"
        style={{
          background:
            "radial-gradient(60% 34% at 50% 62%, rgba(34,164,93,.20), rgba(34,164,93,0) 70%)",
          opacity: interpolate(frame, [0, 60, 180], [0.5, 1, 0.72], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      />
      <AbsoluteFill
        name="Vignette"
        style={{
          background: "radial-gradient(78% 52% at 50% 46%, rgba(0,0,0,0), rgba(0,0,0,.55))",
        }}
      />
    </AbsoluteFill>
  );
};
