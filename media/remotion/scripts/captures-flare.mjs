// Turn the real captures in media/capture-flare/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-flare");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "grep title": read("grep-title.txt"),
  "grep xref": read("grep-xref.txt"),
  get: read("get.ans"),
  validate: read("validate.ans"),
  query: read("query.ans"),
  diff: read("diff.ans"),
  build: read("build.ans"),
  "grep stats": read("grep-stats.txt"),
  exits: {
    validate: read("validate.exit").trim(),
    stats: read("stats.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "flare"), { recursive: true });
writeFileSync(join(here, "..", "src", "flare", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/flare/captures.json", Object.keys(out));
