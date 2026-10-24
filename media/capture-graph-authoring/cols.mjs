// Font-size derivation per beat (design.md "Capture geometry"): for each beat, the
// largest size at which every real line fits or wraps at a space (or after a "/"
// inside an IRI or a path, the video's breakAfter), never mid-token, and the beat's
// rows fit the terminal area. Run from media/: node capture-graph-authoring/cols.mjs
// `b2=22 -v` prints one beat's rows at one size.
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-graph-authoring/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const D11 = "https://hawkeyexl.github.io/manni/id/strategy/journey/d11";
const beats = {
  b1: ["$ time manni graph publish -o .manni/graph/internal", ...rd("internal.ans"), "$ "],
  b2: [`$ manni graph traverse -g .manni/graph/internal/graph.ttl ${D11} --reverse --predicates dcterms:isPartOf`, ...rd("traverse.ans"), "$ "],
  b3: [
    "$ time manni graph publish --collection site --no-authoring -o .manni/graph/readers",
    ...rd("readers.ans"),
    "$ manni graph query -g .manni/graph/readers/graph.ttl --predicate dcterms:created",
    ...rd("query.ans"),
    "$ ",
  ],
  b4: ["$ node plugin/manni/hooks/graph-server.mjs < /dev/null", ...rd("server.ans"), "$ "],
};
const BREAK_AFTER = "/";
// The same rule as Demo.tsx's wrapLine; null when a token would hard-break.
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let rest = line;
  while (rest.length > cols) {
    let k = rest.lastIndexOf(" ", cols);
    if (k <= indent.length) {
      const s = rest.lastIndexOf(BREAK_AFTER, cols - 1);
      if (s <= indent.length) return null;
      k = s + 1;
    }
    rows.push(rest.slice(0, k).replace(/ +$/, ""));
    rest = indent + rest.slice(k).replace(/^ +/, "");
  }
  rows.push(rest);
  return rows;
}
for (const arg of process.argv.slice(2).filter((a) => a.includes("="))) {
  const [name, px] = arg.split("=");
  const cols = Math.floor(1040 / (0.6 * Number(px)));
  const lh = Math.round(Number(px) * 1.4);
  const rows = beats[name].flatMap((l) => wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]);
  const short = rows.filter((r) => r.trim().length < 12 && r.trim() !== "$" && r.trim() !== "");
  console.log(`${name} at ${px}px / ${cols} cols: ${rows.length} rows, ${rows.length * lh}px, short rows ${JSON.stringify(short)}`);
  if (process.argv.includes("-v")) for (const r of rows) console.log("  |" + r.padEnd(cols) + "|");
}
if (process.argv.some((a) => a.includes("="))) process.exit(0);
for (const [name, lines] of Object.entries(beats)) {
  const longest = lines.reduce((a, l) => (l.length > a.length ? l : a), "");
  let best;
  for (let px = 40; px >= 16; px--) {
    const cols = Math.floor(1040 / (0.6 * px));
    const lh = Math.round(px * 1.4);
    const w = lines.map((l) => wrap(l, cols));
    if (w.some((x) => x === null)) continue;
    const rows = w.reduce((a, x) => a + x.length, 0);
    if (rows * lh > 838) continue;
    best ??= { px, cols, lh, rows, height: rows * lh };
  }
  console.log(`${name}: longest ${longest.length}; largest fit ${best.px}px / ${best.cols} cols / line ${best.lh}px, ${best.rows} rows, ${best.height}px`);
}
