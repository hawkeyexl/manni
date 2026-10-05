// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, and the tallest
// screen fits the 878 px terminal box. The wrap is the replay's own (src/Demo.tsx wrapLine).
// Run from media/remotion, after scripts/captures-docs.mjs: node ../capture-docs/cols.mjs [px]
import { readFileSync } from "node:fs";
const cap = JSON.parse(readFileSync("src/docs/captures.json", "utf8"));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/^@@cut@@/, "");
const lines = (s) => s.replace(/\n$/, "").split("\n").map(strip);

const c = {
  ls: "ls docs",
  grep: 'git grep -h "npx astro" main -- .github',
  preview: "manni docs preview",
  hugo: "manni docs build test/fixtures/docs/hugo",
  a11y: "time manni a11y check -q --no-progress",
};
const beats = {
  b1: ["$ " + c.ls, ...lines(cap.ls), "$ " + c.grep, ...lines(cap.gitGrep), "$ "],
  b2: ["$ " + c.preview, ...cap.preview.chunks.flatMap((k) => lines(k.output)), ""],
  "b3-4": ["$ " + c.hugo, ...lines(cap.hugo), "$ " + c.a11y, ...lines(cap.a11y), "$ echo $?", cap.exits.a11y, "$ "],
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
for (let px = 34; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px)); const lh = Math.round(px * 1.4);
  let ok = true; const r = {};
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; n = NaN; break; } n += w.length; } r[k] = n; }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 28);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats)) { console.log(`[${k}]`); for (const l of ls) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|"); }
