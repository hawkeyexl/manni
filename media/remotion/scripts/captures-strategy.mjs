// Turn the real captures in media/capture-strategy/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-strategy");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat strategy/journeys/m1.md": read("cat-journey.txt"),
  "cat docs/guide.md": read("cat-page.txt"),
  checkBefore: read("check-before.ans"),
  diff: read("diff.ans"),
  checkAfter: read("check-after.ans"),
  list: read("list.ans"),
  exits: {
    checkBefore: read("check-before.exit").trim(),
    diff: read("diff.exit").trim(),
    checkAfter: read("check-after.exit").trim(),
    list: read("list.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "strategy"), { recursive: true });
writeFileSync(join(here, "..", "src", "strategy", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/strategy/captures.json", Object.keys(out));
