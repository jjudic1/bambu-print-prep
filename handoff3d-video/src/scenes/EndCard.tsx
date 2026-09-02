import React from "react";
import { AbsoluteFill, Interactive, interpolate, useCurrentFrame } from "remotion";
import { brand, font } from "../brand";
import { Backdrop } from "../components/Backdrop";

// The address, and the three things that decide whether anybody opens it.
// Every claim here is one the landing page already makes.
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill name="End card" style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop />
      <Interactive.Div
        name="Brand"
        style={{
          position: "absolute",
          left: 84,
          right: 84,
          top: 800,
          textAlign: "center",
          color: brand.ink,
          fontFamily: font.display,
          fontSize: 118,
          fontWeight: 800,
          letterSpacing: -2.6,
          opacity: interpolate(frame, [0, 14], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          scale: interpolate(frame, [0, 22], [0.92, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      >
        Handoff3D
      </Interactive.Div>
      <Interactive.Div
        name="Address"
        style={{
          position: "absolute",
          left: 84,
          right: 84,
          top: 952,
          textAlign: "center",
          color: brand.accent,
          fontFamily: font.ui,
          fontSize: 52,
          fontWeight: 700,
          opacity: interpolate(frame, [10, 26], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        bambu-print-prep.vercel.app
      </Interactive.Div>
      <Interactive.Div
        name="Claims"
        style={{
          position: "absolute",
          left: 84,
          right: 84,
          top: 1052,
          textAlign: "center",
          color: brand.dim,
          fontFamily: font.ui,
          fontSize: 44,
          lineHeight: 1.6,
          fontWeight: 600,
          opacity: interpolate(frame, [20, 36], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Free. No account. Nothing installed.
        <br />
        Your model never leaves your iPad.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
