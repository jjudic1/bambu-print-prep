import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { EndCard } from "./scenes/EndCard";
import { Hook } from "./scenes/Hook";
import { ScreenScene } from "./scenes/ScreenScene";
import { DoneScreen } from "./screens/DoneScreen";
import { FlattenScreen } from "./screens/FlattenScreen";
import { LandingScreen } from "./screens/LandingScreen";
import { PlatesScreen } from "./screens/PlatesScreen";
import { SizeScreen } from "./screens/SizeScreen";
import { StepsScreen } from "./screens/StepsScreen";

// 27 seconds, hard cuts. The cuts supply the movement, so each scene holds one
// caption and lets its screen do the talking -- the opposite of the eleven
// second single-angle cuts, which have to generate their own.
export const HeroPromo: React.FC = () => (
  <AbsoluteFill name="Hero promo">
    <Sequence name="Hook" durationInFrames={90}>
      <Hook />
    </Sequence>
    <Sequence name="Open the page" from={90} durationInFrames={120}>
      <ScreenScene eyebrow="Step one" caption={<>Open a web page.<br />That is the install.</>}>
        <LandingScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Size it" from={210} durationInFrames={120}>
      <ScreenScene eyebrow="Any size you like" caption={<>Say how big,<br />in millimetres.</>}>
        <SizeScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Flatten it" from={330} durationInFrames={105}>
      <ScreenScene eyebrow="Stands up" caption={<>Level the bottom<br />so it sits flat.</>}>
        <FlattenScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Split it" from={435} durationInFrames={120}>
      <ScreenScene eyebrow="Bigger than the bed" caption={<>Split it across<br />as many plates as it needs.</>}>
        <PlatesScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Make the file" from={555} durationInFrames={105}>
      <ScreenScene eyebrow="On your device" caption={<>Out comes a Bambu<br />project file.</>}>
        <DoneScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Print it" from={660} durationInFrames={90}>
      <ScreenScene eyebrow="Six steps" caption={<>MakerWorld, then<br />Bambu Handy. Print.</>}>
        <StepsScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="End card" from={750} durationInFrames={60}>
      <EndCard />
    </Sequence>
  </AbsoluteFill>
);

// The same story at a pace that suits placements favouring sub-15s.
export const HeroShort: React.FC = () => (
  <AbsoluteFill name="Hero short">
    <Sequence name="Hook" durationInFrames={60}>
      <Hook />
    </Sequence>
    <Sequence name="Size it" from={60} durationInFrames={90}>
      <ScreenScene eyebrow="On an iPad" caption={<>Say how big,<br />in millimetres.</>}>
        <SizeScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Flatten it" from={150} durationInFrames={80}>
      <ScreenScene eyebrow="Stands up" caption={<>Level the bottom<br />so it sits flat.</>}>
        <FlattenScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Split it" from={230} durationInFrames={100}>
      <ScreenScene eyebrow="Too big?" caption={<>Split it over<br />as many plates as it needs.</>}>
        <PlatesScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="Make the file" from={330} durationInFrames={70}>
      <ScreenScene eyebrow="No upload" caption={<>The file is written<br />on your iPad.</>}>
        <DoneScreen />
      </ScreenScene>
    </Sequence>
    <Sequence name="End card" from={400} durationInFrames={50}>
      <EndCard />
    </Sequence>
  </AbsoluteFill>
);
