// Turn the real captures in media/capture-tracevals/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-tracevals");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat CLAUDE.md": read("cat-claude-md.txt"),
  "run session-1": read("run1.ans"),
  "run session-2": read("run2.ans"),
  exits: {
    run1: read("run1.exit").trim(),
    run2: read("run2.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "tracevals"), { recursive: true });
writeFileSync(join(here, "..", "src", "tracevals", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/tracevals/captures.json", Object.keys(out));
