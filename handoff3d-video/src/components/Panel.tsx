import React from "react";
import { brand, font, IPAD, UI } from "../brand";

// The control panel, rebuilt from web/src/styles.css in the 338-wide authoring
// space. Every rule here has a counterpart there -- the pill ticks, the green
// button, the uppercase field labels, the dim "reason" prose under a control.
// It is a replica rather than a screenshot so the copy can be re-cut per video.

export const Panel: React.FC<{ children: React.ReactNode; scroll?: number }> = ({
  children,
  scroll = 0,
}) => (
  <div
    style={{
      width: IPAD.uiW,
      height: UI.panelH,
      overflow: "hidden",
      background: brand.panel,
      borderTop: `1px solid ${brand.line}`,
    }}
  >
    <div
      style={{
        padding: "11px 13px",
        display: "flex",
        flexDirection: "column",
        gap: 11,
        translate: `0px ${-scroll}px`,
      }}
    >
      {children}
    </div>
  </div>
);

export const PanelHead: React.FC<{ name: string; right: string }> = ({ name, right }) => (
  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
    <strong style={{ fontSize: 11, color: brand.ink, fontFamily: font.ui }}>{name}</strong>
    <span
      style={{
        fontSize: 7,
        letterSpacing: 0.7,
        textTransform: "uppercase",
        color: brand.dim,
        fontWeight: 700,
        fontFamily: font.ui,
      }}
    >
      {right}
    </span>
  </div>
);

export const Field: React.FC<{
  label: string;
  value?: string;
  children?: React.ReactNode;
}> = ({ label, value, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 5, fontFamily: font.ui }}>
    <span
      style={{
        fontSize: 7.5,
        letterSpacing: 0.5,
        textTransform: "uppercase",
        color: brand.dim,
        display: "flex",
        justifyContent: "space-between",
        gap: 6,
      }}
    >
      {label}
      {value ? (
        <em style={{ fontStyle: "normal", textTransform: "none", letterSpacing: 0, color: brand.ink }}>
          {value}
        </em>
      ) : null}
    </span>
    {children}
  </div>
);

export const Slider: React.FC<{ pct: number }> = ({ pct }) => (
  <div style={{ height: 12, display: "flex", alignItems: "center" }}>
    <div style={{ position: "relative", width: "100%", height: 3, borderRadius: 2, background: brand.line }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: 3,
          borderRadius: 2,
          background: brand.accent,
          width: `${pct}%`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -4.5,
          left: `${pct}%`,
          width: 12,
          height: 12,
          marginLeft: -6,
          borderRadius: 999,
          background: brand.accent,
        }}
      />
    </div>
  </div>
);

export const Ticks: React.FC<{ items: string[]; on?: number; dots?: number[] }> = ({
  items,
  on,
  dots,
}) => (
  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", fontFamily: font.ui }}>
    {items.map((label, i) => (
      <span
        key={label}
        style={{
          background: brand.well,
          border: `1px solid ${i === on ? brand.accent : brand.line}`,
          borderRadius: 999,
          padding: "3.5px 7px",
          fontSize: 8,
          color: i === on ? brand.ink : brand.dim,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {dots && dots[i] !== undefined ? (
          <i
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: brand.fil[dots[i] % brand.fil.length],
              display: "block",
            }}
          />
        ) : null}
        {label}
      </span>
    ))}
  </div>
);

export const Select: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      background: brand.well,
      border: `1px solid ${brand.line}`,
      borderRadius: 8,
      padding: "6px 7px",
      fontSize: 9,
      color: brand.ink,
      fontFamily: font.ui,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}
  >
    {text}
    <span style={{ color: brand.dim, fontSize: 7 }}>v</span>
  </div>
);

export const Reason: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ margin: 0, fontSize: 8, lineHeight: 1.45, color: brand.dim, fontFamily: font.ui }}>
    {children}
  </p>
);

export const Go: React.FC<{ label: string; glow?: number }> = ({ label, glow = 0 }) => (
  <div
    style={{
      background: brand.accent,
      borderRadius: 10,
      color: brand.accentInk,
      fontWeight: 800,
      fontSize: 10,
      padding: "9px",
      textAlign: "center",
      fontFamily: font.ui,
      boxShadow: `0 0 ${glow}px rgba(34,164,93,.75)`,
    }}
  >
    {label}
  </div>
);

export const Secondary: React.FC<{ label: string; accent?: boolean }> = ({ label, accent }) => (
  <div
    style={{
      background: brand.well,
      border: `1px solid ${brand.line}`,
      borderRadius: 8,
      padding: "6.5px 8px",
      textAlign: "center",
      fontWeight: 700,
      fontSize: 9,
      color: accent ? brand.accent : brand.ink,
      fontFamily: font.ui,
    }}
  >
    {label}
  </div>
);

export const Swatches: React.FC<{ on: number }> = ({ on }) => (
  <div style={{ display: "flex", gap: 4.5 }}>
    {brand.fil.map((c, i) => (
      <span
        key={c}
        style={{
          width: 16,
          height: 16,
          borderRadius: 999,
          background: c,
          border: `2px solid ${i === on ? brand.ink : "transparent"}`,
          display: "block",
        }}
      />
    ))}
  </div>
);
