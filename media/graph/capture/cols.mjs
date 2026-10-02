// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// The wrap below is the replay's own (media/remotion/src/Demo.tsx wrapLine): trailing
// spaces count, and a continuation row carries the line's indent. Typed commands are
// also required to fit one row, because two of them carry a quoted sed script with a
// space inside it, and a break there would split one argument across rows.
// Run from anywhere: node media/graph/capture/cols.mjs [px]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync(join(here, f), "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const ex = (f) => readFileSync(join(here, f), "utf8").trim();

const typed = {
  b1: ["cat docs/terms/progressive-lens.md", "cat docs/fitting.md", "manni term check", "echo $?"],
  b2: ["sed -i 's/^graph:/kg:/' docs/fitting.md", "cat docs/fitting.md", "manni term check", "echo $?"],
  b3: [
    "sed -i 's/^kg:/graph:/; s/concepts:/concept:/' docs/fitting.md",
    "cat docs/fitting.md",
    "manni meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md",
    "echo $?",
  ],
};
const out = {
  b1: [rd("b1-cat-term.txt"), rd("b1-cat-guide.txt"), rd("b1-term-check.ans"), [ex("b1-term-check.exit")]],
  b2: [[], rd("b2-cat-guide.txt"), rd("b2-term-check.ans"), [ex("b2-term-check.exit")]],
  b3: [[], rd("b3-cat-guide.txt"), rd("b3-validate.ans"), [ex("b3-validate.exit")]],
};
const beats = Object.fromEntries(
  Object.keys(typed).map((k) => [k, [...typed[k].flatMap((t, i) => ["$ " + t, ...out[k][i]]), "$ "]]),
);
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const longestTyped = Math.max(...Object.values(typed).flat().map((t) => t.length + 2));
console.log("longest typed command incl. prompt:", longestTyped);
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

for (let px = 32; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px)); const lh = Math.round(px * 1.4);
  let ok = true; const r = {};
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; n = NaN; break; } n += w.length; } r[k] = n; }
  const typedOk = longestTyped <= cols;
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} ${typedOk ? "commands fit" : "COMMAND WRAPS"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 22);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats)) { console.log(`[${k}]`); for (const l of ls) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|"); }
