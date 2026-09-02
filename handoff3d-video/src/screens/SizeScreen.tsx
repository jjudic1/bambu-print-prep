import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Plate } from "../components/Plate";
import { Field, Panel, PanelHead, Reason, Select, Slider, Ticks } from "../components/Panel";

// "How big" -- a number in millimetres, and the model on the plate follows it.
// The numbers on screen are the app's own: the slider runs 10 mm to the length
// of the bed, and Keychain / Desk size are the two ticks it offers.
export const SizeScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const mm = Math.round(
    interpolate(frame, [12, 66], [35, 118], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );

  return (
    <>
      <Plate
        parts={[
          {
            x: 169,
            y: 145,
            w: mm * 0.5,
            h: mm * 0.62,
            shape: "vase",
            color: 1,
          },
        ]}
        badge="Plate 1"
      />
      <Panel>
        <PanelHead name="lantern.stl" right="on your device" />
        <Field label="Your printer">
          <Select text="Bambu Lab P1S - bed 256 x 256 mm" />
        </Field>
        <Field label="Nozzle" value="the one it came with">
          <Ticks items={["0.2", "0.4", "0.6", "0.8"]} on={1} />
        </Field>
        <Field label="Material">
          <Select text="PLA" />
        </Field>
        <Field label="How big" value={`${mm} x ${Math.round(mm * 0.61)} x ${Math.round(mm * 1.0)} mm`}>
          <Slider
            pct={interpolate(frame, [12, 66], [10, 46], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          />
          <Ticks items={["Keychain", "Desk size", "Original size"]} on={mm > 90 ? 1 : 0} />
        </Field>
        <Reason>
          Type the size you want and it is that size. Every measurement on this
          panel is millimetres, the same units your printer works in.
        </Reason>
      </Panel>
    </>
  );
};
