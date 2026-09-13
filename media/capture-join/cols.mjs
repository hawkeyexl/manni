// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space to rows with no orphaned last word.
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-join/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const mv = "mkdir -p docs/guides && mv docs/auth.md docs/guides/authentication.md";
const q = `manni meta query "UPDATE docs SET id = 'other' WHERE _path = 'docs/guides/authentication.md'"`;
const beats = {
  b1: ["$ cat manni.config.yaml", ...rd("cat-manni.config.yaml.txt"), "$ cat docs-meta.yaml", ...rd("cat-docs-meta.yaml.txt"), "$ "],
  b23: ["$ " + mv, "$ manni meta validate", ...rd("validate.ans"), "$ echo $?", "1", "$ "],
  b45: ["$ " + q, ...rd("query.ans"), "$ echo $?", "2", "$ "],
};
const all = Object.values(beats).flat();
console.log("longest line:", Math.max(...all.map((l) => l.length)), "chars");
function wrap(line, cols) {
  const indent = line.match(/^ */)[0]; const rows = []; let rest = line;
  while (rest.length > cols) { let k = rest.lastIndexOf(" ", cols); if (k <= indent.length) return null; rows.push(rest.slice(0, k).replace(/ +$/, "")); rest = indent + rest.slice(k + 1); }
  rows.push(rest); return rows;
}
for (let px = 30; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px)); const lh = Math.round(px * 1.4);
  let ok = true; const r = {}; let orphan = 0;
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; break; } n += w.length; if (w.length > 1 && !w[w.length - 1].trim().includes(" ")) orphan++; } r[k] = n; }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} orphans ${orphan} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 23);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const l of all) for (const w of wrap(l, cols)) console.log("|" + w.padEnd(cols) + "|");
