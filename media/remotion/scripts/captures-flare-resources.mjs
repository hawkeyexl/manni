// Turn the real captures in media/capture-flare-resources/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-flare-resources");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");
const exit = (name) => read(`${name}.exit`).trim();

const out = {
  term: read("term.ans"),
  "grep marker": read("grep-marker.txt"),
  get: read("get.ans"),
  undefined: read("undefined.ans"),
  validate: read("validate.ans"),
  exits: { term: exit("term"), undefined: exit("undefined"), validate: exit("validate") },
};

mkdirSync(join(here, "..", "src", "flare-resources"), { recursive: true });
writeFileSync(join(here, "..", "src", "flare-resources", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/flare-resources/captures.json", Object.keys(out), out.exits);
