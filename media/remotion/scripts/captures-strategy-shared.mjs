// Turn the real captures in media/strategy-shared/capture/ into JSON the composition imports.
// Bytes in, bytes out (CRLF normalised to LF only). No edits. The join's typed
// line is join.txt, the file capture.sh ran, so the screen shows what ran.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "strategy-shared", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

const expected = { "check-copy": "1", rm: "0", "check-borrowed": "0", lists: "0", join: "0" };
for (const [name, code] of Object.entries(expected))
  if (read(`${name}.exit`).trim() !== code) throw new Error(`${name} exited ${read(`${name}.exit`).trim()}, expected ${code}`);

const out = {
  checkCopy: read("check-copy.ans"),
  rm: read("rm.ans"),
  checkBorrowed: read("check-borrowed.ans"),
  lists: read("lists.ans"),
  joinTyped: read("join.txt").replace(/\n$/, ""),
  join: read("join.ans"),
  exits: { checkCopy: read("check-copy.exit").trim(), checkBorrowed: read("check-borrowed.exit").trim() },
};
if (out.lists !== "") throw new Error("the redirected lists printed to the terminal");

mkdirSync(join(here, "..", "src", "strategy-shared"), { recursive: true });
writeFileSync(join(here, "..", "src", "strategy-shared", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/strategy-shared/captures.json", Object.keys(out));
