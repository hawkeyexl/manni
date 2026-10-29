// Turn the real captures in media/capture-metadata-dir/ into JSON the composition imports.
// Nothing here edits output: bytes in, bytes out (CRLF normalised to LF only).
// Every manni run prints "Using manni.config.yaml (.)" on stderr first, then its
// result a few frames later (the .stamped files), so each is kept as two chunks:
// the config line, then the rest.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-metadata-dir");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");
const exit = (name) => read(`${name}.exit`).trim();
const split = (name) => {
  const all = read(`${name}.ans`);
  const cut = all.indexOf("\n") + 1;
  if (!all.startsWith("Using manni.config.yaml") || cut === 0) throw new Error(`${name}.ans: expected the config line first, got ${JSON.stringify(all)}`);
  return { using: all.slice(0, cut), rest: all.slice(cut) };
};

const out = {
  "cat sidecar": read("cat-sidecar.txt"),
  "validate orphan": split("validate-orphan"),
  relocate: split("relocate"),
  "cat manifest": read("cat-manifest.txt"),
  "validate renamed": split("validate-renamed"),
  get: split("get"),
  "env missing": split("env-missing"),
  exits: {
    "validate orphan": exit("validate-orphan"),
    relocate: exit("relocate"),
    "validate renamed": exit("validate-renamed"),
    get: exit("get"),
    "env missing": exit("env-missing"),
  },
};

mkdirSync(join(here, "..", "src", "metadata-dir"), { recursive: true });
writeFileSync(join(here, "..", "src", "metadata-dir", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/metadata-dir/captures.json", Object.keys(out), out.exits);
