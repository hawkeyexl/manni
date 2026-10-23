// Turn the real captures in media/plugin-metadata/capture/ into JSON the composition imports.
// Bytes in, bytes out (CRLF normalised to LF only). The one edit is beat 5's two advisory
// notices, replaced by a marker line the composition draws as chrome (see beats.ts).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const capture = join(here, "..", "..", "plugin-metadata", "capture");
const read = (name) => readFileSync(join(capture, name), "utf8").replace(/\r\n/g, "\n");

// graph.times is "<ms since start>\t<line>". The first line lands alone (the publish
// begins); the lines after it land together a moment later. Keep that real gap.
const rows = read("graph.times").trimEnd().split("\n").map((l) => {
  const i = l.indexOf("\t");
  return { ms: Number(l.slice(0, i)), line: l.slice(i + 1) };
});
const [first, ...rest] = rows;
const notices = rest.filter((r) => /no docevals report|no vector sidecar/.test(r.line));
if (notices.length !== 2) throw new Error("expected the two advisory notices in graph.times");
const kept = rest.filter((r) => !notices.includes(r));
const tail = [`@@cut@@… ${notices.length} advisory lines left out`, ...kept.map((r) => r.line)].join("\n") + "\n";

const out = {
  head: read("head.ans"),
  sidecar: read("sidecar.ans"),
  get: read("get.ans"),
  read1: read("read1.ans"),
  read2: read("read2.ans"),
  read3: read("read3.ans"),
  graphFirst: first.line + "\n",
  graphRest: tail,
  graphGapMs: notices[0].ms - first.ms,
};

mkdirSync(join(here, "..", "src", "plugin-metadata"), { recursive: true });
writeFileSync(join(here, "..", "src", "plugin-metadata", "captures.json"), JSON.stringify(out, null, 2));
console.log("wrote src/plugin-metadata/captures.json", Object.keys(out));
