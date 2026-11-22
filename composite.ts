// composite.ts — final-image compositor for gta6-meme-x-01.
//
// The scene is an AI-generated cartoon (ai-base-bench.webp: a cobwebbed
// skeleton on a Vice City bench, still holding his controller, while the
// make.fun ghost floats in with the new game). This program is the
// deterministic finishing step: ffmpeg scales the base to 1024x1024 and
// burns in the classic meme caption the base deliberately lacks — one
// line across the top, two across the bottom — with libfreetype
// (drawtext) in DejaVu Sans Bold: white uppercase letters with a thick
// black border, centred, matching the approved reference composite.
//
// Build tool only: the graded main.ts never runs this. Node standard
// library + ffmpeg only; no network, no wall clock, no randomness —
// same inputs give a byte-identical meme.png.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SIZE = 1024; // output is SIZE x SIZE, square

// Bold sans on this machine (the reference composite's typeface family);
// Liberation Sans Bold is the metric-compatible fallback.
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
];

function pickFont(): string {
  for (const p of FONT_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error(`no bold sans font found among: ${FONT_CANDIDATES.join(", ")}`);
}

// ------------------------------------------------------------ drawtext spec
// One caption line: white fill, thick black border, horizontally centred.
// The caption strings travel via textfile (written to a scratch dir by
// main) rather than inline text= — drawtext's two rounds of filter
// unescaping eat a backslash-escaped apostrophe ("IT'S" came out as
// "ITS" inline), while a text file is read verbatim.
function drawtext(font: string, textFile: string, fontsize: number, y: number): string {
  return (
    `drawtext=fontfile=${font}:textfile=${textFile}:fontsize=${fontsize}` +
    `:fontcolor=white:bordercolor=black:borderw=${BORDER_W}` +
    `:x=(w-text_w)/2:y=${y}`
  );
}

// ------------------------------------------------------------------ layout
// All coordinates are in the 1024x1024 output space, scaled from the
// 1600x1600 reference composite: the top line hugs the top edge, the
// two-line punchline hugs the bottom, the scene untouched in between —
// in this space the ghost's face sits around y 280-560 and the
// skeleton's skull around y 190-460, well clear of both blocks.
//
// Sizes were fitted against the real font (DejaVu Sans Bold advance
// widths, plus 2*borderw): the 29-char top line at 53px spans ~995px,
// the 26/24-char bottom lines at a uniform 58px span ~982/~964px —
// each ~94-97% of the frame, fully inside it, as in the reference.
// Positions are literal pixels on purpose: drawtext's text_h variable
// does not hold the rendered text height when the y expression is
// evaluated, so h-text_h arithmetic lands lines in the wrong place.
// At 58px the glyph box (border included) is ~66px tall; the reference
// line pitch is ~74px and its last line ends ~16px above the bottom.
const BORDER_W = 9;
const TOP_SIZE = 53;
const BOTTOM_SIZE = 58;
const TOP_Y = 18;
const LINE_BOX = 66;
const LINE_PITCH = 74;
const BOTTOM_MARGIN = 16;

const TOP_TEXT = "WAITING FOR GTA VI SINCE 2013";
const BOTTOM_LINES = ["IT'S OUT — AND MY AI AGENT", "ALREADY BOUGHT IT FOR ME"];
const BOTTOM_LAST_Y = SIZE - BOTTOM_MARGIN - LINE_BOX; // 942
const BOTTOM_FIRST_Y = BOTTOM_LAST_Y - LINE_PITCH; // 868

function filterChain(font: string, textFiles: string[]): string {
  const parts = [`scale=${SIZE}:${SIZE}:flags=lanczos`];
  parts.push(drawtext(font, textFiles[0], TOP_SIZE, TOP_Y));
  parts.push(drawtext(font, textFiles[1], BOTTOM_SIZE, BOTTOM_FIRST_Y));
  parts.push(drawtext(font, textFiles[2], BOTTOM_SIZE, BOTTOM_LAST_Y));
  return parts.join(",");
}

// -------------------------------------------------------------------- main
function main(): void {
  const repoDir = process.env.MEME_REPO_DIR ?? path.dirname(fileURLToPath(import.meta.url));
  const basePath = path.join(repoDir, "ai-base-bench.webp");
  const outPath = path.join(repoDir, "meme.png");
  // Caption strings go to scratch text files for drawtext's textfile=
  // (see the drawtext spec note); the scratch dir is removed afterwards
  // and never influences the pixels, so output stays deterministic.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "meme-captions-"));
  try {
    const lines = [TOP_TEXT, ...BOTTOM_LINES];
    const textFiles = lines.map((line, i) => {
      const p = path.join(scratch, `line${i}.txt`);
      fs.writeFileSync(p, line, "utf8");
      return p;
    });
    execFileSync(
      "ffmpeg",
      [
        "-v", "error",
        "-i", basePath,
        "-vf", filterChain(pickFont(), textFiles),
        "-frames:v", "1",
        "-y", outPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  process.stdout.write(`composite.ts: wrote ${outPath}\n`);
}

main();
