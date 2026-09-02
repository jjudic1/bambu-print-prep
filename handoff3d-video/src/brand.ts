// Brand tokens lifted verbatim from web/src/styles.css, so the promos, the
// landing page and the app itself stay one visual system. If a colour changes
// there, change it here -- a promo that is a different green from the product
// is worse than no promo.
export const brand = {
  bg: "#101215",
  panel: "#171a1f",
  well: "#0d0f12",
  line: "#262b33",
  ink: "#e9ecef",
  dim: "#949ba6",
  accent: "#22a45d",
  accentInk: "#06120b",
  warn: "#c4463a",

  // The plate, and the corner of it the printer keeps for itself.
  bed: "#1b1f25",
  bedLine: "#2b323c",
  keepOut: "#3a2320",

  // Filament colours, the same six the app offers on its swatches.
  fil: ["#e5e7eb", "#22a45d", "#e0803a", "#4c8ff0", "#c4463a", "#8b5cf6"],
} as const;

export const font = {
  // The app is set in the system stack and so is this. No webfont: nothing here
  // is a wordmark, and a promo that does not match the product is the failure
  // mode worth avoiding.
  ui: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
  display: '"Segoe UI Semibold","Segoe UI",-apple-system,Roboto,sans-serif',
  mono: 'ui-monospace,"Cascadia Mono",Consolas,monospace',
} as const;

// Vertical canvas for Shorts / Reels / TikTok.
export const VIDEO = { width: 1080, height: 1920, fps: 30 } as const;

// iPad geometry. The app UI is authored at 338x451 -- the 3:4 of a portrait
// iPad -- and scaled up, so text re-lays out at size instead of being a
// magnified bitmap.
export const IPAD = {
  width: 820,
  padding: 24,
  top: 640,
  uiW: 338,
  uiH: 451,
  get screenW() { return this.width - this.padding * 2; },
  get scale() { return this.screenW / this.uiW; },
  get screenH() { return this.uiH * this.scale; },
  get height() { return this.screenH + this.padding * 2; },
} as const;

// The app's own split: the plate gets 45% of the screen and the controls
// scroll inside what is left. Same numbers as .app in styles.css.
export const UI = {
  plateH: Math.round(IPAD.uiH * 0.45),
  get panelH() { return IPAD.uiH - this.plateH; },
} as const;
