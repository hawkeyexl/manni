// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// The wrap below is the replay's own (media/remotion/src/Demo.tsx wrapLine): trailing
// spaces count, and a continuation row carries the line's indent. Typed commands are
// also required to fit one row, so the fill command reads as one line, as typed.
// bash's `time` tab is expanded to 8-column stops, as the replay does.
// Run from anywhere: node media/vocabularies/capture/cols.mjs [px]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const tabs = (l) => { let o = ""; for (const ch of l) o += ch === "\t" ? " ".repeat(8 - (o.length % 8)) : ch; return o; };
const rd = (f) => strip(readFileSync(join(here, f), "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n").map(tabs);
const ex = (f) => readFileSync(join(here, f), "utf8").trim();
const n = ex("b4-head-n.txt");

const typed = {
  b1: ["cat page.md"],
  b2: ["manni meta validate page.md", "echo $?"],
  b3: ["time manni meta fill page.md --fields description,audiences,lifecycle"],
  b4: [`head -n ${n} page.md`],
  b5: ["manni meta validate page.md", "echo $?"],
};
const out = {
  b1: [rd("b1-cat-page.txt")],
  b2: [rd("b2-validate.ans"), [ex("b2-validate.exit")]],
  b3: [rd("b3-fill.ans")],
  b4: [rd("b4-head-page.txt")],
  b5: [rd("b5-validate.ans"), [ex("b5-validate.exit")]],
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
  for (const [k, ls] of Object.entries(beats)) { let m = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; m = NaN; break; } m += w.length; } r[k] = m; }
  const typedOk = longestTyped <= cols;
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} ${typedOk ? "commands fit" : "COMMAND WRAPS"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 23);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats)) { console.log(`[${k}]`); for (const l of ls) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|"); }
