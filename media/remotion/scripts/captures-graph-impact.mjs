// Turn the real captures in media/graph/capture-impact/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "graph", "capture-impact");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  grep: read("grep.ans"),
  build: read("build.ans"),
  traverse: read("traverse.ans"),
  query: read("query.ans"),
  exits: {
    grep: read("grep.exit").trim(),
    build: read("build.exit").trim(),
    traverse: read("traverse.exit").trim(),
    query: read("query.exit").trim(),
    statsCheck: read("stats-check.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "graph-impact"), { recursive: true });
writeFileSync(join(here, "..", "src", "graph-impact", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/graph-impact/captures.json", Object.keys(out));
