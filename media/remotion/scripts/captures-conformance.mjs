// Turn the real captures in media/conformance/capture/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "conformance", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat CLAUDE.md": read("cat-claude-md.txt"),
  grep: read("grep-commands.txt"),
  check: read("check.ans"),
  "cat stop.json": read("cat-stop-json.txt"),
  hook: read("hook.ans"),
  exits: {
    check: read("check.exit").trim(),
    hook: read("hook.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "conformance"), { recursive: true });
writeFileSync(join(here, "..", "src", "conformance", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/conformance/captures.json", Object.keys(out));
