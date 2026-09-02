import React from "react";
import { AbsoluteFill } from "remotion";
import { Wordmark } from "./components/Caption";
import { BeatScene } from "./scenes/ScreenScene";
import { DoneScreen } from "./screens/DoneScreen";
import { FlattenScreen } from "./screens/FlattenScreen";
import { LandingScreen } from "./screens/LandingScreen";
import { PlatesScreen } from "./screens/PlatesScreen";
import { PrinterScreen } from "./screens/PrinterScreen";
import { SizeScreen } from "./screens/SizeScreen";
import { StepsScreen } from "./screens/StepsScreen";

// Seven single-angle cuts, each leading with a different reason to care, so
// they can be posted in whatever order is landing rather than in a script
// order. Every claim on them is one the landing page or the guides already
// make -- a promo that overstates the app is worse than no promo.

export const NoComputerCut: React.FC = () => (
  <AbsoluteFill name="No computer cut">
    <BeatScene
      beats={[
        { eyebrow: "iPad only", line: <>There is no Bambu Studio for iPad.</>, at: 0 },
        { eyebrow: "So don't install one", line: <>This is just a web page in Safari.</>, at: 110 },
        { eyebrow: "Costs nothing", line: <>Free. No account. Nothing to install.</>, at: 230 },
      ]}
    >
      <LandingScreen />
    </BeatScene>
    <Wordmark delay={280} />
  </AbsoluteFill>
);

export const ResizeCut: React.FC = () => (
  <AbsoluteFill name="Resize cut">
    <BeatScene
      beats={[
        { eyebrow: "Any model", line: <>Downloaded something the wrong size?</>, at: 0 },
        { eyebrow: "In millimetres", line: <>Type the size you want. It is that size.</>, at: 105 },
        { eyebrow: "STL, 3MF, OBJ, PLY", line: <>Out comes a file your Bambu will take.</>, at: 215 },
      ]}
    >
      <SizeScreen />
    </BeatScene>
    <Wordmark delay={265} />
  </AbsoluteFill>
);

export const TooBigCut: React.FC = () => (
  <AbsoluteFill name="Too big cut">
    <BeatScene
      beats={[
        { eyebrow: "Bigger than the bed", line: <>Too big to print in one go?</>, at: 0 },
        { eyebrow: "Split", line: <>It goes over as many plates as it needs.</>, at: 115 },
        { eyebrow: "Arranged", line: <>Clear of the corner your printer keeps for itself.</>, at: 235 },
      ]}
    >
      <PlatesScreen />
    </BeatScene>
    <Wordmark delay={300} />
  </AbsoluteFill>
);

export const FlattenCut: React.FC = () => (
  <AbsoluteFill name="Flatten cut">
    <BeatScene
      beats={[
        { eyebrow: "Won't stand up", line: <>A curved bottom will not stay put.</>, at: 0 },
        { eyebrow: "One slider", line: <>Level it off and it sits flat on the plate.</>, at: 105 },
        { eyebrow: "Nothing else moves", line: <>Everything above the line is untouched.</>, at: 215 },
      ]}
    >
      <FlattenScreen />
    </BeatScene>
    <Wordmark delay={265} />
  </AbsoluteFill>
);

export const PrivacyCut: React.FC = () => (
  <AbsoluteFill name="Privacy cut">
    <BeatScene
      beats={[
        { eyebrow: "No upload", line: <>Your model never leaves your iPad.</>, at: 0 },
        { eyebrow: "No server", line: <>The file is written in the browser tab.</>, at: 105 },
        { eyebrow: "No account", line: <>Nothing to sign up for. Nothing to pay.</>, at: 215 },
      ]}
    >
      <DoneScreen />
    </BeatScene>
    <Wordmark delay={265} />
  </AbsoluteFill>
);

export const PrintersCut: React.FC = () => (
  <AbsoluteFill name="Printers cut">
    <BeatScene
      beats={[
        { eyebrow: "Every current machine", line: <>A1 mini to H2D Pro.</>, at: 0 },
        { eyebrow: "Every nozzle", line: <>0.2, 0.4, 0.6 and 0.8 mm.</>, at: 105 },
        { eyebrow: "Not guessed", line: <>Beds and settings from Bambu Studio's own profiles.</>, at: 215 },
      ]}
    >
      <PrinterScreen />
    </BeatScene>
    <Wordmark delay={265} />
  </AbsoluteFill>
);

export const HandoffCut: React.FC = () => (
  <AbsoluteFill name="Handoff cut">
    <BeatScene
      beats={[
        { eyebrow: "File made", line: <>Now how does it reach the printer?</>, at: 0 },
        { eyebrow: "Six steps", line: <>MakerWorld, set it Private, publish.</>, at: 115 },
        { eyebrow: "Then print", line: <>Open Bambu Handy and press go.</>, at: 235 },
      ]}
    >
      <StepsScreen />
    </BeatScene>
    <Wordmark delay={300} />
  </AbsoluteFill>
);
