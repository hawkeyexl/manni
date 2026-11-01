// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space within the frame, never inside a token,
// and every beat's screen fits the 838 px between the bands.
// Run from media/: node capture-cite-adopts/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("capture-cite-adopts/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const ex = (f) => readFileSync("capture-cite-adopts/" + f, "utf8").trim();
const P = "docs/design/retry.md";
const beats = {
  b1: ["$ cat -n " + P, ...rd("b1-cat.ans"), "$ "],
  b2: [`$ manni cite check ${P}; echo $?`, ...rd("b2-check.ans"), ex("b2-check.exit"), "$ "],
  b3: [`$ manni cite add ${P}:7 lib/limits.ts:2 --id retry-default`, ...rd("b3-add.ans"), "$ "],
  b4: [`$ manni cite add ${P}:16 lib/limits.test.ts:1 --id retry-default-test`, ...rd("b4-add.ans"), "$ "],
  b5: [
    `$ manni cite check ${P}; echo $?`, ...rd("b5-check.ans"), ex("b5-check.exit"),
    `$ git diff --stat ${P}`, ...rd("b5-diff.ans"), "$ ",
  ],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const longestToken = Math.max(
  ...all.map((l) => {
    const ind = l.match(/^ */)[0].length;
    return Math.max(...l.trim().split(/ +/).map((t) => t.length + ind));
  }),
);
console.log("longest token incl. indent:", longestToken);
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let rest = line;
  while (rest.length > cols) {
    const k = rest.lastIndexOf(" ", cols);
    if (k <= indent.length) return null;
    rows.push(rest.slice(0, k).replace(/ +$/, ""));
    rest = indent + rest.slice(k + 1).replace(/^ +/, "");
  }
  rows.push(rest);
  return rows;
}
for (let px = 32; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  const lh = Math.round(px * 1.4);
  let ok = true;
  const r = {};
  for (const [k, ls] of Object.entries(beats)) {
    let n = 0;
    for (const l of ls) {
      const w = wrap(l, cols);
      if (!w) { ok = false; n = NaN; break; }
      n += w.length;
    }
    r[k] = n;
  }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(
    `px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`,
  );
}
const pick = Number(process.argv[2] ?? 21);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const l of all)
  for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"])
    console.log("|" + w.padEnd(cols) + "|");
