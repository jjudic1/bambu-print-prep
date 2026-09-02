import React from "react";
import { Composition, Folder } from "remotion";
import { HeroPromo, HeroShort } from "./HeroPromo";
import {
  FlattenCut,
  HandoffCut,
  NoComputerCut,
  PrintersCut,
  PrivacyCut,
  ResizeCut,
  TooBigCut,
} from "./Variations";

// Nine cuts on one 1080x1920 canvas -- the native frame for YouTube Shorts,
// TikTok and Instagram Reels alike. Two hero lengths, then seven single-angle
// cuts, so there is something different to post each week without re-editing.
export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="HeroPromo"
      component={HeroPromo}
      durationInFrames={810}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id="HeroShort"
      component={HeroShort}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
    />
    <Folder name="Single-angle-cuts">
      <Composition
        id="NoComputerCut"
        component={NoComputerCut}
        durationInFrames={360}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="ResizeCut"
        component={ResizeCut}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="TooBigCut"
        component={TooBigCut}
        durationInFrames={360}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="FlattenCut"
        component={FlattenCut}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PrivacyCut"
        component={PrivacyCut}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="PrintersCut"
        component={PrintersCut}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="HandoffCut"
        component={HandoffCut}
        durationInFrames={360}
        fps={30}
        width={1080}
        height={1920}
      />
    </Folder>
  </>
);
