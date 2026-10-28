// Turn the real captures in media/capture-docevals-formats/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-docevals-formats");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");
const exit = (name) => read(`${name}.exit`).trim();

const out = {
  ls: read("ls.txt"),
  "grep todo": read("grep-todo.txt"),
  manifest: read("manifest.txt"),
  run: read("run.ans"),
  exits: { run: exit("run") },
};

mkdirSync(join(here, "..", "src", "docevals-formats"), { recursive: true });
writeFileSync(join(here, "..", "src", "docevals-formats", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/docevals-formats/captures.json", Object.keys(out), out.exits);
