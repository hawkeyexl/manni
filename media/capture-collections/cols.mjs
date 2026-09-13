// Font-size derivation (design.md "Capture geometry"): the largest size at which
// every real line either fits or wraps at a space, with no token hard-broken.
// Wrap algorithm mirrors media/remotion/src/Demo.tsx wrapLine exactly.
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("media/capture-collections/" + f, "utf8"))
  .replace(/\r/g, "").replace(/\n$/, "").split("\n");

const beats = {
  b1: ["$ cat manni.config.yaml", ...rd("cat-config-old.txt"),
       "$ manni meta validate", ...rd("validate-refused.ans"),
       "$ echo $?", "2", "$ "],
  b2: ["$ cat manni.config.yaml", ...rd("cat-config-new.txt"), "$ "],
  b34: ["$ manni meta validate", ...rd("validate.ans"),
        "$ manni a11y check --collection guides --no-progress", ...rd("a11y.ans"), "$ "],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars ->", JSON.stringify(longest.slice(0, 60) + "..."));
const longestToken = all.flatMap((l) => l.trim().split(/ +/)).reduce((a, t) => (t.length > a.length ? t : a), "");
console.log("longest token:", longestToken.length, "chars ->", longestToken);

function wrap(line, cols) {
  const indent = (/^ */.exec(line) ?? [""])[0];
  const rows = []; let start = 0; let first = true; let hard = false;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (line.length - start <= width) break;
    const limit = start + width;
    let k = line.lastIndexOf(" ", limit);
    if (k <= start + (first ? indent.length : 0)) { k = limit; hard = true; }
    let end = k; while (end > start && line[end - 1] === " ") end--;
    rows.push((first ? "" : indent) + line.slice(start, end));
    let next = k; while (line[next] === " ") next++;
    start = next; first = false;
  }
  rows.push((first ? "" : indent) + line.slice(start));
  return { rows, hard };
}

for (let px = 30; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  const lh = Math.round(px * 1.4);
  const r = {}; let hard = 0; let orphan = 0;
  for (const [k, ls] of Object.entries(beats)) {
    let n = 0;
    for (const l of ls) {
      const w = wrap(l, cols);
      if (w.hard) hard++;
      n += w.rows.length;
      if (w.rows.length > 1 && !w.rows[w.rows.length - 1].trim().includes(" ")) orphan++;
    }
    r[k] = n;
  }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(`px ${px} cols ${cols} lineH ${lh} hardbreaks ${hard} orphans ${orphan} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`);
}
const pick = Number(process.argv[2] ?? 0);
if (pick) {
  const cols = Math.floor(1040 / (0.6 * pick));
  console.log(`\n--- rows at ${pick}px / ${cols} cols`);
  for (const l of all) for (const w of wrap(l, cols).rows) console.log("|" + w.padEnd(cols) + "|");
}
