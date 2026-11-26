// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line fits, or wraps at a space, or after a `/` inside an IRI or a path (the
// video's breakAfter, as graph-authoring-1x1 does), never mid-token, and each
// beat's rows fit the 878 px terminal. Mirrors wrapLine in media/remotion/src/Demo.tsx.
// Run from media/: node capture-vector/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("capture-vector/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\t/g, "    ") // `time`'s tab: 4 spaces after "real"/"user", as 8-column stops draw it
    .replace(/\n$/, "")
    .split("\n");
const OUT = "media/scratch-vector/out";
const beats = {
  b1: ["$ manni graph embed", ...rd("embed.ans"), "$ echo $?", "2", "$ "],
  b2: [
    `$ time manni vector build --collection site --no-cache -o ${OUT}`,
    "[201.8 s run; the wait is cut to 2 s]",
    ...rd("build.ans"),
    `$ ls -1 ${OUT}`,
    ...rd("ls.txt"),
    "$ ",
  ],
  b3: [`$ manni vector search "pin a sentence to its source" --limit 3 -i ${OUT}`, ...rd("search.ans"), "$ "],
};
const BREAK = "/";
// Beat 3 hangs continuation rows under the score gutter (8 columns), as Beat.hang does.
const HANG = { b3: 8 };
function wrap(line, cols, hang = 0) {
  const own = line.match(/^ */)[0];
  const indent = own.length >= hang ? own : " ".repeat(hang);
  const rows = [];
  let rest = line;
  let first = true;
  while (rest.length > cols) {
    let k = rest.lastIndexOf(" ", cols);
    const floor = first ? own.length : indent.length;
    if (k <= floor) {
      const s = rest.lastIndexOf(BREAK, cols - 1);
      if (s <= floor) return null;
      k = s + 1;
    }
    rows.push(rest.slice(0, k).replace(/ +$/, ""));
    rest = indent + rest.slice(k).replace(/^ +/, "");
    first = false;
  }
  rows.push(rest);
  return rows;
}
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, JSON.stringify(longest));
for (let px = 34; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  const lh = Math.round(px * 1.4);
  let ok = true;
  const r = {};
  for (const [k, ls] of Object.entries(beats)) {
    let n = 0;
    for (const l of ls) {
      const w = wrap(l, cols, HANG[k]);
      if (!w) ok = false;
      n += w ? w.length : 1;
    }
    r[k] = n;
  }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(
    `px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`,
  );
}
const pick = Number(process.argv[2] ?? 24);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats))
  for (const l of ls) for (const w of wrap(l, cols, HANG[k]) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|");
