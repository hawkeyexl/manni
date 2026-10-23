// Turn the real captures in media/check-impact/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "check-impact");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");
const ms = Object.fromEntries(
  read("latency.txt")
    .trim()
    .split("\n")
    .map((l) => /^(\S+) exit .* (\d+) ms$/.exec(l))
    .map((m) => [m[1], Number(m[2])]),
);

const out = {
  checkRed: read("check-red.ans"),
  jq: read("jq.txt"),
  accept: read("accept.ans"),
  checkGreen: read("check-green.ans"),
  ms,
  exits: {
    checkRed: read("check-red.exit").trim(),
    jq: read("jq.pipestatus").trim(),
    accept: read("accept.exit").trim(),
    checkGreen: read("check-green.exit").trim(),
  },
};

mkdirSync(join(here, "..", "src", "check-impact"), { recursive: true });
writeFileSync(join(here, "..", "src", "check-impact", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/check-impact/captures.json", out.ms, out.exits);
