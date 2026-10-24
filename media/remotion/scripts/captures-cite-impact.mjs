// Turn the real captures in media/cite-impact/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "cite-impact");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat pages/guide.meta.yaml": read("cat-sidecar.txt"),
  checkBefore: read("check-before.ans"),
  diff: read("diff.ans"),
  github: read("github.ans"),
  pretty: read("pretty.ans"),
  exits: {
    checkBefore: read("check-before.exit").trim(),
    diff: read("diff.exit").trim(),
    github: read("github.exit").trim(),
    pretty: read("pretty.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "cite-impact"), { recursive: true });
writeFileSync(join(here, "..", "src", "cite-impact", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/cite-impact/captures.json", Object.keys(out));
