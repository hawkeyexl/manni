// Turn the real captures in media/system-prompt/capture/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "system-prompt", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  prompt: read("grep-prompt.txt"),
  done: read("grep-done.txt"),
  default: read("default.ans"),
  custom: read("grep-custom.txt"),
  customCheck: read("custom.ans"),
  exits: {
    default: read("default.exit").trim(),
    custom: read("custom.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "system-prompt"), { recursive: true });
writeFileSync(join(here, "..", "src", "system-prompt", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/system-prompt/captures.json", Object.keys(out));
