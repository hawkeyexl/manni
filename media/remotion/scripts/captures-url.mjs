// Turn the real captures in media/capture-url/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-url");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat manni.config.yaml (public)": read("cat-manni.config.public.txt"),
  "cat manni.config.yaml (private)": read("cat-manni.config.private.txt"),
  "manni meta validate": read("validate.ans"),
  "manni meta validate (token unset)": read("token-unset.ans"),
  "manni meta validate --offline": read("offline-private.ans"),
  exits: {
    validate: read("validate.exit").trim(),
    tokenUnset: read("token-unset.exit").trim(),
    offline: read("offline-private.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "url"), { recursive: true });
writeFileSync(join(here, "..", "src", "url", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/url/captures.json", Object.keys(out));
