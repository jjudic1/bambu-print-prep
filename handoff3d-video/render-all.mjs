// Renders every cut to out/, named for posting.
//
// Rendering is free -- it is Chrome and ffmpeg on this machine, no API calls --
// so re-run the lot after any copy change rather than trying to work out which
// ones moved.

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const CUTS = [
  ["HeroPromo", "hero-27s"],
  ["HeroShort", "hero-15s"],
  ["NoComputerCut", "no-computer-12s"],
  ["ResizeCut", "resize-11s"],
  ["TooBigCut", "too-big-12s"],
  ["FlattenCut", "flatten-11s"],
  ["PrivacyCut", "privacy-11s"],
  ["PrintersCut", "printers-11s"],
  ["HandoffCut", "handoff-12s"],
];

mkdirSync("out", { recursive: true });

for (const [id, slug] of CUTS) {
  const out = `out/handoff3d-${slug}-1080x1920.mp4`;
  process.stdout.write(`${id} -> ${out}\n`);
  execFileSync("npx", ["remotion", "render", id, out], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: true,
  });
}

process.stdout.write(`\nRendered ${CUTS.length} cuts.\n`);
