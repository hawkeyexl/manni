// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// The wrap below is the replay's own (src/Demo.tsx wrapLine): trailing spaces count,
// and a continuation row carries the line's indent.
// Run from media/: node capture-tbx/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-tbx/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const beats = {
  b1: ["$ grep -E '<(conceptEntry|langSec|term)[ >]' glossary.tbx", ...rd("grep-tbx.txt"), "$ "],
  b2: ["$ manni term list glossary.tbx", ...rd("list.ans"), "$ "],
  b3: ["$ manni term get PAL glossary.tbx", ...rd("get.ans"), "$ "],
  b4: ["$ manni term write glossary.tbx -f tbx3 -o build/glossary.tbx", ...rd("write-tbx3.ans"), "$ manni term list build/glossary.tbx", ...rd("list-build.ans"), "$ cmp glossary.tbx build/glossary.tbx && echo same bytes", "same bytes", "$ "],
  b5: ["$ manni term write glossary.tbx", ...rd("write-inplace.ans"), "$ manni term check glossary.tbx; echo $?", ...rd("check.ans"), "0", "$ "],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const longestToken = Math.max(...all.map((l) => { const ind = l.match(/^ */)[0].length; return Math.max(...l.trim().split(/ +/).map((t) => t.length + ind)); }));
console.log("longest token incl. indent:", longestToken);
function wrap(line, cols) {
  if (line.length <= cols) return [line];
  const indent = line.match(/^ */)[0]; const rows = []; let start = 0; let first = true;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (line.length - start <= width) break;
    const k = line.lastIndexOf(" ", start + width);
    if (k <= start + (first ? indent.length : 0)) return null;
    rows.push((first ? "" : indent) + line.slice(start, k).replace(/ +$/, ""));
    let next = k; while (line[next] === " ") next++;
    start = next; first = false;
  }
  rows.push((first ? "" : indent) + line.slice(start));
  return rows;
}
for (let px = 30; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px)); const lh = Math.round(px * 1.4);
  let ok = true; const r = {};
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; n = NaN; break; } n += w.length; } r[k] = n; }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 23);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats)) { console.log(`[${k}]`); for (const l of ls) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|"); }
