import React from "react";
import { brand, IPAD } from "../brand";

// A portrait iPad holding the app. The screen contents are authored at
// 338x451 and scaled by IPAD.scale, exactly as the real app lays itself out at
// that aspect -- so the panel text re-lays out at size rather than blurring.
export const Ipad: React.FC<{ children: React.ReactNode; push?: number }> = ({
  children,
  push = 1,
}) => (
  <div
    style={{
      position: "absolute",
      left: (1080 - IPAD.width) / 2,
      top: IPAD.top,
      width: IPAD.width,
      height: IPAD.height,
      borderRadius: 46,
      background: "linear-gradient(160deg,#2b3037,#15181c 60%,#23272d)",
      padding: IPAD.padding,
      boxShadow: "0 46px 90px rgba(0,0,0,.62), 0 0 0 1px rgba(255,255,255,.06)",
      scale: push,
    }}
  >
    <div
      style={{
        width: IPAD.screenW,
        height: IPAD.screenH,
        borderRadius: 26,
        overflow: "hidden",
        background: brand.bg,
      }}
    >
      <div
        style={{
          width: IPAD.uiW,
          height: IPAD.uiH,
          transformOrigin: "0 0",
          scale: IPAD.scale,
        }}
      >
        {children}
      </div>
    </div>
  </div>
);
