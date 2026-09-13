// Turn the real captures in media/capture-collections/ into JSON the composition
// imports. Nothing here edits output: bytes in, bytes out (CRLF -> LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-collections");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat manni.config.yaml (old)": read("cat-config-old.txt"),
  "cat manni.config.yaml (new)": read("cat-config-new.txt"),
  "manni meta validate (refused)": read("validate-refused.ans"),
  "manni meta validate": read("validate.ans"),
  "manni a11y check --collection guides": read("a11y.ans"),
  exits: {
    refused: read("validate-refused.exit").trim(),
    validate: read("validate.exit").trim(),
    a11y: read("a11y.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "collections"), { recursive: true });
writeFileSync(join(here, "..", "src", "collections", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/collections/captures.json", Object.keys(out));
