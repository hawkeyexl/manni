// Turn the real captures in media/capture-flare-site/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
// The build's two lines land at different moments (build.stamped), so they are
// kept as two chunks: manni's announce, then the stand-in madbuild's own line.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-flare-site");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");
const exit = (name) => read(`${name}.exit`).trim();

const build = read("build.ans");
const cut = build.indexOf("\n") + 1;
if (cut === 0 || build.slice(cut).split("\n").length !== 2) throw new Error(`build.ans: expected 2 lines, got ${JSON.stringify(build)}`);

const out = {
  ls: read("ls.txt"),
  "tail config": read("tail-config.txt"),
  build: { announce: build.slice(0, cut), standin: build.slice(cut) },
  preview: read("preview.ans"),
  curl: read("curl.txt"),
  start: read("start.ans"),
  exits: { build: exit("build"), start: exit("start") },
};

mkdirSync(join(here, "..", "src", "flare-site"), { recursive: true });
writeFileSync(join(here, "..", "src", "flare-site", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/flare-site/captures.json", Object.keys(out), out.exits);
