// Font-size derivation per beat (design.md "Capture geometry"), with the
// replay's own wrap (media/remotion/src/Demo.tsx, wrapLine): a line longer
// than the column count breaks at a space, continuation rows carry the line's
// indent, and a token with no space in reach breaks after a "/" or hard.
// The terminal is 1040 px wide (1080 less two 20 px insets), a glyph is
// 0.6 em, so cols = floor(1040 / (0.6 * px)).
//
// For each beat it prints, per size, the rows, the wrapped lines, any token
// broken without a space ("split"), and any wrapped line whose last row is one
// word ("orphan").
// Run from media/: node cite-impact/cols.mjs
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("cite-impact/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const beats = {
  b1: ["$ cat pages/guide.meta.yaml", ...rd("cat-sidecar.txt"), "$ manni cite check", ...rd("check-before.ans"), "$ "],
  b2: ["$ git diff src/value.ts", ...rd("diff.ans"), "$ "],
  b3: ["$ manni cite check -f github pages/guide.md", ...rd("github.ans"), "$ echo $?", "1", "$ "],
  b4: ["$ manni cite check -q", ...rd("pretty.ans"), "$ "],
};

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
    if (k <= floor) { const s = line.lastIndexOf("/", limit - 1); k = s > floor ? s + 1 : limit; split++; }
    let end = k; while (end > start && line[end - 1] === " ") end--;
    rows.push(line.slice(start, end));
    let next = k; while (line[next] === " ") next++;
    start = next; first = false;
  }
  rows.push(line.slice(start));
  const orphan = rows.length > 1 && !rows[rows.length - 1].includes(" ");
  return { rows: rows.length, split, orphan };
}

for (const [name, lines] of Object.entries(beats)) {
  const widest = Math.max(...lines.map((l) => l.length));
  console.log(`${name}: ${lines.length} lines, widest ${widest}`);
  for (let px = 32; px >= 17; px--) {
    const cols = Math.floor(1040 / (0.6 * px));
    const w = lines.map((l) => wrap(l, cols));
    const rows = w.reduce((a, r) => a + r.rows, 0);
    const linePx = Math.round(px * 1.4);
    const fits = rows * linePx <= 878 - 40;
    console.log(`  ${px}px ${cols} cols: ${rows} rows${fits ? "" : " (too tall)"}, wrapped ${w.filter((r) => r.rows > 1).length}, split ${w.reduce((a, r) => a + r.split, 0)}, orphan ${w.filter((r) => r.orphan).length}`);
  }
}
