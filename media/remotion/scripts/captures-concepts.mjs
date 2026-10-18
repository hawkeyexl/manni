// Turn the real captures in media/capture-concepts/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-concepts");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  grep: read("grep-concepts.txt"),
  "check before": read("check-before.ans"),
  fill: read("fill.ans"),
  "check after": read("check-after.ans"),
  build: read("build.ans"),
  "graph check": read("graph-check.ans"),
  exits: {
    "check before": read("check-before.exit").trim(),
    fill: read("fill.exit").trim(),
    "check after": read("check-after.exit").trim(),
    build: read("build.exit").trim(),
    "graph check": read("graph-check.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "concepts"), { recursive: true });
writeFileSync(join(here, "..", "src", "concepts", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/concepts/captures.json", Object.keys(out));
