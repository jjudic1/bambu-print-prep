import React from "react";
import { brand } from "../brand";

// Silhouettes authored in a 0..100 box with the model's base at y=100, so the
// bottom of the shape is what stands on the plate. The vase has a rounded
// bottom on purpose: it is the shape that makes "Flatten the bottom" mean
// something, and a box would demonstrate nothing.
export const SHAPES = {
  vase: "M50 4 C36 12 31 26 33 42 C18 56 15 84 50 96 C85 84 82 56 67 42 C69 26 64 12 50 4 Z",
  bust: "M50 3 C33 3 27 17 29 30 C20 36 18 48 24 56 C14 63 9 80 12 96 L88 96 C91 80 86 63 76 56 C82 48 80 36 71 30 C73 17 67 3 50 3 Z",
  bracket: "M8 96 L8 20 C8 12 14 6 22 6 L78 6 C86 6 92 12 92 20 L92 40 L64 40 L64 96 Z",
} as const;

export type ShapeName = keyof typeof SHAPES;

export type PartSpec = {
  /** Where the base of the model sits, in the plate SVG's own pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  shape: ShapeName;
  /** Index into brand.fil. */
  color: number;
  /** How much of the bottom has been levelled off, 0..1 of the height. */
  cut?: number;
  /** Dimmed and outlined -- the plate's "this part is not selected" look. */
  faded?: boolean;
};

// One part, drawn as a lit silhouette with a contact shadow. Not a render: at
// 1080 wide on a phone the difference between this and a real one is the
// shadow, and the shadow is what says "standing on the plate".
export const Model: React.FC<{ part: PartSpec; id: string }> = ({ part, id }) => {
  const cut = part.cut ?? 0;
  const fill = brand.fil[part.color % brand.fil.length];

  return (
    <g opacity={part.faded ? 0.42 : 1}>
      <ellipse
        cx={part.x}
        cy={part.y}
        rx={part.w * 0.46}
        ry={part.w * 0.15}
        fill="#000"
        opacity={0.38}
      />
      <defs>
        <clipPath id={`cut-${id}`}>
          <rect x={-20} y={-20} width={140} height={120 - cut * 100} />
        </clipPath>
        <linearGradient id={`lit-${id}`} x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0" stopColor="#fff" stopOpacity={0.34} />
          <stop offset="0.45" stopColor="#fff" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.4} />
        </linearGradient>
      </defs>
      <g
        transform={`translate(${part.x} ${part.y}) scale(${part.w / 100} ${part.h / 100}) translate(-50 ${-100 + cut * 100})`}
      >
        <g clipPath={`url(#cut-${id})`}>
          <path d={SHAPES[part.shape]} fill={fill} />
          <path d={SHAPES[part.shape]} fill={`url(#lit-${id})`} />
        </g>
      </g>
    </g>
  );
};
