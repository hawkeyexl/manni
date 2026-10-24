// Font-size derivation for check-impact-1x1 (design.md "Capture geometry"),
// with the replay's own wrap (media/remotion/src/Demo.tsx, wrapLine). The
// terminal is 1040 px wide and 838 px tall inside its insets, a glyph is
// 0.6 em and a row 1.4 em, so cols = floor(1040 / (0.6 * px)) and the window
// holds floor(838 / row) rows.
//
// The run prints ~2,700 lines, so what matters is the window on screen at the
// end of each step: the bottom of a run, and the window a scroll-back stops
// at, which opens on the family roll-up's heading. For each, per size, it
// prints the rows that are wrapped, any token broken without a space
// ("split"), and any wrapped line whose last row is one word ("orphan").
// Run from media/: node check-impact/cols.mjs
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("check-impact/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const red = ["$ manni check", "[note]", ...rd("check-red.ans"), "$ "];
const green = ["$ manni cite update --accept | tail -n 1", ...rd("accept.ans"), "$ manni check", "[note]", ...rd("check-green.ans"), "$ "];
const jq = ["$ manni check -f json | jq -r '.impact[] | select(.id == \"m1\") | .pages[]'", "[note]", ...rd("jq.txt"), "$ "];
const HEAD = "The pages with findings serve";

function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let start = 0, first = true, split = 0;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (line.length - start <= width) break;
    const limit = start + width;
    let k = line.lastIndexOf(" ", limit);
    const floor = start + (first ? indent.length : 0);
    if (k <= floor) { k = limit; split++; }
    let end = k; while (end > start && line[end - 1] === " ") end--;
    rows.push(line.slice(start, end));
    let next = k; while (line[next] === " ") next++;
    start = next; first = false;
  }
  rows.push(line.slice(start));
  const orphan = rows.length > 1 && !rows[rows.length - 1].trim().includes(" ");
  return { rows, split, orphan };
}

function windows(lines, cols, cap) {
  const w = lines.map((l) => wrap(l, cols));
  const owner = w.flatMap((r, i) => r.rows.map(() => i));
  const bottom = Math.max(0, owner.length - cap);
  const head = lines.map((l, i) => (l.includes(HEAD) ? i : -1)).filter((i) => i >= 0).pop();
  const at = head === undefined ? bottom : Math.min(owner.indexOf(head), bottom);
  const pick = (from) => [...new Set(owner.slice(from, from + cap))].map((i) => w[i]);
  return { bottom: pick(bottom), scroll: pick(at) };
}

const say = (name, ws) => {
  const wrapped = ws.filter((r) => r.rows.length > 1).length;
  const split = ws.reduce((a, r) => a + r.split, 0);
  const orphans = ws.filter((r) => r.orphan).map((r) => JSON.stringify(r.rows[r.rows.length - 1].trim()));
  return `${name}: wrapped ${wrapped}, split ${split}, orphan ${orphans.length}${orphans.length ? " " + orphans.join(" ") : ""}`;
};

for (let px = 32; px >= 22; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  const cap = Math.floor(838 / Math.round(px * 1.4));
  const r = windows(red, cols, cap), g = windows(green, cols, cap), j = windows(jq, cols, cap);
  console.log(`${px}px ${cols} cols ${cap} rows`);
  console.log("  " + [say("b1 bottom", r.bottom), say("b2 roll-up", r.scroll)].join(" | "));
  console.log("  " + [say("b3", j.bottom), say("b4 bottom", g.bottom), say("b4 roll-up", g.scroll)].join(" | "));
}
