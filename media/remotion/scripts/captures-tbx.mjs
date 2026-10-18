// Turn the real captures in media/capture-tbx/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-tbx");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  grep: read("grep-tbx.txt"),
  list: read("list.ans"),
  get: read("get.ans"),
  "write tbx3": read("write-tbx3.ans"),
  "list build": read("list-build.ans"),
  "write inplace": read("write-inplace.ans"),
  check: read("check.ans"),
  exits: {
    cmp: read("cmp.exit").trim(),
    check: read("check.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "tbx"), { recursive: true });
writeFileSync(join(here, "..", "src", "tbx", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/tbx/captures.json", Object.keys(out));
