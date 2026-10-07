// Turn the real captures in media/session-rules/capture/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "session-rules", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  prompts: read("grep-prompts.txt"),
  edits: read("grep-edits.txt"),
  done: read("grep-done.txt"),
  check: read("check.ans"),
  sources: read("sources.ans"),
  exits: {
    check: read("check.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "session-rules"), { recursive: true });
writeFileSync(join(here, "..", "src", "session-rules", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/session-rules/captures.json", Object.keys(out));
