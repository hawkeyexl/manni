// Turn the real captures in media/family-check/capture/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "family-check", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  status: read("status.ans"),
  check1: read("check1.ans"),
  "cat hook-edit.json": read("cat-hook-edit.txt"),
  hook: read("hook.ans"),
  check2: read("check2.ans"),
  exits: {
    status: read("status.exit").trim(),
    check1: read("check1.exit").trim(),
    hook: read("hook.exit").trim(),
    check2: read("check2.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "family-check"), { recursive: true });
writeFileSync(join(here, "..", "src", "family-check", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/family-check/captures.json", Object.keys(out));
