import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Plate } from "../components/Plate";
import { Field, Go, Panel, PanelHead, Reason, Select, Ticks } from "../components/Panel";

// Too big for the bed: it is cut into parts and the parts are laid out over as
// many plates as they need. Arrange steps around the shaded corner -- the
// 18 x 28 mm the machine purges into -- which is the trap that makes a file
// open fine on every screen and get refused at slice time.
const HOME: [number, number][] = [
  [169, 123],
  [213, 144],
  [125, 144],
  [169, 164],
];

export const PlatesScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const spread = interpolate(frame, [24, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <Plate
        parts={HOME.map(([hx, hy], i) => ({
          x: 169 + (hx - 169) * spread,
          y: 145 + (hy - 145) * spread,
          w: 38,
          h: 46,
          shape: "bust" as const,
          color: i + 1,
        }))}
        badge="Plate 1 of 2"
      />
      <Panel>
        <PanelHead name="gatekeeper.stl" right="on your device" />
        <Field label="Plates">
          <Ticks items={["Plate 1 - 4", "Plate 2 - 2", "+ Add"]} on={0} />
        </Field>
        <Field label="On this plate" value="tap one to turn just that part">
          <Ticks
            items={["Everything", "Part 1", "Part 2", "Part 3", "Part 4"]}
            on={0}
            dots={[undefined as unknown as number, 1, 2, 3, 4]}
          />
        </Field>
        <Reason>
          Bigger than your bed is not the end of it. The model is split, the
          pieces are laid out clear of the corner your printer keeps for itself,
          and they go on as many plates as they need.
        </Reason>
        <Field label="Your printer">
          <Select text="Bambu Lab P1S - bed 256 x 256 mm" />
        </Field>
        <Go label="Make the file" />
      </Panel>
    </>
  );
};
