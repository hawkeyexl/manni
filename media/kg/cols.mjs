// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// Run from media/: node kg/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("kg/capture/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const IRI = "https://acme.dev/doc/docs/configuration.md";
const beats = {
  b1: ["$ grep -rl configuration.md docs/", ...rd("grep.ans"), "$ "],
  b2: [
    "$ manni kg build docs/",
    ...rd("build.ans"),
    `$ manni kg traverse ${IRI} --predicates dcterms:references --impact -d 2`,
    ...rd("traverse.ans"),
    "$ ",
  ],
  b3: [
    "$ manni kg query --p kg:brokenLink",
    ...rd("query.ans"),
    "$ manni kg stats --check > /dev/null; echo $?",
    "1",
    "$ ",
  ],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const longestToken = Math.max(...all.map((l) => { const ind = l.match(/^ */)[0].length; return Math.max(...l.trim().split(/ +/).map((t) => t.length + ind)); }));
console.log("longest token incl. indent:", longestToken);
function wrap(line, cols) {
  const indent = line.match(/^ */)[0]; const rows = []; let rest = line;
  while (rest.length > cols) { let k = rest.lastIndexOf(" ", cols); if (k <= indent.length) return null; rows.push(rest.slice(0, k).replace(/ +$/, "")); rest = indent + rest.slice(k + 1).replace(/^ +/, ""); }
  rows.push(rest); return rows;
}
for (let px = 30; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px)); const lh = Math.round(px * 1.4);
  let ok = true; const r = {}; let orphan = 0;
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; n = NaN; break; } n += w.length; if (w.length > 1 && !w[w.length - 1].trim().includes(" ")) orphan++; } r[k] = n; }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} orphans ${orphan} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
// The loop above derives the widest cols a font size *allows*. It is an upper
// bound, not the answer: the wrapper fills every long row to exactly `cols`, so
// the chosen cols is what sets the right margin, whatever the font size. Passing
// cols explicitly is how this video lands 66 px of right margin instead of 25.
// 72 is the floor here — the two `kg query` rows are 72 characters, and wrapping
// either one orphans a bare `"missing.md"` onto its own row.
// Usage: node kg/cols.mjs [px] [cols]
const pick = Number(process.argv[2] ?? 23);
const cols = Number(process.argv[3] ?? Math.floor(1040 / (0.6 * pick)));
const inset = 20;
const right = 1080 - inset - cols * 0.6 * pick;
console.log(`\n--- rows at ${pick}px / ${cols} cols — a filled row ends ${right.toFixed(0)}px from the frame edge`);
for (const l of all) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|");
