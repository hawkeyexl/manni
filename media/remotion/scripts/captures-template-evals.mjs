// Turn the real captures in media/capture-template-evals/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-template-evals");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");
const exit = (name) => read(`${name}.exit`).trim();

const out = {
  page: read("page.txt"),
  template: read("template.txt"),
  list: read("list.ans"),
  run: read("run.ans"),
  exits: { list: exit("list"), run: exit("run") },
};

mkdirSync(join(here, "..", "src", "template-evals"), { recursive: true });
writeFileSync(join(here, "..", "src", "template-evals", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/template-evals/captures.json", Object.keys(out), out.exits);
