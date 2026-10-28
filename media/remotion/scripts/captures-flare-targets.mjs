// Turn the real captures in media/capture-flare-targets/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-flare-targets");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const out = {
  "grep topic": read("grep-topic.txt"),
  "grep version": read("grep-version.txt"),
  lint: read("lint.ans"),
  build: read("build.ans"),
  export: read("export.ans"),
  "grep passage": read("grep-passage.txt"),
  "grep printonly": read("grep-printonly.txt"),
  "grep keyword": read("grep-keyword.txt"),
  get: read("get.ans"),
};

mkdirSync(join(here, "..", "src", "flare-targets"), { recursive: true });
writeFileSync(join(here, "..", "src", "flare-targets", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/flare-targets/captures.json", Object.keys(out));
