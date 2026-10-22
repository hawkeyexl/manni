// Turn the real captures in media/capture-repos/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-repos");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  config: read("cat-config.txt"),
  b1api: read("b1-api.ans"),
  b1sdk: read("b1-sdk.ans"),
  b3: read("b3-check.ans"),
  b4: read("b4-log.ans"),
  b5: read("b5-check.ans"),
  exits: {
    b1api: read("b1-api.exit").trim(),
    b1sdk: read("b1-sdk.exit").trim(),
    b3: read("b3-check.exit").trim(),
    b5: read("b5-check.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "cite-repos"), { recursive: true });
writeFileSync(join(here, "..", "src", "cite-repos", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/cite-repos/captures.json", Object.keys(out));
