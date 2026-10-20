// Turn the real captures in media/capture-findings/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-findings");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat dcmi-bad-date.md": read("cat-page.txt"),
  before: read("before.ans"),
  after: read("after.ans"),
  show: read("show.ans"),
  cite: read("cite.ans"),
  exits: {
    before: read("before.exit").trim(),
    after: read("after.exit").trim(),
    show: read("show.exit").trim(),
    cite: read("cite.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "findings"), { recursive: true });
writeFileSync(join(here, "..", "src", "findings", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/findings/captures.json", Object.keys(out));
