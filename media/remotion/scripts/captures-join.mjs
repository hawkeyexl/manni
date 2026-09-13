// Turn the real captures in media/capture-join/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-join");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat manni.config.yaml": read("cat-manni.config.yaml.txt"),
  "cat docs-meta.yaml": read("cat-docs-meta.yaml.txt"),
  "manni meta validate": read("validate.ans"),
  "manni meta query": read("query.ans"),
  exits: {
    validate: read("validate.exit").trim(),
    query: read("query.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "join"), { recursive: true });
writeFileSync(join(here, "..", "src", "join", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/join/captures.json", Object.keys(out));
