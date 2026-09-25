// Turn the real captures in media/capture-lint/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "lint-templates", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "cat page": read("cat-page.txt"),
  "cat stub": read("cat-stub.txt"),
  "lint wall": read("lint-wall.ans"),
  "infer stdout": read("infer-stdout.ans"),
  "infer write": read("infer-write.ans"),
  "lint pass": read("lint-pass.ans"),
  "lint broken": read("lint-broken.ans"),
  exits: {
    lintWall: read("lint-wall.exit").trim(),
    inferStdout: read("infer-stdout.exit").trim(),
    inferWrite: read("infer-write.exit").trim(),
    lintPass: read("lint-pass.exit").trim(),
    lintBroken: read("lint-broken.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "lint"), { recursive: true });
writeFileSync(join(here, "..", "src", "lint", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/lint/captures.json", Object.keys(out));
