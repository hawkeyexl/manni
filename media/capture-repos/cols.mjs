// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space within the frame, never inside a token,
// and every beat's screen fits the 838 px between the bands.
// Run from media/: node capture-repos/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("capture-repos/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
// Each check is typed with `; echo $?`, so the exit code lands under the summary.
const CHECK = "$ manni cite check pages/limits.md";
const ex = (f) => readFileSync("capture-repos/" + f, "utf8").trim();
const beats = {
  b1: [CHECK + " --root ../api; echo $?", ...rd("b1-api.ans"), ex("b1-api.exit"),
       CHECK + " --root ../sdk; echo $?", ...rd("b1-sdk.ans"), ex("b1-sdk.exit"), "$ "],
  b2: ["$ cat manni.config.yaml", ...rd("cat-config.txt"), "$ "],
  b3: [CHECK + "; echo $?", ...rd("b3-check.ans"), ex("b3-check.exit"), "$ "],
  b4: ["$ git -C ../sdk log -1 -p --oneline -U0", ...rd("b4-log.ans"), "$ "],
  b5: [CHECK + "; echo $?", ...rd("b5-check.ans"), ex("b5-check.exit"), "$ "],
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
      if (!w) {
        ok = false;
        n = NaN;
        break;
      }
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
