// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// Run from media/: node graph/graph-formats-cols.mjs [px] [cols]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("graph/capture-formats/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const IRI = "https://example.com/formats/doc/index.md";
const STATS = "$ manni graph stats --top 6 | head -13";
const beats = {
  b1: ["$ manni graph build --ext .md,.mdx,.markdown > /dev/null", STATS, ...rd("stats-md.ans"), "$ "],
  b2: ["$ manni graph build > /dev/null", STATS, ...rd("stats-all.ans"), "$ "],
  b3: [`$ manni graph traverse ${IRI} --predicates dcterms:references --impact`, ...rd("traverse.ans"), "$ "],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const outputOnly = all.filter((l) => !l.startsWith("$ "));
console.log("longest output line:", Math.max(...outputOnly.map((l) => l.length)));
const longestToken = Math.max(...all.map((l) => { const ind = l.match(/^ */)[0].length; return Math.max(...l.trim().split(/ +/).map((t) => t.length + ind)); }));
console.log("longest token incl. indent:", longestToken);
function wrap(line, cols) {
  const indent = line.match(/^ */)[0]; const rows = []; let rest = line;
  while (rest.length > cols) { let k = rest.lastIndexOf(" ", cols); if (k <= indent.length) return null; rows.push(rest.slice(0, k).replace(/ +$/, "")); rest = indent + rest.slice(k + 1).replace(/^ +/, ""); }
  rows.push(rest); return rows;
}
// The terminal band is 1080 - 112 - 86 - 2*2 = 878 px tall; 20 px insets leave 838.
for (let px = 32; px >= 20; px--) {
  const cols = Math.floor(1040 / (0.6 * px)); const lh = Math.round(px * 1.4);
  let ok = true; const r = {}; let orphan = 0; let wrappedOutput = 0;
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; n = NaN; break; } n += w.length; if (w.length > 1 && !l.startsWith("$ ")) wrappedOutput++; if (w.length > 1 && !w[w.length - 1].trim().includes(" ")) orphan++; } r[k] = n; }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} orphans ${orphan} wrapped-output ${wrappedOutput} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 26);
const cols = Number(process.argv[3] ?? Math.floor(1040 / (0.6 * pick)));
const inset = 20;
const right = 1080 - inset - cols * 0.6 * pick;
console.log(`\n--- rows at ${pick}px / ${cols} cols — a filled row ends ${right.toFixed(0)}px from the frame edge`);
for (const l of all) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|");
