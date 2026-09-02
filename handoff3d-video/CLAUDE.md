# handoff3d-video

Vertical promo videos for **Handoff3D** -- YouTube Shorts, TikTok, Instagram
Reels. Built with [Remotion](https://remotion.dev): React components rendered to
MP4 locally, through the Chrome and ffmpeg already on this machine.

## Why Remotion and not Sora

Every render costs **nothing**. A 27-second clip through `sora-2` would be about
$2.70, and every revision another $2.70. These are UI-driven promos where the
product *is* the footage, so there is nothing for a generative model to add. The
shared `_shared/openai-media/` rule about confirming video spend does not apply
here -- nothing in this project calls an API.

Licensing: Remotion is free for individuals, commercial use included.

## Run it

```powershell
npm run dev --prefix handoff3d-video      # Remotion Studio on http://localhost:8142
npx remotion render ResizeCut out/x.mp4
npx remotion still HeroPromo out/frame.png --frame=180 --scale=0.5
npm run render:all                        # all nine, ~4 minutes, free
npm run lint                              # eslint + tsc
```

Port **8142** is this project's, registered in the shared ports table. Studio
defaults to 3000, which Next.js owns -- hence the `--port` flag in
`package.json`.

## Compositions

| id | Length | Angle |
|---|---|---|
| `HeroPromo` | 27s | The full cut: hook -> open the page -> size -> flatten -> split -> file -> steps -> end card |
| `HeroShort` | 15s | Same story, harder pace, for placements that favour sub-15s |
| `NoComputerCut` | 12s | There is no Bambu Studio for iPad, and you do not need one |
| `ResizeCut` | 11s | Type a size in millimetres |
| `TooBigCut` | 12s | Bigger than the bed: split it over as many plates as it needs |
| `FlattenCut` | 11s | Level the bottom so it stands on the plate |
| `PrivacyCut` | 11s | No upload, no server, no account |
| `PrintersCut` | 11s | Every current machine, every nozzle, beds from Bambu's own profiles |
| `HandoffCut` | 12s | MakerWorld, then Bambu Handy -- the delivery loop |

All nine are 1080x1920 at 30fps, the native frame for all three platforms.
`npm run render:all` writes every one to `out/` under a posting-friendly name.

Nine is deliberate: one a week is two months of posting without re-editing, and
the seven single-angle cuts each lead with a different reason to care, so they
can be ordered by whatever is landing rather than by a script.

## Making a cut that is not boring

A one-screen cut has to generate its own movement, or it reads as a screenshot
with a timer on it. Two mechanisms carry that:

- **`BeatCaption`** -- three captions across the cut, each with its own eyebrow,
  cross-fading and drifting up as it lands. This is the big one: it gives a
  short a second and third thing to *say*, which is what actually holds someone,
  and it lets one screen carry three claims.
- **Camera push** -- the iPad goes 1 -> ~1.07 over the whole cut. Small enough
  not to notice, large enough that the frame is never static.

Each screen also animates something real: the size slider runs 35 mm to 118 mm
and the model follows it, the flatten slider takes 9 mm off the bottom and the
curve becomes a flat face, the four split parts spread from a pile to their
arranged positions.

The hero is the exception: it cuts between seven scenes, so the cuts supply the
movement and `ScreenScene` (one fixed caption) is right there.

## Where the design comes from

`src/brand.ts` lifts its tokens from `../web/src/styles.css` -- the same
`#101215`, `#171a1f`, `#22a45d`. If a colour changes there, change it here, or
the promos and the product drift apart.

The app UI is authored at **338x451** (the 3:4 of a portrait iPad) and scaled up
by `IPAD.scale`, so text re-lays out at size instead of being a magnified
bitmap. `src/components/Panel.tsx` is a replica of the real control panel, not a
screenshot, so the copy can be re-cut per video without a screen-recording pass.

Fonts are the system stack, exactly as the app uses it. No webfont: nothing here
is a wordmark, and matching the product matters more than a display face.

## Copy discipline

Every claim on screen is one `web/index.html` or `web/guides.mjs` already makes
-- free, no account, nothing installed, the model never leaves the device, the
machine list, the six handoff steps. **If a claim changes there, change it
here.** A promo that overstates the app is worse than no promo.

The six step headings in `StepsScreen` are verbatim from
`web/src/local/handoff.js`, which is the delivery loop somebody actually walked.
A reworded step is a change to verified evidence, not to prose.

Note the §6 jargon ban does not fully apply: like the static guide pages in
`web/public/`, these say "Bambu Studio", "STL" and "3MF" on purpose -- they are
the words somebody types into a search box, and a promo avoiding them cannot be
found by the people looking for them. The app's own strings still obey the rule.

These autoplay muted on every platform, so the burned-in captions carry the
whole story. Nothing here may depend on sound.

## Remotion rules that bite

- Animate with `useCurrentFrame()` + `interpolate()`. **CSS `transition` and
  `animation` do not render** -- they look right in Studio and come out static.
- Keep `interpolate()` calls inline in the `style` prop, and prefer the
  `scale` / `translate` / `rotate` properties over `transform` strings. Both
  keep the values editable in Studio.
- `useCurrentFrame()` inside a `<Sequence>` is relative to that sequence, which
  is why the hero's scene timings live on the `<Sequence from>` and every screen
  animates from its own frame 0.
- SVG `strokeDasharray` is in *path units*, so setting `pathLength={1}` next to
  it turns a dashed line solid. It cost one render to find on the landing hero.

## The skills

The 12 Remotion agent skills are vendored under `.claude/skills/` (copied from
`../../Match Book/match-book-video`, originally `npx skills add
remotion-dev/skills`) and are committed. Start with `remotion-best-practices`
when unsure which applies.
