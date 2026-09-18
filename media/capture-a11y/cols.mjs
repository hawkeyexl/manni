// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// The wrap below is the replay's own (src/Demo.tsx wrapLine): trailing spaces count,
// and a continuation row carries the line's indent.
// Run from media/: node capture-a11y/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** What a terminal does with a tab: advance to the next multiple of 8. */
const tabs = (l) => { let o = "", c = 0; for (const ch of l) { if (ch === "\t") { const n = 8 - (c % 8); o += " ".repeat(n); c += n; } else { o += ch; c += 1; } } return o; };
/** What a terminal does with `\r` and an erase-line: keep what was drawn last. */
const erase = (l) => { const i = l.lastIndexOf("\r"); return (i === -1 ? l : l.slice(i + 1)).replace(/\x1b\[[0-9]*K/g, ""); };
const rd = (f) => strip(readFileSync("capture-a11y/" + f, "utf8").replace(/\r\n/g, "\n")).replace(/\n$/, "").split("\n").map(erase).map(tabs);

const c1 = "time manni a11y check -q --no-progress";
const c2 = 'time manni a11y check -q --no-progress --exclude "/manni/meta/reference/**"';
const c3 = 'manni a11y check http://127.0.0.1:4321/manni/meta/reference/ --exclude "/manni/meta/reference/**"';

// Beats 1-3 share one screen (beat 2 and 3 continue), so they are measured together.
const beats = {
  "b1-3": ["$ " + c1, ...rd("full.ans"), "$ " + c2, ...rd("excluded.ans"), "$ "],
  b4: ["$ " + c3, ...rd("seed-clash.ans"), "$ echo $?", "2", "$ "],
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
const pick = Number(process.argv[2] ?? 24);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats)) { console.log(`[${k}]`); for (const l of ls) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|"); }
