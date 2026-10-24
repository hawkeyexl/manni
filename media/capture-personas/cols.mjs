// Font-size derivation (design.md "Capture geometry"), with the replay's own
// wrap: a line longer than the column count breaks at a space, and its
// continuation rows carry the line's indent (media/remotion/src/Demo.tsx,
// wrapLine). The wrap below is media/capture-strategy/cols.mjs's, without the
// "/" break this video never needs.
//
// A judged run prints the judge's Reasoning, 280 characters of prose under a
// 7-column indent, and two dim notices of 107. No legible size holds those on
// one row, so detail and notice lines wrap at spaces, and may end on one word.
// A result row (FAIL, pass), a prompt and a diff line never wrap. The edit and
// the second run are beats 3 and 4: no legible size fits their 31 rows on one
// screen.
//
// Run from media/: node capture-personas/cols.mjs   (WHY=1 prints every size)
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("capture-personas/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const RUN = "$ time manni docevals run docs/one-reader.md --ai-only";
const beats = {
  b1: ["$ cat docs/one-reader.md", ...rd("cat-page.txt"), "$ "],
  b2: [RUN, ...rd("run-before.ans"), "$ echo $?", "1", "$ "],
  b3: ["$ git diff docs/one-reader.md", ...rd("diff.ans"), "$ "],
  b4: [RUN, ...rd("run-after.ans"), "$ echo $?", "0", "$ "],
};
// Only a result's detail lines (7-column indent) and the notices may wrap.
const prose = (l) => /^ {7}|^notice /.test(l);

function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let start = 0;
  let first = true;
  let hard = 0;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    const body = first ? line.slice(start) : indent + line.slice(start);
    if (body.length <= cols) break;
    const limit = start + width;
    let k = line.lastIndexOf(" ", limit);
    let skip = true;
    if (k <= start + (first ? indent.length : 0)) {
      k = limit;
      skip = false;
      hard++;
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
  return { rows, hard };
}

// Per beat: the largest size, capped at the series' 32 px, at which the rows
// fit the 838 px terminal area, only detail lines wrap, and nothing hard-breaks.
for (const [k, ls] of Object.entries(beats)) {
  const longest = ls.filter((l) => !prose(l)).reduce((a, l) => (l.length > a.length ? l : a), "");
  console.log(`${k}: longest unwrappable line ${longest.length}: ${JSON.stringify(longest)}`);
  for (let px = 32; px >= 15; px--) {
    const cols = Math.floor(1040 / (0.6 * px));
    const lh = Math.round(px * 1.4);
    const ws = ls.map((l) => ({ l, ...wrap(l, cols) }));
    const rows = ws.reduce((a, w) => a + w.rows.length, 0);
    const badWrap = ws.some((w) => w.rows.length > 1 && !prose(w.l));
    const hard = ws.some((w) => w.hard > 0);
    if (process.env.WHY) console.log(`  ${px}px: ${rows} rows = ${rows * lh}px, bad wrap ${badWrap}, hard ${hard}`);
    if (rows * lh <= 838 && !badWrap && !hard) {
      console.log(`  -> ${px} px / ${cols} cols / line ${lh}, ${rows} rows = ${rows * lh}px`);
      break;
    }
  }
}
