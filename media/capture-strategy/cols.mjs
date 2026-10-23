// Font-size derivation (design.md "Capture geometry"), with the replay's own wrap:
// a line longer than the column count breaks at a space, and its continuation
// rows carry the line's indent (media/remotion/src/Demo.tsx, wrapLine). A token
// too long for a continuation row breaks after a "/" (breakAfter="/"), and only
// a token with no "/" in reach would hard-break.
//
// strategy check prints its findings under a 46-column gutter, so the binding
// line is a finding's first row: 46 columns of severity and rule, then the
// message. The two Guide URLs (80 and 77 characters, no space) can never fit a
// continuation row at a legible size; they break after a "/". Every other
// token stays whole.
//
// Run from media/: node capture-strategy/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("capture-strategy/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const beats = {
  b1: ["$ cat strategy/journeys/m1.md", ...rd("cat-journey.txt"), "$ cat docs/guide.md", ...rd("cat-page.txt"), "$ "],
  b2: ["$ manni strategy check", ...rd("check-before.ans"), "$ echo $?", "1", "$ "],
  b3: ["$ git diff docs/guide.md", ...rd("diff.ans"), "$ manni strategy check", ...rd("check-after.ans"), "$ echo $?", "0", "$ "],
  b4: ["$ manni strategy list", ...rd("list.ans"), "$ "],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const finding = all.filter((l) => /^  (error|warning) /.test(l));
console.log("finding first rows:", finding.map((l) => l.length));

/** Rows for one line, as Demo.tsx draws them; `slashBreaks` counts tokens broken after a "/", `hard` any other break. */
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
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
      const w = wrap(l, cols);
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
// Per beat: the largest size, capped at the series' largest (32 px), at which the
// beat's rows fit the terminal area, no finding row wraps, nothing orphans and
// nothing hard-breaks. Only beat 2 carries the gutter, so only beat 2 is held to 19.
console.log("\n--- per beat");
for (const [k, ls] of Object.entries(beats)) {
  for (let px = 32; px >= 17; px--) {
    const cols = Math.floor(1040 / (0.6 * px));
    const lh = Math.round(px * 1.4);
    const ws = ls.map((l) => wrap(l, cols));
    const rows = ws.reduce((a, w) => a + w.rows.length, 0);
    const orphan = ws.some((w) => w.rows.length > 1 && !w.rows[w.rows.length - 1].trim().includes(" ") && w.slashBreaks === 0);
    const hard = ws.some((w) => w.hard > 0);
    const findingWrapped = ls.some((l) => /^  (error|warning) /.test(l) && l.length > cols);
    const wrapped = ws.filter((w) => w.rows.length > 1).length;
    // Outside beat 2 nothing may wrap: beat 4 is a table, and a wrapped row breaks its columns.
    if (rows * lh <= 838 && !orphan && !hard && !findingWrapped && (k === "b2" || wrapped === 0)) {
      console.log(`${k}: ${px} px / ${cols} cols / line ${lh}, ${rows} rows = ${rows * lh}px, ${wrapped} wrapped lines`);
      break;
    }
  }
}

const pick = Number(process.argv[2] ?? 19);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const l of all) for (const w of wrap(l, cols).rows) console.log("|" + w.padEnd(cols) + "|");
