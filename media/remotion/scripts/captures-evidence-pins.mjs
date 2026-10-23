// Turn the real captures in media/evidence-pins/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "evidence-pins");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");
const names = ["add", "check-current", "diff-persona", "check-moved", "update", "diff-note", "check-changed"];

const out = {
  catPersona: read("cat-persona.txt"),
  ...Object.fromEntries(names.map((n) => [n, read(`${n}.ans`)])),
  exits: Object.fromEntries(names.map((n) => [n, read(`${n}.exit`).trim()])),
};

mkdirSync(join(here, "..", "src", "evidence-pins"), { recursive: true });
writeFileSync(join(here, "..", "src", "evidence-pins", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/evidence-pins/captures.json", Object.keys(out));
