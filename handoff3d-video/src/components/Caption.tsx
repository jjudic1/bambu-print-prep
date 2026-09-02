import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { brand, font } from "../brand";

// The band above the device. These autoplay muted everywhere they are posted,
// so the burned-in caption carries the whole story -- nothing here may depend
// on sound. Headline is 88px, above the 84px floor for a 1080-wide frame, and
// the block is inset 84px so nothing lands under a platform's UI.
export const Caption: React.FC<{
  eyebrow?: string;
  children: React.ReactNode;
  top?: number;
}> = ({ eyebrow, children, top = 208 }) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 84,
        right: 84,
        top,
        textAlign: "center",
        opacity: interpolate(frame, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: interpolate(frame, [0, 18], ["0px 26px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {eyebrow ? (
        <div
          style={{
            color: brand.accent,
            fontFamily: font.ui,
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: 3.4,
            textTransform: "uppercase",
            marginBottom: 18,
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <div
        style={{
          color: brand.ink,
          fontFamily: font.display,
          fontSize: 88,
          lineHeight: 1.08,
          fontWeight: 800,
          letterSpacing: -1.8,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export type Beat = { eyebrow?: string; line: React.ReactNode; at: number };

// Two or three things to say across one cut. This is what stops a single-screen
// short reading as a screenshot with a timer on it: the screen can stay put as
// long as the caption keeps arriving with something new.
export const BeatCaption: React.FC<{ beats: Beat[]; top?: number }> = ({
  beats,
  top = 208,
}) => {
  const frame = useCurrentFrame();

  return (
    <>
      {beats.map((beat, i) => {
        const next = beats[i + 1]?.at ?? Infinity;
        const out = Math.min(next, beat.at + 400);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 84,
              right: 84,
              top,
              textAlign: "center",
              opacity: interpolate(
                frame,
                [beat.at, beat.at + 11, out - 9, out],
                [0, 1, 1, 0],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              ),
              translate: interpolate(
                frame,
                [beat.at, beat.at + 22, out],
                ["0px 30px", "0px 0px", "0px -16px"],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              ),
            }}
          >
            {beat.eyebrow ? (
              <div
                style={{
                  color: brand.accent,
                  fontFamily: font.ui,
                  fontSize: 32,
                  fontWeight: 800,
                  letterSpacing: 3.2,
                  textTransform: "uppercase",
                  marginBottom: 16,
                }}
              >
                {beat.eyebrow}
              </div>
            ) : null}
            <div
              style={{
                color: brand.ink,
                fontFamily: font.display,
                fontSize: 84,
                lineHeight: 1.08,
                fontWeight: 800,
                letterSpacing: -1.7,
              }}
            >
              {beat.line}
            </div>
          </div>
        );
      })}
    </>
  );
};

// The strap along the bottom of every cut: what it is called and where it is.
export const Wordmark: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 58,
        textAlign: "center",
        fontFamily: font.ui,
        opacity: interpolate(frame, [delay, delay + 16], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div style={{ color: brand.ink, fontSize: 40, fontWeight: 800, letterSpacing: -0.5 }}>
        Handoff3D
      </div>
      <div style={{ color: brand.accent, fontSize: 27, fontWeight: 700, marginTop: 6 }}>
        bambu-print-prep.vercel.app
      </div>
    </div>
  );
};
