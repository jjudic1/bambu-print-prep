import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Plate } from "../components/Plate";
import { Field, Panel, PanelHead, Reason, Slider, Swatches, Ticks } from "../components/Panel";

// "Flatten the bottom" -- the one control that is not a port of the command
// line version. The user picks the height, so there is no search and no
// ceiling; the model loses the curve it was balancing on and sits flat.
export const FlattenScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const off = interpolate(frame, [16, 62], [0, 9], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <Plate
        parts={[
          { x: 169, y: 145, w: 58, h: 76, shape: "vase", color: 3, cut: off / 76 },
        ]}
        badge="Plate 1"
      />
      <Panel>
        <PanelHead name="pebble-lamp.3mf" right="on your device" />
        <Field
          label="Flatten the bottom"
          value={off < 0.5 ? "nothing off" : `${off.toFixed(1)} mm off`}
        >
          <Slider
            pct={interpolate(frame, [16, 62], [0, 34], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
        </Field>
        <Reason>
          Levels off the bottom so it sits flat on the plate instead of balancing
          on a curve or a point. Nothing above the line moves.
        </Reason>
        <Field label="Which way up">
          <Ticks items={["Tip forward", "Tip back", "Tip left", "Tip right", "Lay it down"]} />
        </Field>
        <Field label="Turn it round" value="0 deg">
          <Slider pct={0} />
        </Field>
        <Field label="Colour" value="a picture, not a print instruction">
          <Swatches on={3} />
        </Field>
      </Panel>
    </>
  );
};
