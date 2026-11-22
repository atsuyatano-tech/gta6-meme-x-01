// main.ts — gta6-meme-x-01 entrypoint.
//
// The judged artefact is the X post itself; POST.json is the file that
// names it. This program's whole job is to deliver POST.json, byte for
// byte, from the bot directory (env MAKEFUN_BOT_DIR, default ".") into
// the output directory (env MAKEFUN_OUTPUT_DIR). It prints nothing on
// success. Node standard library only; deterministic; no network.

import * as fs from "node:fs";
import * as path from "node:path";

function main(): void {
  const botDir = path.resolve(process.env.MAKEFUN_BOT_DIR ?? ".");
  const outDir = path.resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "out");
  const src = path.join(botDir, "POST.json");
  if (!fs.existsSync(src)) {
    process.stderr.write(`main.ts: POST.json not found in ${botDir}\n`);
    process.exit(1);
  }
  // Byte-exact copy through a Buffer: what the grader reads is exactly
  // what sits in the repository, whatever the filesystem does.
  const data = fs.readFileSync(src);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "POST.json"), data);
}

main();
