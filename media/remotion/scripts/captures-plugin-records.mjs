// Turn the real captures in media/plugin-records/capture/ into JSON the composition imports.
// Bytes in, bytes out (CRLF normalised to LF only). No edits: beat 3's page JSON is
// trimmed by the `cut -c -500` typed on screen, not here.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "plugin-records", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

for (const name of ["head", "get", "read", "big", "wc", "tail"])
  if (read(`${name}.exit`).trim() !== "0") throw new Error(`${name} exited ${read(`${name}.exit`).trim()}`);

const out = {
  head: read("head.ans"),
  get: read("get.ans"),
  read: read("read.ans"),
  big: read("big.ans"),
  wc: read("wc.ans"),
  tail: read("tail.ans"),
};
if (out.big !== "") throw new Error("the redirected read printed to the terminal");

mkdirSync(join(here, "..", "src", "plugin-records"), { recursive: true });
writeFileSync(join(here, "..", "src", "plugin-records", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/plugin-records/captures.json", Object.keys(out));
