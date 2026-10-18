// Turn the real captures in media/capture-test/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-test");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat fail.md": read("cat-fail.txt"),
  fail: read("fail.ans"),
  github: read("github.ans"),
  pass: read("pass.ans"),
  exits: {
    fail: read("fail.exit").trim(),
    github: read("github.exit").trim(),
    pass: read("pass.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "test"), { recursive: true });
writeFileSync(join(here, "..", "src", "test", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/test/captures.json", Object.keys(out));
