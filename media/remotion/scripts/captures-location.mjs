// Turn the real captures in media/capture-location/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-location");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat page": read("cat-page1.txt"),
  "cat schema": read("cat-schema.txt"),
  "validate warns": read("validate1.ans"),
  relocate: read("relocate.ans"),
  "cat manifest": read("cat-manifest.txt"),
  "git diff -U1": read("diff-all.ans"),
  "validate clean": read("validate2.ans"),
  exits: {
    validate1: read("validate1.exit").trim(),
    relocate: read("relocate.exit").trim(),
    validate2: read("validate2.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "location"), { recursive: true });
writeFileSync(join(here, "..", "src", "location", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/location/captures.json", Object.keys(out));
