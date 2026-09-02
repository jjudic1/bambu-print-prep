import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { brand, font, IPAD } from "../brand";

// The how-to-print sheet. The six headings and what sits under them are cut
// down from web/src/local/handoff.js -- that copy is the delivery loop
// somebody actually walked, so a reworded step here is a change to verified
// evidence, not to prose.
const STEPS: [string, string][] = [
  ["Get the file onto your iPad", "Save it into Files. iCloud Drive or On My iPad, either works."],
  ["Open MakerWorld in Safari", "Sign in once. It remembers you after that."],
  ["Upload it", "Tap Upload, then Choose file, and pick the file you just saved."],
  ["Add a picture", "Any real photo gets you through. The model is private."],
  ["Set it to Private, then Publish", "This matters. It keeps the model yours."],
  ["Open Bambu Handy and print it", "Profile, then 3D Models. Yours is at the top."],
];

export const StepsScreen: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        width: IPAD.uiW,
        height: IPAD.uiH,
        background: brand.bg,
        overflow: "hidden",
        fontFamily: font.ui,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          height: 28,
          flex: "0 0 28px",
          borderBottom: `1px solid ${brand.line}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          fontSize: 9,
          color: brand.dim,
          background: brand.panel,
        }}
      >
        <span>Done</span>
        <span style={{ color: brand.accent, fontWeight: 700 }}>Open MakerWorld</span>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <div
          style={{
            padding: "14px 18px",
          }}
        >
          <h1 style={{ margin: "0 0 3px", fontSize: 16, color: brand.ink, letterSpacing: -0.4 }}>
            How to print lantern.3mf
          </h1>
          <p style={{ margin: "0 0 14px", fontSize: 8.5, color: brand.dim }}>
            The same steps every time. Prepared today.
          </p>
          {STEPS.map(([head, text], i) => (
            <div
              key={head}
              style={{
                display: "flex",
                gap: 9,
                marginBottom: 7,
                padding: "5px 7px",
                borderRadius: 9,
                background: brand.panel,
                border: `1px solid ${brand.line}`,
                opacity: interpolate(frame, [6 + i * 8, 20 + i * 8], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              <span
                style={{
                  flex: "0 0 19px",
                  height: 19,
                  borderRadius: 999,
                  background: brand.accent,
                  color: brand.accentInk,
                  fontWeight: 800,
                  fontSize: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: brand.ink, lineHeight: 1.3 }}>
                  {head}
                </div>
                <div style={{ fontSize: 8.5, color: brand.dim, marginTop: 2, lineHeight: 1.45 }}>
                  {text}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
