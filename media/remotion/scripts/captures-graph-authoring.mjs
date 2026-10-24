// Turn the real captures in media/capture-graph-authoring/ into JSON the composition imports.
// Bytes in, bytes out (CRLF normalised to LF only). No edits. The server's lines keep
// the arrival time capture.sh stamped on each, in ms from the start of the run.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "capture-graph-authoring");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

for (const name of ["internal", "traverse", "readers", "query", "server"])
  if (read(`${name}.exit`).trim() !== "0") throw new Error(`${name} exited ${read(`${name}.exit`).trim()}`);

const server = read("server.times")
  .replace(/\n$/, "")
  .split("\n")
  .map((row) => {
    const tab = row.indexOf("\t");
    return { ms: Number(row.slice(0, tab)), line: row.slice(tab + 1) };
  });

const out = {
  internal: read("internal.ans"),
  traverse: read("traverse.ans"),
  readers: read("readers.ans"),
  query: read("query.ans"),
  server,
};

mkdirSync(join(here, "..", "src", "graph-authoring"), { recursive: true });
writeFileSync(join(here, "..", "src", "graph-authoring", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/graph-authoring/captures.json", Object.keys(out));
