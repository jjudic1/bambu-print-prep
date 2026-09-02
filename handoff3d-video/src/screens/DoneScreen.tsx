import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { brand, font } from "../brand";
import { Plate } from "../components/Plate";
import { Go, Panel, PanelHead, Secondary } from "../components/Panel";

// Make the file, and what the app says once it exists. The line is the app's
// own -- part count, plate count, size in KB, "Written on this device." -- and
// Save the file is the one that matters: it lands in Files, and that is the
// handoff the whole product is named after.
export const DoneScreen: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <>
      <Plate
        parts={[{ x: 169, y: 145, w: 56, h: 74, shape: "vase", color: 1 }]}
        badge="Plate 1"
      />
      <Panel>
        <PanelHead name="lantern.stl" right="on your device" />
        <div
          style={{
            opacity: interpolate(frame, [0, 6, 26, 34], [1, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            height: interpolate(frame, [26, 34], [40, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            overflow: "hidden",
          }}
        >
          <Go
            label="Make the file"
            glow={interpolate(frame, [4, 16, 30], [0, 26, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 9,
            color: brand.ink,
            fontFamily: font.ui,
            opacity: interpolate(frame, [34, 46], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          1 part across 1 plate, 412 KB. Written on this device.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            opacity: interpolate(frame, [40, 54], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: interpolate(frame, [40, 54], ["0px 10px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <Secondary label="Save the file" accent />
          <Secondary label="How to print it" />
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ flex: 1 }}>
              <Secondary label="Save the picture" />
            </div>
            <div style={{ flex: 1 }}>
              <Secondary label="Save the steps too" />
            </div>
          </div>
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 8,
            lineHeight: 1.45,
            color: brand.dim,
            fontFamily: font.ui,
            opacity: interpolate(frame, [52, 66], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          Save the file into Files - that is the one the printer needs. The steps
          walk you through MakerWorld and Bambu Handy.
        </p>
      </Panel>
    </>
  );
};
