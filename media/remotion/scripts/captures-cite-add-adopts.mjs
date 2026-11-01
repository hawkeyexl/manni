// Turn the real captures in media/capture-cite-adopts/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-cite-adopts");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  b1: read("b1-cat.ans"),
  b2: read("b2-check.ans"),
  b3: read("b3-add.ans"),
  b4: read("b4-add.ans"),
  b5: read("b5-check.ans"),
  b5diff: read("b5-diff.ans"),
  exits: {
    b2: read("b2-check.exit").trim(),
    b5: read("b5-check.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "cite-add-adopts"), { recursive: true });
writeFileSync(join(here, "..", "src", "cite-add-adopts", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/cite-add-adopts/captures.json", Object.keys(out));
