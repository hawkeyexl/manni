// Font-size derivation (design.md "Capture geometry"), with the replay's own wrap:
// a line longer than the column count breaks at a space, and its continuation
// rows carry the line's indent (media/remotion/src/Demo.tsx, wrapLine).
//
// Per beat: the largest size, capped at the series' 32 px, at which the beat's
// rows fit the 838 px terminal area, no token hard-breaks, and no wrapped line
// leaves one word alone on its last row. Beat 1 may not wrap at all.
//
// Run from media/: node evidence-pins/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("evidence-pins/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const THEO = "records/personas/theo.md";
const NOTE = "research/contributor.md";
const beats = {
  b1: [`$ cat ${THEO}`, ...rd("cat-persona.txt"), "$ "],
  b2: [`$ manni cite add ${THEO}#/pains/0 ${NOTE}:3 --id terse-messages`, ...rd("add.ans"), "$ "],
  b3: [`$ manni cite check ${THEO}`, ...rd("check-current.ans"), "$ "],
  b4: [`$ git diff -U1 ${THEO}`, ...rd("diff-persona.ans"), `$ manni cite check ${THEO}`, ...rd("check-moved.ans"), `$ manni cite update ${THEO}`, ...rd("update.ans"), "$ "],
  b5: [`$ git diff ${NOTE}`, ...rd("diff-note.ans"), `$ manni cite check ${THEO}`, ...rd("check-changed.ans"), "$ echo $?", "1", "$ "],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));

/** Rows for one line, as Demo.tsx draws them; `hard` counts breaks inside a token. */
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let start = 0;
  let first = true;
  let hard = 0;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (line.length - start <= width) break;
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

console.log("\n--- per beat");
for (const [k, ls] of Object.entries(beats)) {
  for (let px = 32; px >= 17; px--) {
    const cols = Math.floor(1040 / (0.6 * px));
    const lh = Math.round(px * 1.4);
    const ws = ls.map((l) => wrap(l, cols));
    const rows = ws.reduce((a, w) => a + w.rows.length, 0);
    const orphan = ws.some((w) => w.rows.length > 1 && !w.rows[w.rows.length - 1].trim().includes(" "));
    const hard = ws.some((w) => w.hard > 0);
    // Beat 1 is a file, and a wrapped frontmatter line reads as a second key.
    const wrapped = ws.filter((w) => w.rows.length > 1).length;
    if (rows * lh <= 838 && !orphan && !hard && (k !== "b1" || wrapped === 0)) {
      console.log(`${k}: ${px} px / ${cols} cols / line ${lh}, ${rows} rows = ${rows * lh}px, ${ws.filter((w) => w.rows.length > 1).length} wrapped lines`);
      break;
    }
  }
}

const pick = process.argv[2];
if (pick) {
  const cols = Math.floor(1040 / (0.6 * Number(pick)));
  console.log(`\n--- rows at ${pick}px / ${cols} cols`);
  for (const l of all) for (const w of wrap(l, cols).rows) console.log("|" + w.padEnd(cols) + "|");
}
