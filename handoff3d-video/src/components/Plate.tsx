import React from "react";
import { brand, IPAD, UI } from "../brand";
import { Model, type PartSpec } from "./Model";

// The bed, drawn the way PlateViewer.jsx draws it: a plate seen from a low
// angle, with a grid, and the corner the machine keeps for itself shaded out.
// Isometric, so bed millimetres map to plate pixels through iso().
const OX = IPAD.uiW / 2;
const OY = 96;
const KX = 0.4;
const KY = 0.19;
const BED = 256;

const iso = (bx: number, by: number): [number, number] => [
  OX + (bx - by) * KX,
  OY + (bx + by) * KY,
];

const poly = (pts: [number, number][]) =>
  pts.map(([bx, by]) => iso(bx, by).join(",")).join(" ");

export const Plate: React.FC<{
  parts: PartSpec[];
  /** The 18 x 28 mm corner a P1/X1 purges into. The A1 family has none. */
  keepOut?: boolean;
  /** Label in the corner of the viewer, e.g. "Plate 1 of 2". */
  badge?: string;
  /** Nudges the whole bed, for the slow camera push. */
  lift?: number;
}> = ({ parts, keepOut = true, badge, lift = 0 }) => (
  <svg
    width={IPAD.uiW}
    height={UI.plateH}
    viewBox={`0 0 ${IPAD.uiW} ${UI.plateH}`}
    style={{ display: "block", background: brand.bg }}
  >
    <g transform={`translate(0 ${lift})`}>
      <polygon
        points={poly([[0, 0], [BED, 0], [BED, BED], [0, BED]])}
        fill={brand.bed}
        stroke={brand.bedLine}
        strokeWidth={1}
      />
      {[32, 64, 96, 128, 160, 192, 224].map((t) => (
        <g key={t} stroke={brand.bedLine} strokeWidth={0.5} opacity={0.75}>
          <line x1={iso(t, 0)[0]} y1={iso(t, 0)[1]} x2={iso(t, BED)[0]} y2={iso(t, BED)[1]} />
          <line x1={iso(0, t)[0]} y1={iso(0, t)[1]} x2={iso(BED, t)[0]} y2={iso(BED, t)[1]} />
        </g>
      ))}
      {keepOut && (
        <polygon
          points={poly([[0, 228], [18, 228], [18, 256], [0, 256]])}
          fill={brand.keepOut}
          stroke={brand.warn}
          strokeWidth={0.7}
          opacity={0.9}
        />
      )}
      {parts.map((part, i) => (
        <Model key={i} part={part} id={`p${i}`} />
      ))}
    </g>
    {badge && (
      <text
        x={12}
        y={UI.plateH - 10}
        fill={brand.dim}
        fontSize={9}
        fontWeight={700}
        letterSpacing={0.6}
        fontFamily='-apple-system,"Segoe UI",sans-serif'
      >
        {badge}
      </text>
    )}
  </svg>
);
