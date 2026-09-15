// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// Run from media/: node capture-location/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-location/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const beats = {
  b1: ["$ cat docs/install.md", ...rd("cat-page1.txt"), "$ cat page.schema.json", ...rd("cat-schema.txt"), "$ "],
  b2: ["$ manni meta validate", ...rd("validate1.ans"), "$ echo $?", "0", "$ "],
  b3: ["$ manni meta relocate", ...rd("relocate.ans"), "$ cat site.metadata.yaml", ...rd("cat-manifest.txt"), "$ "],
  b4: ["$ git diff -U1", ...rd("diff-all.ans"), "$ "],
  b5: ["$ manni meta validate", ...rd("validate2.ans"), "$ echo $?", "0", "$ "],
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
const pick = Number(process.argv[2] ?? 23);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const l of all) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|");
