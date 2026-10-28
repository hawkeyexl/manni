// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space (or after a "/" inside a URL), within the
// frame. The wrap below is the replay's own (src/Demo.tsx wrapLine): trailing spaces
// count, and a continuation row carries the line's indent, or `hang` when deeper.
// Run from media/: node capture-flare-site/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-flare-site/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const ex = (f) => readFileSync("capture-flare-site/" + f, "utf8").trim();
const beats = {
  b1: ["$ ls", ...rd("ls.txt"), "$ tail -3 manni.config.yaml", ...rd("tail-config.txt"), "$ "],
  b2: ["$ manni site build; echo $?", ...rd("build.ans"), ex("build.exit"), "$ "],
  b3: ["$ manni site preview", ...rd("preview.ans")],
  b4: ["$ curl -s http://127.0.0.1:4321/ | head -3", ...rd("curl.txt"), "$ "],
  b5: ["$ curl -s http://127.0.0.1:4321/ | head -3", ...rd("curl.txt"), "$ manni site start; echo $?", ...rd("start.ans"), ex("start.exit"), "$ "],
};
const BREAK_AFTER = "/";
const HANG = Number(process.argv[3] ?? 0);
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
function wrap(line, cols) {
  if (line.length <= cols) return [line];
  const own = line.match(/^ */)[0]; const indent = own.length >= HANG ? own : " ".repeat(HANG);
  const rows = []; let start = 0; let first = true; let hard = false;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (line.length - start <= width) break;
    const limit = start + width;
    let k = line.lastIndexOf(" ", limit);
    const floor = start + (first ? indent.length : 0);
    if (k <= floor) {
      const s = Math.max(-1, ...[...BREAK_AFTER].map((ch) => line.lastIndexOf(ch, limit - 1)));
      if (s > floor) k = s + 1; else { k = limit; hard = true; }
    }
    let end = k; while (end > start && line[end - 1] === " ") end--;
    rows.push((first ? "" : indent) + line.slice(start, end));
    let next = k; while (line[next] === " ") next++;
    start = next; first = false;
  }
  rows.push((first ? "" : indent) + line.slice(start));
  return hard ? null : rows;
}
for (let px = 30; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px)); const lh = Math.round(px * 1.4);
  let ok = true; const r = {};
  for (const [k, ls] of Object.entries(beats)) { let n = 0; for (const l of ls) { const w = wrap(l, cols); if (!w) { ok = false; n = NaN; break; } n += w.length; } r[k] = n; }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "HARD BREAK"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 22);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols, hang ${HANG}`);
for (const [k, ls] of Object.entries(beats)) { console.log(`[${k}]`); for (const l of ls) for (const w of wrap(l, cols) ?? [l + "   <-- HARD BREAK"]) console.log("|" + w.padEnd(cols) + "|"); }
