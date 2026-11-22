// render.ts — original deterministic meme renderer for gta6-meme-x-01.
//
// Hand-rolled raster pipeline on the Node standard library only:
//   - own RGB framebuffer + scanline polygon/ellipse fills
//   - own 5x7 pixel font for the in-image captions
//   - own PNG encoder (zlib deflate, filter-0 scanlines, table CRC32)
// No dependencies, no network, no wall clock, no randomness: every pixel is
// a pure function of the constants below, so the output is byte-identical
// across runs.
//
// REMAKE (user rejected the first winner: "the image makes no sense").
// Three candidate scenes were built and scored at 480x480; the strongest
// became meme.png, the others stay in the repo for reference:
//   meme.png          — WINNER (see meme-remake-report.md)
//   meme-cand-a.png   — BEFORE / AFTER split panel
//   meme-cand-b.png   — the beard that pooled on the floor (bench scene)
//   meme-cand-c.png   — payout in the Leonida doorway
//   meme-fallback.png — FALLBACK "CALL IN RICH" (unchanged, byte-identical)

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- palette
const INK = "#191419"; // press ink (ghost outline, text, linework)
const MAGENTA = "#C41C83"; // press magenta (coin, disc/tray)
const MAGENTA_DARK = "#8F1260";
const GHOST_WHITE = "#FFFFFF";
const WALL_TEAL = "#2E8C83";
const WALL_DARK = "#256E66";
const HATCH_TEAL = "#173F3A";
const FLOOR_DARK = "#2B2320";
const BENCH_BLUE = "#AFC3CC";
const BENCH_EDGE = "#5A6A72";
const SKIN = "#E8B08A";
const BEARD_GREY = "#B9BEC7";
const BEARD_LINE = "#8E959E";
const BEARD_SHADE = "#979EA8";
const SHIRT_TEAL = "#1FA8A0";
const SHIRT_SHADE = "#147A72";
const GHOST_SHADE = "#C9D2DB";
const TROUSER = "#3E4A5A";
const SHOE = "#22252B";
const CAP_TEAL = "#146B66";
const BAND_YELLOW = "#FFD21F";
const LIGHT = "#FFC93C";
const LIGHT_DEEP = "#FFB52E";
const DOOR_DARK = "#2A201B";
const CAL_RED = "#D23B2E";
const PAPER = "#F7F3E8";
const LINE_GREY = "#C9CFD4";
const WOOD = "#7A5230";
const WOOD_LIGHT = "#9A6B40";
const WOOD_DARK = "#573D2C";
const SUN_PALE = "#FFE9A8";
const WALL_TEAL_2 = "#2A7A71";

// ---------------------------------------------------------------- colours
type RGB = [number, number, number];

function hex(h: string): RGB {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

// ------------------------------------------------------------- framebuffer
const W = 1200;
const H = 1200;

class FB {
  data: Uint8Array;
  constructor() {
    this.data = new Uint8Array(W * H * 3);
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }
  blend(x: number, y: number, c: RGB, a: number): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    const t = a / 255;
    this.data[i] = Math.round(this.data[i] * (1 - t) + c[0] * t);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - t) + c[1] * t);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - t) + c[2] * t);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(W, Math.round(x + w));
    const y1 = Math.min(H, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
  }
  circle(cx: number, cy: number, r: number, c: RGB): void {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy));
      for (let dx = -half; dx <= half; dx++) this.set(cx + dx, cy + dy, c);
    }
  }
  ring(cx: number, cy: number, r: number, t: number, fill: RGB, edge: RGB): void {
    this.circle(cx, cy, r, edge);
    this.circle(cx, cy, r - t, fill);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    const ri = Math.ceil(ry);
    for (let dy = -ri; dy <= ri; dy++) {
      const half = Math.floor(rx * Math.sqrt(1 - (dy * dy) / (ry * ry)));
      for (let dx = -half; dx <= half; dx++) this.set(cx + dx, cy + dy, c);
    }
  }
  // thick polyline: stamp filled circles along each segment
  line(x0: number, y0: number, x1: number, y1: number, wdt: number, c: RGB): void {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (wdt / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(
        Math.round(x0 + (x1 - x0) * t),
        Math.round(y0 + (y1 - y0) * t),
        wdt / 2,
        c,
      );
    }
  }
  // scanline even-odd polygon fill
  poly(pts: [number, number][], c: RGB): void {
    let minY = H;
    let maxY = 0;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(H - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a[1] === b[1]) continue;
        const lo = Math.min(a[1], b[1]);
        const hi = Math.max(a[1], b[1]);
        if (y < lo || y >= hi) continue;
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.round(xs[i]);
        const xb = Math.round(xs[i + 1]);
        for (let x = xa; x <= xb; x++) this.set(x, y, c);
      }
    }
  }
}

// -------------------------------------------------------------- pixel font
// Classic 5x7 glyphs, rows top→bottom, '#' = filled pixel.
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "#.#..", "..#..", "..#..", "..#..", "#####"],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "$": [".#.#.", "#####", "#.#..", ".###.", "..#.#", "#####", ".#.#."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(
  fb: FB,
  s: string,
  cx: number,
  y: number,
  scale: number,
  c: RGB,
): void {
  let x = Math.round(cx - textWidth(s, scale) / 2);
  for (const ch of s) {
    const glyph = FONT[ch];
    if (glyph) {
      for (let row = 0; row < 7; row++)
        for (let col = 0; col < 5; col++)
          if (glyph[row][col] === "#")
            fb.rect(x + col * scale, y + row * scale, scale, scale, c);
    }
    x += 6 * scale;
  }
}

// ------------------------------------------------------------ shape helpers
// Four-pointed sparkle (the ghost's eyes, and in outline form a star burst).
function sparkle(fb: FB, cx: number, cy: number, r: number, c: RGB): void {
  const k = r * 0.2;
  fb.poly(
    [
      [cx, cy - r],
      [cx + k, cy - k],
      [cx + r, cy],
      [cx + k, cy + k],
      [cx, cy + r],
      [cx - k, cy + k],
      [cx - r, cy],
      [cx - k, cy - k],
    ],
    c,
  );
}

// Five-pointed star (the coin's emblem).
function star(fb: FB, cx: number, cy: number, r: number, c: RGB): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.46;
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  fb.poly(pts, c);
}

// Ghost silhouette: domed head, straight sides, wavy hem. Returns a polygon.
function ghostPath(
  cx: number,
  top: number,
  w: number,
  h: number,
): [number, number][] {
  const pts: [number, number][] = [];
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const domeR = w / 2;
  for (let i = 0; i <= 28; i++) {
    const a = Math.PI - (i / 28) * Math.PI;
    pts.push([cx + Math.cos(a) * domeR, top + domeR - Math.sin(a) * domeR]);
  }
  const yBot = top + h;
  pts.push([x1, yBot - 10]);
  for (let x = x1; x >= x0; x -= 10) {
    const t = (x - x0) / w;
    pts.push([x, yBot - 8 + Math.sin(t * Math.PI * 4) * 9]);
  }
  pts.push([x0, yBot - 10]);
  return pts;
}

// The canonical make.fun ghost: white body, thick ink outline, two black
// four-pointed sparkle eyes, no mouth, no props.
function drawGhost(
  fb: FB,
  cx: number,
  top: number,
  w: number,
  h: number,
  eyeY: number,
  eyeDX: number,
  eyeR: number,
): void {
  fb.poly(ghostPath(cx, top - 10, w + 26, h + 20), hex(INK));
  fb.poly(ghostPath(cx, top, w, h), hex(GHOST_WHITE));
  sparkle(fb, cx - eyeDX, eyeY, eyeR, hex(INK));
  sparkle(fb, cx + eyeDX, eyeY, eyeR, hex(INK));
}

// The magenta star coin.
function drawCoin(fb: FB, cx: number, cy: number, r: number): void {
  fb.circle(cx, cy, r, hex(MAGENTA_DARK));
  fb.circle(cx, cy, r - 7, hex(MAGENTA));
  fb.circle(cx, cy, r - 26, hex(MAGENTA_DARK));
  fb.circle(cx, cy, r - 31, hex(MAGENTA));
  star(fb, cx, cy, r * 0.52, hex(GHOST_WHITE));
}

// Floral Vice City shirt: teal base with a deterministic magenta block print.
function floral(fb: FB, x: number, y: number, w: number, h: number): void {
  fb.rect(x, y, w, h, hex(SHIRT_TEAL));
  const cell = 34;
  for (let gy = 0; gy * cell < h; gy++) {
    for (let gx = 0; gx * cell < w; gx++) {
      const px = x + gx * cell + ((gy * 13) % 17);
      const py = y + gy * cell + ((gx * 7) % 13);
      if ((gx + gy) % 2 === 0) {
        fb.rect(px + 6, py + 6, 15, 15, hex(MAGENTA));
        fb.rect(px + 11, py + 1, 5, 25, hex(MAGENTA_DARK));
      } else {
        fb.circle(px + 16, py + 16, 7, hex(BAND_YELLOW));
      }
    }
  }
}

// A Leonida palm silhouette: curved trunk + five fronds, one dark colour.
function palm(fb: FB, bx: number, by: number, h: number, c: RGB): void {
  const mx = bx - h * 0.07;
  const my = by - h * 0.62;
  const tx = bx - h * 0.13;
  const ty = by - h;
  fb.line(bx, by, mx, my, 13, c);
  fb.line(mx, my, tx, ty, 11, c);
  fb.line(tx, ty, tx - h * 0.30, ty + h * 0.16, 7, c);
  fb.line(tx, ty, tx - h * 0.17, ty - h * 0.10, 7, c);
  fb.line(tx, ty, tx + h * 0.05, ty - h * 0.14, 7, c);
  fb.line(tx, ty, tx + h * 0.26, ty - h * 0.02, 7, c);
  fb.line(tx, ty, tx + h * 0.30, ty + h * 0.18, 7, c);
}

// A game controller: dark rounded body, two sticks, two bright buttons.
function controller(fb: FB, cx: number, cy: number, w: number): void {
  const ink = hex(INK);
  const r = w * 0.30;
  fb.circle(cx - w / 2 + r, cy, r, ink);
  fb.circle(cx + w / 2 - r, cy, r, ink);
  fb.rect(cx - w / 2 + r, cy - r, w - 2 * r, 2 * r, ink);
  fb.circle(cx - w * 0.22, cy + 2, 9, hex(MAGENTA));
  fb.circle(cx + w * 0.20, cy - 6, 8, hex(BAND_YELLOW));
  fb.circle(cx + w * 0.32, cy + 8, 8, hex(SHIRT_TEAL));
}

// One wall calendar: paper sheet, red header, grey lines — plus, when
// `circled`, one big magenta ring: the day he has waited for.
function calendar(
  fb: FB,
  x: number,
  y: number,
  w: number,
  h: number,
  circled: boolean,
): void {
  fb.rect(x - 5, y - 5, w + 10, h + 10, hex(INK));
  fb.rect(x, y, w, h, hex(PAPER));
  fb.rect(x, y, w, h * 0.22, hex(CAL_RED));
  if (circled) {
    const cx = x + w / 2;
    const cy = y + h * 0.60;
    const r = Math.min(w, h) * 0.26;
    fb.circle(cx, cy, r, hex(MAGENTA_DARK));
    fb.circle(cx, cy, r - 9, hex(MAGENTA));
    fb.circle(cx, cy, r - 24, hex(PAPER));
  } else {
    fb.rect(x + w * 0.10, y + h * 0.38, w * 0.62, 8, hex(LINE_GREY));
    fb.rect(x + w * 0.10, y + h * 0.55, w * 0.48, 8, hex(LINE_GREY));
    fb.rect(x + w * 0.10, y + h * 0.72, w * 0.56, 8, hex(LINE_GREY));
  }
}

// ------------------------------------------- revision-2 helpers (scene B)
// The ghost with a cel shade: one flat GHOST_SHADE tone hugging the right
// side of the body, drawn between the white fill and the sparkle eyes.
function drawGhostShaded(
  fb: FB,
  cx: number,
  top: number,
  w: number,
  h: number,
  eyeY: number,
  eyeDX: number,
  eyeR: number,
): void {
  fb.poly(ghostPath(cx, top - 10, w + 26, h + 20), hex(INK));
  fb.poly(ghostPath(cx, top, w, h), hex(GHOST_WHITE));
  const domeR = w / 2;
  const yBot = top + h;
  const shade: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = 1.25 - (i / 10) * 1.25;
    shade.push([
      cx + Math.cos(a) * (domeR - 30),
      top + domeR - Math.sin(a) * (domeR - 30),
    ]);
  }
  const hemT = (w - 30) / w;
  shade.push([
    cx + domeR - 30,
    yBot - 8 + Math.sin(hemT * Math.PI * 4) * 9 - 4,
  ]);
  shade.push([cx + w * 0.28, yBot - 14]);
  shade.push([cx + w * 0.16, yBot - 12]);
  shade.push([cx + w * 0.3, yBot - h * 0.3]);
  shade.push([cx + w * 0.33, top + domeR + h * 0.16]);
  shade.push([cx + w * 0.22, top + domeR - 46]);
  fb.poly(shade, hex(GHOST_SHADE));
  sparkle(fb, cx - eyeDX, eyeY, eyeR, hex(INK));
  sparkle(fb, cx + eyeDX, eyeY, eyeR, hex(INK));
}

// A speech bubble: ink outline, white body, triangular tail to a tip point.
// Drawn tail-first so the body covers the tail's base seam.
function speechBubble(
  fb: FB,
  x: number,
  y: number,
  w: number,
  h: number,
  tipX: number,
  tipY: number,
): void {
  const ink = hex(INK);
  fb.poly(
    [
      [x + w * 0.7, y + h - 4],
      [x + w * 0.96, y + h - 4],
      [tipX, tipY],
    ],
    ink,
  );
  fb.poly(
    [
      [x + w * 0.74, y + h - 8],
      [x + w * 0.92, y + h - 8],
      [tipX - 5, tipY - 7],
    ],
    hex(GHOST_WHITE),
  );
  fb.rect(x - 6, y - 6, w + 12, h + 12, ink);
  fb.rect(x, y, w, h, hex(GHOST_WHITE));
}

// Wall item 1 of 4: 2013 — GTA V, the last GTA, drops. A news page:
// red masthead, the year huge, the title under it. The 13-year wait is
// counted from HERE. (Panel wave 2 caught the old "2013 ANNOUNCED" as
// a factual error: VI was not announced until 2022.)
function timelineGtaV(fb: FB, x: number, y: number, w: number, h: number): void {
  const ink = hex(INK);
  fb.rect(x - 5, y - 5, w + 10, h + 10, ink);
  fb.rect(x, y, w, h, hex(PAPER));
  fb.rect(x, y, w, 16, hex(CAL_RED));
  drawText(fb, "2013", x + w / 2, y + 36, 6, ink);
  drawText(fb, "GTA V", x + w / 2, y + 98, 4, ink);
  fb.rect(x + 22, y + 148, w - 44, 7, hex(LINE_GREY));
  fb.rect(x + 22, y + 164, w - 76, 7, hex(LINE_GREY));
}

// Wall item 2 of 4: 2022 — VI is finally announced. Same paper family
// as item 1 but a teal masthead and a stacked VI / ANNOUNCED, so the
// two year pages do not read as copy-paste twins.
function timelineAnnounce(fb: FB, x: number, y: number, w: number, h: number): void {
  const ink = hex(INK);
  fb.rect(x - 5, y - 5, w + 10, h + 10, ink);
  fb.rect(x, y, w, h, hex(PAPER));
  fb.rect(x, y, w, 16, hex(WALL_DARK));
  drawText(fb, "2022", x + w / 2, y + 32, 6, ink);
  drawText(fb, "VI", x + w / 2, y + 88, 5, ink);
  drawText(fb, "ANNOUNCED", x + w / 2, y + 136, 3, ink);
}

// Wall item 2 of 3: the DELAYED notice — pale amber paper, the word in
// red, a red rule and a stamped no-mark. Deliberately NOT a calendar.
function delayedNotice(fb: FB, x: number, y: number, w: number, h: number): void {
  const ink = hex(INK);
  fb.rect(x - 5, y - 5, w + 10, h + 10, ink);
  fb.rect(x, y, w, h, hex(SUN_PALE));
  drawText(fb, "DELAYED", x + w / 2, y + 30, 4, hex(CAL_RED));
  fb.rect(x + 16, y + 72, w - 32, 8, hex(CAL_RED));
  const cx = x + w / 2;
  const cy = y + 128;
  fb.circle(cx, cy, 31, hex(CAL_RED));
  fb.circle(cx, cy, 23, hex(SUN_PALE));
  fb.line(cx - 17, cy + 17, cx + 17, cy - 17, 7, hex(CAL_RED));
}

// Wall item 4 of 4: the final calendar — red header, the day itself
// circled in magenta, NOV 19 spelled out big under the ring so it
// survives the 480 downscale.
function timelineFinal(fb: FB, x: number, y: number, w: number, h: number): void {
  const ink = hex(INK);
  fb.rect(x - 5, y - 5, w + 10, h + 10, ink);
  fb.rect(x, y, w, h, hex(PAPER));
  fb.rect(x, y, w, 34, hex(CAL_RED));
  const cx = x + w / 2;
  const cy = y + 96;
  fb.circle(cx, cy, 40, hex(MAGENTA_DARK));
  fb.circle(cx, cy, 33, hex(MAGENTA));
  fb.circle(cx, cy, 20, hex(PAPER));
  drawText(fb, "NOV 19", cx, y + 146, 3, ink);
}

// A controller that reads as one at thumbnail size: D-pad cross on the
// left, two bright buttons and two stick dots on the right.
function controllerPro(fb: FB, cx: number, cy: number, w: number): void {
  const ink = hex(INK);
  const r = w * 0.3;
  fb.circle(cx - w / 2 + r, cy, r, ink);
  fb.circle(cx + w / 2 - r, cy, r, ink);
  fb.rect(cx - w / 2 + r, cy - r, w - 2 * r, 2 * r, ink);
  // D-pad
  fb.rect(cx - w * 0.4, cy - 5, 24, 10, hex(BENCH_BLUE));
  fb.rect(cx - w * 0.4 + 7, cy - 12, 10, 24, hex(BENCH_BLUE));
  // buttons + sticks
  fb.circle(cx + w * 0.3, cy - 9, 9, hex(MAGENTA));
  fb.circle(cx + w * 0.43, cy + 5, 9, hex(BAND_YELLOW));
  fb.circle(cx - w * 0.1, cy + 10, 6, hex(LINE_GREY));
  fb.circle(cx + w * 0.12, cy + 12, 6, hex(LINE_GREY));
}

// The GTA VI game case, leaning on the floor by the bench: sunset cover,
// palm, the title on the sea band. Slight lean via a slanted outline.
function gameCase(fb: FB, x: number, y: number): void {
  const ink = hex(INK);
  fb.poly(
    [
      [x, y + 8],
      [x + 84, y],
      [x + 88, y + 112],
      [x + 4, y + 120],
    ],
    ink,
  );
  fb.poly(
    [
      [x + 5, y + 12],
      [x + 80, y + 5],
      [x + 83, y + 108],
      [x + 9, y + 114],
    ],
    hex("#F97B6B"),
  );
  fb.poly(
    [
      [x + 5, y + 12],
      [x + 80, y + 5],
      [x + 81, y + 38],
      [x + 6, y + 44],
    ],
    hex("#FF7E47"),
  );
  fb.poly(
    [
      [x + 8, y + 76],
      [x + 82, y + 70],
      [x + 83, y + 108],
      [x + 9, y + 114],
    ],
    hex("#146B66"),
  );
  palm(fb, x + 24, y + 74, 52, hex(HATCH_TEAL));
  drawText(fb, "GTA VI", x + 46, y + 82, 2, hex(GHOST_WHITE));
}

// The remake headline: huge pixel text, black on flat yellow, top band.
function headline(fb: FB): void {
  const ink = hex(INK);
  fb.rect(70, 64, 1060, 132, hex(BAND_YELLOW));
  fb.rect(70, 64, 1060, 7, ink);
  fb.rect(70, 189, 1060, 7, ink);
  fb.rect(70, 64, 7, 132, ink);
  fb.rect(1123, 64, 7, 132, ink);
  drawText(fb, "13 YEARS LATER", 600, 95, 10, ink);
}

// ------------------------------------------------------------ PNG encoding
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(fb: FB): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    Buffer.from(fb.data.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ============================================================== FALLBACK ===
// "CALL IN RICH" — launch day, and he is not going in. A split office /
// Leonida-sunset scene: one huge calendar page with the day circled in
// magenta (no numerals), the player at his desk in backwards cap and
// floral shirt, phone to his ear, pinching his nose for the sick voice —
// while the ghost, standing on its magenta disc at the desk's centre,
// seals his sick note with the magenta star coin.
// NOTE: this scene is UNCHANGED from the first build — its output must
// stay byte-identical (sha256 5a3a80af…).
function renderFallback(): FB {
  const fb = new FB();
  const ink = hex(INK);

  // Leonida sunset: flat horizontal bands over the top of the frame
  fb.rect(0, 0, W, 175, hex("#FF7E47"));
  fb.rect(0, 175, W, 175, hex("#FF9A3C"));
  fb.rect(0, 350, W, 175, hex("#F97B6B"));
  fb.rect(0, 525, W, 175, hex("#E85D8A"));
  fb.circle(935, 255, 92, hex("#FFE3A3")); // low sun
  fb.circle(935, 255, 70, hex("#FFF3C4"));
  // sea / office floor
  fb.rect(0, 700, W, H - 700, hex("#22333B"));
  fb.rect(0, 700, W, 8, hex("#1A282F"));

  // ---- one huge calendar page (left): white sheet, red header, a single
  // enormous magenta circle around the day. No numerals anywhere.
  fb.rect(89, 109, 382, 462, ink);
  fb.rect(95, 115, 370, 450, hex(PAPER));
  fb.rect(95, 115, 370, 65, hex(CAL_RED));
  fb.circle(280, 375, 125, hex(MAGENTA_DARK));
  fb.circle(280, 375, 112, hex(MAGENTA));
  fb.circle(280, 375, 88, hex(PAPER));

  // ---- desk (centre-right)
  fb.rect(485, 830, 645, 155, hex(WOOD)); // front
  fb.rect(485, 830, 645, 14, hex(WOOD_DARK));
  fb.rect(470, 792, 660, 38, hex(WOOD_LIGHT)); // top slab
  fb.rect(470, 792, 660, 7, hex(WOOD_DARK));

  // ---- the ghost on its magenta disc, at the desk's centre
  fb.ellipse(640, 800, 175, 30, hex(MAGENTA_DARK));
  fb.ellipse(640, 794, 175, 30, hex(MAGENTA));
  drawGhost(fb, 640, 330, 370, 468, 480, 66, 28);
  // round little hand reaching right, toward the sick note
  fb.ring(800, 592, 29, 7, hex(GHOST_WHITE), ink);

  // ---- the sick-note card, propped on the desk
  fb.rect(806, 642, 168, 164, ink);
  fb.rect(812, 648, 156, 152, hex(PAPER));
  fb.rect(826, 700, 110, 7, hex(LINE_GREY));
  fb.rect(826, 726, 128, 7, hex(LINE_GREY));
  fb.rect(826, 752, 96, 7, hex(LINE_GREY));

  // ---- the coin as the note's seal: overlaps the ghost's hand AND the
  // top corner of the card.
  drawCoin(fb, 838, 606, 80);

  // ---- the player at the desk, calling in
  // torso in the floral shirt
  fb.rect(900, 668, 160, 134, hex(SHIRT_TEAL));
  floral(fb, 912, 680, 136, 110);
  fb.line(900, 668, 900, 802, 5, ink);
  fb.line(1060, 668, 1060, 802, 5, ink);
  fb.line(900, 668, 1060, 668, 5, ink);
  // head with backwards cap (brim pointing back, to the left)
  fb.circle(972, 600, 41, hex(CAP_TEAL));
  fb.circle(972, 618, 38, hex(SKIN));
  fb.rect(896, 590, 46, 13, hex(CAP_TEAL));
  // phone arm: sleeve, forearm, receiver pressed to his ear
  fb.line(928, 690, 884, 646, 26, hex(SHIRT_TEAL));
  fb.line(884, 646, 934, 606, 20, hex(SKIN));
  fb.line(916, 588, 952, 620, 17, ink);
  fb.circle(916, 588, 11, ink);
  fb.circle(952, 620, 11, ink);
  // curly cord down to the phone base on the desk
  fb.line(946, 622, 930, 668, 3, ink);
  fb.line(930, 668, 958, 706, 3, ink);
  fb.line(958, 706, 934, 748, 3, ink);
  fb.line(934, 748, 966, 782, 3, ink);
  fb.rect(952, 772, 104, 26, hex(SHOE));
  fb.circle(1004, 785, 6, hex(MAGENTA));
  // the other hand pinches his nose — the sick voice is acting, not illness
  fb.line(1036, 692, 1012, 646, 26, hex(SHIRT_TEAL));
  fb.line(1012, 646, 966, 634, 20, hex(SKIN));
  fb.circle(962, 630, 16, hex(SKIN));

  // ---- caption band: huge pixel text, white on black, bottom band
  fb.rect(70, 1005, 1060, 140, hex("#101014"));
  drawText(fb, "CALL IN RICH", 600, 1040, 10, hex(GHOST_WHITE));

  return fb;
}

// ==================================================== CANDIDATE A: SPLIT ===
// BEFORE / AFTER diptych. Left: a kid on a couch, controller in hand,
// staring at the TV, one circled calendar on the wall. Right: the same
// man, grey-bearded, standing as the ghost pays the coin out of a blazing
// doorway. The beard contrast carries the "13 years" joke by itself.
function renderSplit(): FB {
  const fb = new FB();
  const ink = hex(INK);

  // two rooms, one divider
  fb.rect(0, 0, W, H, hex(WALL_TEAL));
  fb.rect(606, 0, 594, H, hex(WALL_TEAL_2));
  fb.rect(0, 930, 594, 270, hex(FLOOR_DARK));
  fb.rect(606, 930, 594, 270, hex(FLOOR_DARK));
  fb.rect(594, 210, 12, 990, ink);
  headline(fb);

  // ---------------- LEFT — BEFORE: the kid and the wait
  calendar(fb, 120, 260, 200, 190, true);
  // wall-mounted TV he is staring at
  fb.rect(448, 500, 140, 168, ink);
  fb.rect(460, 512, 116, 144, hex(HATCH_TEAL));
  fb.rect(460, 512, 116, 58, hex(LIGHT_DEEP));
  fb.circle(545, 618, 20, hex(MAGENTA));
  // couch
  fb.rect(95, 690, 470, 150, hex(BENCH_BLUE));
  fb.rect(95, 690, 470, 10, hex(BENCH_EDGE));
  fb.rect(85, 840, 490, 60, hex(BENCH_BLUE));
  fb.rect(110, 900, 440, 40, hex(BENCH_EDGE));
  // kid: head + cap, no beard
  fb.circle(305, 565, 46, hex(SKIN));
  fb.ellipse(305, 522, 50, 16, hex(CAP_TEAL));
  fb.rect(258, 514, 94, 22, hex(CAP_TEAL));
  fb.rect(305, 522, 64, 12, hex(CAP_TEAL)); // brim
  // torso in the floral shirt
  fb.poly(
    [
      [235, 640],
      [375, 640],
      [385, 845],
      [225, 845],
    ],
    hex(SHIRT_TEAL),
  );
  floral(fb, 250, 660, 110, 150);
  // one leg stretched toward the TV, shoe below
  fb.line(320, 845, 430, 858, 30, hex(TROUSER));
  fb.line(430, 858, 435, 952, 25, hex(TROUSER));
  fb.rect(408, 946, 72, 26, hex(SHOE));
  fb.rect(372, 952, 64, 24, hex(SHOE));
  // arms + controller, held up in front of him
  fb.line(365, 680, 405, 712, 28, hex(SHIRT_TEAL));
  fb.line(405, 712, 428, 724, 20, hex(SKIN));
  controller(fb, 452, 736, 104);
  fb.circle(415, 718, 18, hex(SKIN));
  fb.circle(478, 712, 16, hex(SKIN));

  // ---------------- RIGHT — AFTER: the payout
  // the doorway, blazing with Leonida light
  fb.rect(912, 246, 240, 764, hex(HATCH_TEAL));
  fb.rect(934, 268, 196, 742, hex(LIGHT));
  fb.circle(1092, 362, 34, hex(SUN_PALE));
  palm(fb, 988, 1010, 210, hex(HATCH_TEAL));
  // the ghost in the doorway (sill drawn later covers its hem)
  drawGhost(fb, 1032, 320, 216, 570, 462, 40, 19);
  // the same man, thirteen years on: tall, grey-bearded
  fb.line(712, 806, 700, 992, 32, hex(TROUSER));
  fb.line(792, 806, 806, 992, 32, hex(TROUSER));
  fb.rect(662, 986, 80, 28, hex(SHOE));
  fb.rect(772, 986, 80, 28, hex(SHOE));
  fb.poly(
    [
      [668, 516],
      [832, 516],
      [848, 806],
      [652, 806],
    ],
    hex(SHIRT_TEAL),
  );
  floral(fb, 688, 536, 120, 180);
  // the beard, grown long during the wait, over the shirt
  fb.poly(
    [
      [710, 462],
      [786, 462],
      [806, 748],
      [690, 748],
    ],
    hex(BEARD_GREY),
  );
  fb.line(730, 486, 726, 724, 4, hex(BEARD_LINE));
  fb.line(756, 488, 760, 730, 4, hex(BEARD_LINE));
  // head + cap
  fb.circle(748, 428, 48, hex(SKIN));
  fb.ellipse(748, 384, 54, 17, hex(CAP_TEAL));
  fb.rect(696, 376, 104, 22, hex(CAP_TEAL));
  fb.rect(748, 384, 66, 13, hex(CAP_TEAL)); // brim
  // hanging arm
  fb.line(676, 566, 652, 680, 28, hex(SHIRT_TEAL));
  fb.circle(650, 690, 16, hex(SKIN));
  // reaching arm: sleeve + forearm (the hand lands after the coin)
  fb.line(828, 566, 862, 592, 30, hex(SHIRT_TEAL));
  fb.line(862, 592, 884, 600, 22, hex(SKIN));
  // the coin, paid hand to hand
  drawCoin(fb, 952, 602, 68);
  fb.ring(1002, 602, 23, 7, hex(GHOST_WHITE), ink); // ghost's round hand
  fb.circle(890, 602, 22, hex(SKIN)); // his hand on the left rim
  // door sill over the ghost's hem — it stands IN the doorway, not on air
  fb.rect(912, 884, 240, 126, hex(WOOD_DARK));
  fb.rect(912, 884, 240, 12, hex(WOOD));

  return fb;
}

// ============================================== CANDIDATE B: BEARD POOL ===
// One scene, one gag: he sat down to wait with a controller, and his beard
// grew down his chest, past his knees, and pooled on the floor. Now the
// ghost leans in from the right edge of the frame and pays him the coin.
//
// REVISION 2 (1,000-persona panel wave 1: 1/1,000 — fixing the top
// fixable themes): the wall now tells the whole story — three
// DIFFERENT notices plus a poster. The man has a face at last
// (raised brows, eyes wide up at the ghost) and a wider,
// strand-lined beard that cannot read as a dress. The ghost stands
// FULLY inside the frame and says the quiet part out loud in a
// speech bubble: "AGENT EARNED $512.40". A GTA VI game case leans
// by the bench. Every major shape carries one flat cel-shade tone.
//
// REVISION 3 (panel wave 2: 0/1,000 — the metric saturates; fixing
// the REAL defects only): the wall row is now a factually correct
// timeline in order — 2013 GTA V drops (the wait is counted from
// the last GTA, NOT a 2013 announcement), 2022 VI announced, the
// DELAYED notice, and the circled NOV 19 calendar. The GTA VI
// poster leaves the top row: the only wall right of the timeline
// is ~105px tall above the ghost, too short for a 185px poster
// without crowding, so GTA VI is carried by the 2022 panel and
// the game case. All wall text is now scale 3+ (no micro-text).
// The ghost moves 15px closer and its hand is redrawn as a white
// bulge growing out of the body's edge (ink crescent on the coin
// side only), so it no longer reads as a floating donut. The
// beard gains three strand lines and a scalloped bottom edge
// above the pool.
function renderBeardPool(): FB {
  const fb = new FB();
  const ink = hex(INK);

  fb.rect(0, 0, W, 880, hex(WALL_TEAL));
  fb.rect(0, 862, W, 18, hex(WALL_DARK)); // skirting board
  fb.rect(0, 880, W, H - 880, hex(FLOOR_DARK));
  headline(fb);

  // the wall tells the story, in order: 2013 GTA V drops, 2022 VI
  // is announced, the delays, and the day itself, circled at last
  timelineGtaV(fb, 45, 228, 180, 185);
  timelineAnnounce(fb, 240, 228, 180, 185);
  delayedNotice(fb, 435, 228, 180, 185);
  timelineFinal(fb, 630, 228, 190, 185);

  // the bench he has been sitting on for thirteen years
  fb.rect(140, 650, 570, 44, hex(BENCH_BLUE));
  fb.rect(140, 650, 570, 8, hex(BENCH_EDGE));
  fb.rect(140, 686, 570, 8, hex(BENCH_EDGE)); // shaded underside
  fb.rect(130, 768, 590, 30, hex(BENCH_BLUE));
  fb.rect(130, 790, 590, 8, hex(BENCH_EDGE));
  fb.rect(170, 798, 26, 90, hex(BENCH_EDGE));
  fb.rect(640, 798, 26, 90, hex(BENCH_EDGE));

  // the GTA VI game case, leaning by the bench leg — his copy, at last
  gameCase(fb, 676, 884);

  // legs first (the beard flows over them)
  fb.line(370, 775, 320, 855, 32, hex(TROUSER));
  fb.line(320, 855, 315, 975, 26, hex(TROUSER));
  fb.line(505, 775, 555, 855, 32, hex(TROUSER));
  fb.line(555, 855, 560, 975, 26, hex(TROUSER));
  // torso in the floral shirt, cel-shaded on the right
  fb.poly(
    [
      [320, 545],
      [550, 545],
      [565, 775],
      [305, 775],
    ],
    hex(SHIRT_TEAL),
  );
  floral(fb, 340, 565, 155, 130);
  fb.rect(492, 548, 52, 224, hex(SHIRT_SHADE));
  // head + cap
  fb.circle(435, 482, 56, hex(SKIN));
  fb.ellipse(435, 436, 60, 18, hex(CAP_TEAL));
  fb.rect(378, 428, 114, 24, hex(CAP_TEAL));
  fb.rect(462, 428, 30, 24, hex("#0E4F4A")); // cap shade
  fb.rect(435, 436, 74, 14, hex(CAP_TEAL)); // brim
  // THE FACE: raised brows, eyes wide and looking UP at the ghost —
  // thirteen years of waiting breaking into joy
  fb.line(392, 464, 408, 454, 7, ink);
  fb.line(408, 454, 426, 462, 7, ink);
  fb.line(444, 462, 462, 454, 7, ink);
  fb.line(462, 454, 478, 464, 7, ink);
  fb.ellipse(407, 488, 14, 16, ink);
  fb.ellipse(407, 488, 12, 14, hex(GHOST_WHITE));
  fb.circle(411, 482, 6, ink); // pupil, up and to the right
  fb.ellipse(463, 488, 14, 16, ink);
  fb.ellipse(463, 488, 12, 14, hex(GHOST_WHITE));
  fb.circle(467, 482, 6, ink);
  // THE BEARD: wide at the jaw, bulging sides, strand lines following
  // the flow, pooling on the floor — a beard, not a curtain
  fb.poly(
    [
      [368, 534],
      [384, 516],
      [486, 516],
      [502, 534],
      [516, 610],
      [534, 730],
      [552, 880],
      [566, 952],
      [526, 974],
      [486, 959],
      [446, 973],
      [406, 958],
      [366, 972],
      [326, 959],
      [304, 960],
      [318, 880],
      [336, 730],
      [354, 610],
    ],
    hex(BEARD_GREY),
  );
  // beard cel shade, right portion
  fb.poly(
    [
      [452, 524],
      [488, 524],
      [516, 610],
      [534, 730],
      [552, 880],
      [564, 960],
      [470, 960],
      [462, 760],
      [458, 620],
    ],
    hex(BEARD_SHADE),
  );
  fb.ellipse(435, 1008, 218, 38, hex(BEARD_GREY)); // the pool
  fb.ellipse(505, 1008, 140, 30, hex(BEARD_SHADE)); // pool shade
  fb.ellipse(375, 1008, 130, 30, hex(BEARD_GREY)); // lit side restored
  fb.line(398, 545, 388, 950, 5, hex(BEARD_LINE));
  fb.line(424, 548, 424, 965, 5, hex(BEARD_LINE));
  fb.line(478, 545, 505, 940, 5, hex(BEARD_LINE));
  fb.line(366, 560, 345, 900, 5, hex(BEARD_LINE));
  fb.line(488, 640, 500, 780, 4, hex(BEARD_LINE));
  fb.line(496, 820, 512, 920, 4, hex(BEARD_LINE));
  // revision 3: three more strands, splaying with the flow, so the
  // slab reads as hair all the way down to the scalloped hem
  fb.line(376, 556, 358, 928, 5, hex(BEARD_LINE));
  fb.line(447, 550, 453, 958, 5, hex(BEARD_LINE));
  fb.line(468, 742, 488, 922, 4, hex(BEARD_LINE));
  // shoes planted in front of the pool
  fb.rect(282, 968, 78, 28, hex(SHOE));
  fb.rect(528, 968, 78, 28, hex(SHOE));
  // left arm + the controller he never put down
  fb.line(345, 585, 320, 690, 30, hex(SHIRT_TEAL));
  fb.line(320, 690, 330, 706, 20, hex(SKIN));
  controllerPro(fb, 356, 722, 128);
  fb.circle(330, 708, 20, hex(SKIN));
  // right arm reaching out for the coin (hand lands after the coin)
  fb.line(540, 600, 640, 606, 34, hex(SHIRT_TEAL));
  fb.line(640, 606, 662, 610, 24, hex(SKIN));

  // the ghost, FULLY inside the frame, cel-shaded — and 15px closer
  // to the coin than in revision 2, so its hand can grow out of the
  // body's edge instead of floating beside it
  drawGhostShaded(fb, 1000, 315, 350, 625, 468, 62, 28);
  // …and it says the quiet part out loud: who earned it, and how much
  speechBubble(fb, 505, 432, 315, 124, 824, 580);
  drawText(fb, "AGENT EARNED", 662, 448, 4, ink);
  drawText(fb, "$512.40", 662, 484, 7, ink);
  // the coin between them
  drawCoin(fb, 745, 612, 85);
  // the ghost's hand: a white bulge growing out of the body's edge,
  // gripping the coin's right rim — an ink crescent on the coin side
  // only, so the hand merges into the body (same no-outline idiom as
  // the man's skin hand) instead of reading as a floating donut
  fb.circle(812, 612, 27, ink);
  fb.circle(820, 612, 27, hex(GHOST_WHITE));
  fb.circle(668, 612, 24, hex(SKIN)); // his hand on the left rim

  return fb;
}

// ============================================== CANDIDATE C: DOORWAY ======
// One bold scene: the door he has stared at for thirteen years is finally
// open — Leonida sun and a palm tree behind the ghost, who stands in the
// doorway and pays the coin straight into the waiting man's hand.
function renderDoorway(): FB {
  const fb = new FB();
  const ink = hex(INK);

  fb.rect(0, 0, W, 900, hex(WALL_TEAL));
  fb.rect(0, 884, W, 16, hex(WALL_DARK)); // skirting board
  fb.rect(0, 900, W, H - 900, hex(FLOOR_DARK));
  headline(fb);

  // the calendar on the wall: the day, circled at last
  calendar(fb, 110, 280, 220, 240, true);

  // ---- the door, finally open (right): Leonida blazing through it
  fb.rect(640, 236, 500, 774, hex(HATCH_TEAL)); // frame
  fb.rect(668, 264, 444, 746, hex(LIGHT)); // opening
  fb.rect(668, 800, 444, 210, hex(LIGHT_DEEP)); // deeper glow at the base
  fb.circle(1005, 430, 60, hex(SUN_PALE)); // the Leonida sun
  palm(fb, 722, 1010, 300, hex(HATCH_TEAL)); // palm silhouette, left jamb
  // door panel swung inward, dark against the light
  fb.poly(
    [
      [668, 264],
      [752, 300],
      [752, 980],
      [668, 1010],
    ],
    hex(DOOR_DARK),
  );
  fb.circle(736, 640, 9, hex(BAND_YELLOW)); // handle

  // ---- the ghost standing in the doorway (sill covers its hem below)
  drawGhost(fb, 880, 320, 390, 640, 500, 70, 30);

  // ---- the waiting man, big at the left: grey beard, controller in his
  // spare hand, the other hand already reaching for the coin
  fb.line(400, 830, 385, 1000, 34, hex(TROUSER));
  fb.line(480, 830, 505, 1000, 34, hex(TROUSER));
  fb.rect(345, 995, 85, 30, hex(SHOE));
  fb.rect(470, 995, 85, 30, hex(SHOE));
  fb.poly(
    [
      [330, 540],
      [520, 540],
      [540, 850],
      [315, 850],
    ],
    hex(SHIRT_TEAL),
  );
  floral(fb, 352, 555, 140, 110);
  fb.line(330, 540, 520, 540, 5, ink);
  fb.line(520, 540, 540, 850, 5, ink);
  // the beard, hanging over the shirt
  fb.poly(
    [
      [385, 490],
      [465, 490],
      [500, 830],
      [350, 830],
    ],
    hex(BEARD_GREY),
  );
  fb.line(408, 514, 402, 806, 4, hex(BEARD_LINE));
  fb.line(434, 516, 436, 816, 4, hex(BEARD_LINE));
  fb.line(460, 514, 470, 800, 4, hex(BEARD_LINE));
  // head + cap
  fb.circle(425, 455, 50, hex(SKIN));
  fb.ellipse(425, 412, 56, 18, hex(CAP_TEAL));
  fb.rect(372, 404, 106, 26, hex(CAP_TEAL));
  fb.rect(425, 412, 70, 14, hex(CAP_TEAL)); // brim
  // left arm down to the controller he is still holding
  fb.line(340, 585, 305, 675, 32, hex(SHIRT_TEAL));
  fb.line(305, 675, 338, 708, 22, hex(SKIN));
  controller(fb, 355, 736, 110);
  fb.circle(345, 715, 20, hex(SKIN));
  // right arm reaching for the coin (hand lands after the coin)
  fb.line(515, 585, 560, 625, 34, hex(SHIRT_TEAL));
  fb.line(560, 625, 598, 644, 24, hex(SKIN));

  // ---- the coin, paid hand to hand at the doorway
  drawCoin(fb, 672, 648, 85);
  fb.ring(738, 648, 28, 8, hex(GHOST_WHITE), ink); // ghost's round hand
  fb.circle(600, 648, 24, hex(SKIN)); // his hand on the left rim

  // door sill over the ghost's hem — anchored in the doorway
  fb.rect(640, 958, 500, 52, hex(WOOD_DARK));
  fb.rect(640, 958, 500, 10, hex(WOOD));

  return fb;
}

// ------------------------------------------------------------------- main
function main(): void {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(dir, "meme.png"), encodePNG(renderBeardPool()));
  fs.writeFileSync(path.join(dir, "meme-cand-a.png"), encodePNG(renderSplit()));
  fs.writeFileSync(path.join(dir, "meme-cand-b.png"), encodePNG(renderBeardPool()));
  fs.writeFileSync(path.join(dir, "meme-cand-c.png"), encodePNG(renderDoorway()));
  fs.writeFileSync(path.join(dir, "meme-fallback.png"), encodePNG(renderFallback()));
}

main();
