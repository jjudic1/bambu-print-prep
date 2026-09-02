import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Plate } from "../components/Plate";
import { Field, Panel, PanelHead, Reason, Select, Ticks } from "../components/Panel";

// Bed size and print settings come from Bambu Studio's own vendored profiles,
// so the machine list here is the real one and every bed number is theirs.
// A nozzle is a printer, not a setting -- the two selects set one value.
const MACHINES = [
  "Bambu Lab P1S - bed 256 x 256 mm",
  "Bambu Lab A1 mini - bed 180 x 180 mm",
  "Bambu Lab X1 Carbon - bed 256 x 256 mm",
  "Bambu Lab H2D - bed 350 x 320 mm",
];

export const PrinterScreen: React.FC = () => {
  const frame = useCurrentFrame();
  const which = Math.min(
    MACHINES.length - 1,
    Math.floor(
      interpolate(frame, [14, 78], [0, MACHINES.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    ),
  );

  return (
    <>
      <Plate
        parts={[{ x: 169, y: 145, w: 54, h: 70, shape: "vase", color: 2 }]}
        badge="Plate 1"
      />
      <Panel>
        <PanelHead name="planter.3mf" right="on your device" />
        <Field label="Your printer">
          <Select text={MACHINES[which]} />
        </Field>
        <Field label="Nozzle" value="0.4 mm">
          <Ticks items={["0.2", "0.4", "0.6", "0.8"]} on={1} />
        </Field>
        <Reason>
          A1 mini, A1, P1P, P1S, P2S, X1, X1 Carbon, X1E, X2D, A2L, H2C, H2S,
          H2D and H2D Pro, in every nozzle size. The bed and the print settings
          are read from Bambu Studio's own profiles, not guessed at.
        </Reason>
      </Panel>
    </>
  );
};
