import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { brand, font, IPAD } from "../brand";

// The landing screen, with a plain-shapes version of PlaneHero: the model
// leaves the iPad and lands on the printer's plate. Same claim the painting on
// the real page makes -- the thing crossed the room -- without shipping the
// painting into this repo, where it would go stale on its own.
const P0 = [58, 104] as const;
const P1 = [170, 22] as const;
const P2 = [276, 96] as const;

const at = (t: number): [number, number] => [
  (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t ** 2 * P2[0],
  (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t ** 2 * P2[1],
];

export const LandingScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const t = Math.min(1, Math.max(0, (frame - 10) / 54));
  const [px, py] = at(t);
  const [nx, ny] = at(Math.min(1, t + 0.02));
  const angle = (Math.atan2(ny - py, nx - px) * 180) / Math.PI;

  return (
    <div
      style={{
        width: IPAD.uiW,
        height: IPAD.uiH,
        background: brand.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "0 26px",
        textAlign: "center",
        fontFamily: font.ui,
      }}
    >
      <svg width={310} height={132} viewBox="0 0 338 132" style={{ display: "block" }}>
        <path
          d={`M${P0[0]} ${P0[1]} Q${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`}
          fill="none"
          stroke={brand.accent}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeDasharray="5 8"
          opacity={0.55}
          style={{
            clipPath: `inset(0 ${interpolate(frame, [10, 64], [100, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}% 0 0)`,
          }}
        />
        <rect x={30} y={78} width={40} height={52} rx={5} fill={brand.panel} stroke={brand.line} />
        <rect x={34} y={82} width={32} height={44} rx={3} fill={brand.bg} />
        <rect x={250} y={62} width={66} height={62} rx={6} fill={brand.panel} stroke={brand.line} />
        <rect x={256} y={68} width={54} height={40} rx={3} fill={brand.bg} />
        <rect x={258} y={104} width={50} height={4} rx={2} fill={brand.bedLine} />
        <g
          transform={`translate(${px} ${py}) rotate(${angle})`}
          opacity={t >= 1 ? 0 : 1}
        >
          <path d="M-9 -5 L9 0 L-9 5 L-5 0 Z" fill={brand.ink} />
        </g>
        <g
          opacity={interpolate(frame, [62, 74], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}
        >
          <ellipse cx={283} cy={104} rx={11} ry={3.2} fill="#000" opacity={0.4} />
          <path
            d="M274 104 C271 96 275 88 283 84 C291 88 295 96 292 104 Z"
            fill={brand.accent}
          />
        </g>
      </svg>
      <h1 style={{ fontSize: 27, margin: 0, letterSpacing: -0.6, fontWeight: 800, color: brand.ink }}>
        Handoff3D
      </h1>
      <p style={{ margin: 0, color: brand.accent, fontSize: 10.5, fontWeight: 700 }}>
        3D print... no computer necessary
      </p>
      <p style={{ margin: 0, color: brand.dim, fontSize: 9.5, lineHeight: 1.5, maxWidth: 250 }}>
        Drop in any model and get one your Bambu printer will take. Too big for your
        bed? Split it and spread it over as many plates as it needs.
      </p>
      <div
        style={{
          marginTop: 8,
          padding: "22px 34px",
          border: `2px dashed ${brand.line}`,
          borderRadius: 14,
          background: brand.panel,
          color: brand.accent,
          fontWeight: 700,
          fontSize: 11,
          scale: interpolate(frame, [78, 86, 94], [1, 0.95, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      >
        Choose a model
      </div>
      <p style={{ margin: 0, color: brand.dim, fontSize: 8.5 }}>
        Free. No account. Nothing to install.
      </p>
    </div>
  );
};
