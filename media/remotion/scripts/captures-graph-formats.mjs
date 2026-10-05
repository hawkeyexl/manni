// Turn the real captures in media/graph/capture-formats/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "graph", "capture-formats");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  // `manni graph build ... > /dev/null` shows only stderr, which is what these hold (empty).
  buildMd: read("build-md.ans"),
  statsMd: read("stats-md.ans"),
  buildAll: read("build-all.ans"),
  statsAll: read("stats-all.ans"),
  traverse: read("traverse.ans"),
  exits: {
    buildMd: read("build-md.exit").trim(),
    statsMd: read("stats-md.exit").trim(),
    buildAll: read("build-all.exit").trim(),
    statsAll: read("stats-all.exit").trim(),
    traverse: read("traverse.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "graph-formats"), { recursive: true });
writeFileSync(join(here, "..", "src", "graph-formats", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/graph-formats/captures.json", Object.keys(out));
