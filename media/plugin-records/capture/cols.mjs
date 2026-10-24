// Font-size derivation per beat (design.md "Capture geometry"): for each beat, the
// largest size at which every real line fits or wraps at a space (or after a ","
// inside the page JSON, the video's breakAfter), never mid-token, and the beat's
// rows fit the terminal area. Run from media/: node plugin-records/capture/cols.mjs
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("plugin-records/capture/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const STALE = "docs/src/content/docs/cite/ci/stale-windows.mdx";
const BIG = "docs/src/content/docs/cite/reference/cli.mdx";
const beats = {
  b1: ["$ head -4 docs/src/content/docs/cite/ci/stale-windows.meta.yaml", ...rd("head.ans"), "$ "],
  b2: [`$ manni meta get personas ${STALE}`, ...rd("get.ans"), "$ "],
  b3: [`$ read-page ${STALE} | cut -c -500`, ...rd("read.ans"), "$ "],
  b4: [`$ read-page ${BIG} > /tmp/reply.txt`, "$ wc -c /tmp/reply.txt", ...rd("wc.ans"), "$ tail -1 /tmp/reply.txt", ...rd("tail.ans"), "$ "],
};
const BREAK_AFTER = ",";
// The same rule as Demo.tsx's wrapLine; null when a token would hard-break.
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let rest = line;
  let first = true;
  while (rest.length > cols) {
    let k = rest.lastIndexOf(" ", cols);
    if (k <= indent.length) {
      const s = rest.lastIndexOf(BREAK_AFTER, cols - 1);
      if (s <= indent.length) return null;
      k = s + 1;
    }
    rows.push(rest.slice(0, k).replace(/ +$/, ""));
    rest = indent + rest.slice(k).replace(/^ +/, "");
    first = false;
  }
  rows.push(rest);
  return rows;
}
// `b3=23` prints that beat's rows at 23 px, with its row count and short rows.
for (const arg of process.argv.slice(2).filter((a) => a.includes("="))) {
  const [name, px] = arg.split("=");
  const cols = Math.floor(1040 / (0.6 * Number(px)));
  const lh = Math.round(Number(px) * 1.4);
  const rows = beats[name].flatMap((l) => wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]);
  const short = rows.filter((r) => r.trim().length < 12 && r !== "$ ");
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
    best ??= { px, cols, lh, rows, height: rows * lh, wrapped: w.flat() };
  }
  console.log(`${name}: longest ${longest.length}; largest fit ${best.px}px / ${best.cols} cols / line ${best.lh}px, ${best.rows} rows, ${best.height}px`);
  if (process.argv.includes("-v")) for (const r of best.wrapped) console.log("  |" + r.padEnd(best.cols) + "|");
}
