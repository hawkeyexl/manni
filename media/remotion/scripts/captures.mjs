// Turn the real captures in media/capture/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat docs/auth.md": read("cat-auth.md.txt"),
  "cat docs-meta.yaml": read("cat-docs-meta.yaml.txt"),
  "cat manni.config.yaml": read("cat-manni.config.yaml.txt"),
  "manni meta validate": read("validate.ans"),
  "manni meta query": read("query.ans"),
  exits: {
    validate: read("validate.exit").trim(),
    query: read("query.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src"), { recursive: true });
writeFileSync(join(here, "..", "src", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/captures.json", Object.keys(out));
