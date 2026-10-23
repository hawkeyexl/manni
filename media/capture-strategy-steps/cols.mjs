// Font-size derivation (design.md "Capture geometry") for strategy-steps-1x1,
// adapted from media/capture-strategy/cols.mjs with the same wrap model as
// media/remotion/src/Demo.tsx (wrapLine): a line longer than the column count
// breaks at a space and its continuation rows carry the line indent; a token
// with no space in reach breaks after a "/" (breakAfter="/").
//
// strategy check prints each finding under a 46-column gutter. Its rule line
// and Guide URL are dim and long, so beat 2 is the binding beat.
//
// Run from media/: node capture-strategy-steps/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("capture-strategy-steps/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const beats = {
  b1: ["$ cat strategy/journeys/m1.md", ...rd("cat-journey.txt"), "$ "],
  b2: ["$ manni strategy check", ...rd("check-before.ans"), "$ echo $?", "0", "$ "],
  b3: ["$ git diff docs/reference.md", ...rd("diff.ans"), "$ "],
  b4: ["$ manni strategy get m1", ...rd("get.ans"), "$ "],
};
const all = Object.values(beats).flat();
// Beat 2 continues wrapped rows under the 46-column gutter (hang in src/beats.ts),
// so a wrapped finding row reads as the CLI's own continuation line.
const HANG = { b2: 46 };
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const finding = all.filter((l) => /^  (error|warning|notice) /.test(l));
console.log("finding first rows:", finding.map((l) => l.length));

/** Rows for one line, as Demo.tsx draws them; `slashBreaks` counts tokens broken after a "/", `hard` any other break. */
function wrap(line, cols, hang = 0) {
  const own = line.match(/^ */)[0];
  const indent = own.length >= hang ? own : " ".repeat(hang);
  const rows = [];
  let start = 0;
  let first = true;
  let slashBreaks = 0;
  let hard = 0;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    const body = first ? line.slice(start) : indent + line.slice(start);
    if (body.length <= (first ? cols : cols)) break;
    const limit = start + width;
    let k = line.lastIndexOf(" ", limit);
    let skip = true;
    if (k <= start + (first ? indent.length : 0)) {
      const s = line.lastIndexOf("/", limit - 1);
      if (s > start + (first ? indent.length : 0)) {
        k = s + 1;
        skip = false;
        slashBreaks++;
      } else {
        k = limit;
        skip = false;
        hard++;
      }
    }
    let end = k;
    while (end > start && line[end - 1] === " ") end--;
    rows.push((first ? "" : indent) + line.slice(start, end));
    let next = k;
    if (skip) while (line[next] === " ") next++;
    start = next;
    first = false;
  }
  rows.push((first ? "" : indent) + line.slice(start));
  return { rows, slashBreaks, hard };
}

for (let px = 26; px >= 17; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  const lh = Math.round(px * 1.4);
  const r = {};
  let orphans = 0;
  let slash = 0;
  let hard = 0;
  for (const [k, ls] of Object.entries(beats)) {
    let n = 0;
    for (const l of ls) {
      const w = wrap(l, cols, HANG[k] ?? 0);
      n += w.rows.length;
      slash += w.slashBreaks;
      hard += w.hard;
      // An orphan: a wrapped line whose last row is one short token.
      if (w.rows.length > 1 && !w.rows[w.rows.length - 1].trim().includes(" ") && w.slashBreaks === 0) orphans++;
    }
    r[k] = n;
  }
  const tallest = Math.max(...Object.values(r)) * lh;
  const wrappedFindings = finding.filter((l) => l.length > cols).length;
  console.log(
    `px ${px} cols ${cols} lineH ${lh} finding rows wrapped ${wrappedFindings} orphans ${orphans} slash-breaks ${slash} hard ${hard} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`,
  );
}
// Per beat: the largest size, capped at the series' 32 px, at which the beat's
// rows fit the terminal area, nothing orphans and nothing hard-breaks. Outside
// beat 2 nothing may wrap; beat 2 wraps under its gutter.
console.log("\n--- per beat");
for (const [k, ls] of Object.entries(beats)) {
  for (let px = 32; px >= 17; px--) {
    const cols = Math.floor(1040 / (0.6 * px));
    const lh = Math.round(px * 1.4);
    const ws = ls.map((l) => wrap(l, cols, HANG[k] ?? 0));
    const rows = ws.reduce((a, w) => a + w.rows.length, 0);
    const orphan = ws.some((w) => w.rows.length > 1 && !w.rows[w.rows.length - 1].trim().includes(" ") && w.slashBreaks === 0);
    const hard = ws.some((w) => w.hard > 0);
    const findingWrapped = ls.some((l) => /^  (error|warning|notice) /.test(l) && l.length > cols);
    const wrapped = ws.filter((w) => w.rows.length > 1).length;
    // Outside beat 2 nothing may wrap: beat 4 is a table, and a wrapped row breaks its columns.
    if (rows * lh <= 838 && !orphan && !hard && (k === "b2" || wrapped === 0)) {
      console.log(`${k}: ${px} px / ${cols} cols / line ${lh}, ${rows} rows = ${rows * lh}px, ${wrapped} wrapped lines`);
      break;
    }
  }
}

const pick = Number(process.argv[2] ?? 19);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats)) for (const l of ls) for (const w of wrap(l, cols, HANG[k] ?? 0).rows) console.log("|" + w.padEnd(cols) + "|");
