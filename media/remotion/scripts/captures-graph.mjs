// Turn the real captures in media/graph/capture/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "graph", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "b1 cat term": read("b1-cat-term.txt"),
  "b1 cat guide": read("b1-cat-guide.txt"),
  "b1 term check": read("b1-term-check.ans"),
  "b2 cat guide": read("b2-cat-guide.txt"),
  "b2 term check": read("b2-term-check.ans"),
  "b3 cat guide": read("b3-cat-guide.txt"),
  "b3 validate": read("b3-validate.ans"),
  exits: {
    b1: read("b1-term-check.exit").trim(),
    b2: read("b2-term-check.exit").trim(),
    b3: read("b3-validate.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "graph"), { recursive: true });
writeFileSync(join(here, "..", "src", "graph", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/graph/captures.json", Object.keys(out));
