// Turn the real captures in media/capture-personas/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-personas");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat docs/one-reader.md": read("cat-page.txt"),
  runBefore: read("run-before.ans"),
  diff: read("diff.ans"),
  runAfter: read("run-after.ans"),
  exits: {
    runBefore: read("run-before.exit").trim(),
    diff: read("diff.exit").trim(),
    runAfter: read("run-after.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "personas"), { recursive: true });
writeFileSync(join(here, "..", "src", "personas", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/personas/captures.json", Object.keys(out));
