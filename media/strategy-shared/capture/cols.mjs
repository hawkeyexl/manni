// Font-size derivation per beat (design.md "Capture geometry") for strategy-shared-1x1.
// The wrap is Demo.tsx's wrapLine, line for line: a line longer than the column
// count breaks at a space, a token with no space in reach breaks after a "/"
// (breakAfter="/"), and anything else would hard-break. Beat 1 continues wrapped
// rows under strategy check's 46-column gutter (hang), as the earlier strategy
// videos do.
//
// A beat's size is the largest, capped at the series' 32 px, at which its rows
// fit the terminal area, nothing hard-breaks and no wrapped line ends on a lone
// token, unless that token is the tail of a "/" break (the rule
// media/capture-strategy-steps/cols.mjs set). A line breaks after a "/" at most
// once, so the borrowed path and the Guide URL each span two rows. Beat 2's check line and beat 3's
// JSON rows, the outputs the captions are about, never wrap.
//
// Run from media/: node strategy-shared/capture/cols.mjs [b1=19 ...] [-v]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("strategy-shared/capture/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const exit = (f) => readFileSync("strategy-shared/capture/" + f, "utf8").trim();
const join = rd("join.txt")[0];
const lists = "for r in manni manni-plugin; do (cd $r && manni strategy list -f json > ../$r.json); done";
const beats = {
  b1: ["$ manni strategy check", ...rd("check-copy.ans"), "$ echo $?", exit("check-copy.exit"), "$ "],
  b2: ["$ git rm strategy/personas/maya.md", ...rd("rm.ans"), "$ manni strategy check", ...rd("check-borrowed.ans"), "$ echo $?", exit("check-borrowed.exit"), "$ "],
  b3: ["$ cd ..", `$ ${lists}`, "$ " + join, ...rd("join.ans"), "$ "],
};
const HANG = { b1: 46 };
// Output lines that must stay on one row.
const WHOLE = [rd("check-borrowed.ans")[0], ...rd("join.ans")];

function wrap(text, cols, hang = 0) {
  if (text.length <= cols) return { rows: [text], hard: 0, slash: 0 };
  const own = text.match(/^ */)[0];
  const indent = own.length >= hang ? own : " ".repeat(hang);
  const rows = [];
  let start = 0;
  let first = true;
  let hard = 0;
  let slash = 0;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (width < 8) return { rows: [text], hard: 1, slash: 0 }; // the gutter leaves no room: not a candidate
    if (text.length - start <= width) break;
    const limit = start + width;
    let k = text.lastIndexOf(" ", limit);
    const floor = start + (first ? indent.length : 0);
    if (k <= floor) {
      const s = text.lastIndexOf("/", limit - 1);
      if (s > floor) {
        k = s + 1;
        slash++;
      } else {
        k = limit;
        hard++;
      }
    }
    let end = k;
    while (end > start && text[end - 1] === " ") end--;
    rows.push((first ? "" : indent) + text.slice(start, end));
    let next = k;
    while (text[next] === " ") next++;
    start = next;
    first = false;
  }
  rows.push((first ? "" : indent) + text.slice(start));
  return { rows, hard, slash };
}

const layout = (name, px) => {
  const cols = Math.floor(1040 / (0.6 * px));
  const lh = Math.round(px * 1.4);
  const ws = beats[name].map((l) => wrap(l, cols, HANG[name] ?? 0));
  const rows = ws.flatMap((w) => w.rows);
  const hard = ws.some((w) => w.hard > 0 || w.slash > 1);
  const lone = ws.some((w) => w.rows.length > 1 && w.slash === 0 && !w.rows[w.rows.length - 1].trim().includes(" "));
  const split = WHOLE.some((t) => beats[name].some((l) => l.includes(t)) && !rows.some((r) => r.includes(t)));
  return { px, cols, lh, rows, hard, lone, split, height: rows.length * lh };
};

const picks = process.argv.slice(2).filter((a) => a.includes("="));
for (const arg of picks) {
  const [name, px] = arg.split("=");
  const l = layout(name, Number(px));
  console.log(`${name} at ${l.px}px / ${l.cols} cols / line ${l.lh}: ${l.rows.length} rows, ${l.height}px, hard ${l.hard}, lone ${l.lone}, split ${l.split}`);
  if (process.argv.includes("-v")) for (const r of l.rows) console.log("  |" + r.padEnd(l.cols) + "|");
}
if (picks.length > 0) process.exit(0);
for (const name of Object.keys(beats)) {
  const longest = beats[name].reduce((a, l) => (l.length > a.length ? l : a), "");
  let best;
  for (let px = 32; px >= 16 && !best; px--) {
    const l = layout(name, px);
    if (!l.hard && !l.lone && !l.split && l.height <= 838) best = l;
  }
  console.log(`${name}: longest ${longest.length}; largest fit ${best.px}px / ${best.cols} cols / line ${best.lh}px, ${best.rows.length} rows, ${best.height}px`);
  if (process.argv.includes("-v")) for (const r of best.rows) console.log("  |" + r.padEnd(best.cols) + "|");
}
