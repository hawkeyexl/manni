// Turn the real captures in media/capture-provenance/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-provenance");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "git diff": read("diff1.ans"),
  "derive uncommitted": read("derive1.ans"),
  "head -7": read("head1.txt"),
  "git diff -U0": read("diff2.ans"),
  "validate stale": read("validate1.ans"),
  "derive again": read("derive2.ans"),
  "get provenance": read("get.ans"),
  "validate clean": read("validate2.ans"),
  exits: {
    derive1: read("derive1.exit").trim(),
    validate1: read("validate1.exit").trim(),
    derive2: read("derive2.exit").trim(),
    get: read("get.exit").trim(),
    validate2: read("validate2.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "provenance"), { recursive: true });
writeFileSync(join(here, "..", "src", "provenance", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/provenance/captures.json", Object.keys(out));
