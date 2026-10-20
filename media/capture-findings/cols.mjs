// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space within the frame, never inside a token.
// One token is exempt and named: the date pattern in the meta finding, 110
// characters with no space, which no legible size can hold on one row. It
// hard-breaks, as a terminal would, before and after alike.
// Run from media/: node capture-findings/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("capture-findings/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const ARGS = "meta validate dcmi-bad-date.md -s dcmi:elements:1.1 --no-config";
const beats = {
  b1: ["$ cat dcmi-bad-date.md", ...rd("cat-page.txt"), "$ npx -y @hawkeyexl/manni@4.13.0 " + ARGS, ...rd("before.ans"), "$ "],
  b2: ["$ manni " + ARGS, ...rd("after.ans"), "$ echo $?", "1", "$ "],
  b3: ["$ manni meta schemas show manni:core:1.0.0 -f markdown", ...rd("show.ans"), "$ "],
  b4: ["$ manni cite check pages/source-changed.md", ...rd("cite.ans"), "$ "],
};
const EXEMPT = (t) => t.startsWith('"^[0-9]{4}');
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const longestToken = Math.max(
  ...all.map((l) => {
    const ind = l.match(/^ */)[0].length;
    return Math.max(...l.trim().split(/ +/).filter((t) => !EXEMPT(t)).map((t) => t.length + ind));
  }),
);
console.log("longest non-exempt token incl. indent:", longestToken);
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let rest = line;
  let first = true;
  while (rest.length > (first ? cols : cols)) {
    let k = rest.lastIndexOf(" ", cols);
    if (k <= indent.length) {
      const tok = rest.slice(indent.length).split(" ")[0];
      if (!EXEMPT(tok)) return null;
      k = cols; // hard break, the exempt token only
      rows.push(rest.slice(0, k));
      rest = indent + rest.slice(k);
      first = false;
      continue;
    }
    rows.push(rest.slice(0, k).replace(/ +$/, ""));
    rest = indent + rest.slice(k + 1).replace(/^ +/, "");
    first = false;
  }
  rows.push(rest);
  return rows;
}
for (let px = 32; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  const lh = Math.round(px * 1.4);
  let ok = true;
  const r = {};
  let orphan = 0;
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
      if (w.length > 1 && !w[w.length - 1].trim().includes(" ")) orphan++;
    }
    r[k] = n;
  }
  const tallest = Math.max(...Object.values(r)) * lh;
  console.log(
    `px ${px} cols ${cols} lineH ${lh} ${ok ? "ok" : "TOKEN TOO WIDE"} orphans ${orphan} rows ${JSON.stringify(r)} tallest ${tallest}px ${tallest <= 838 ? "fits" : "TOO TALL"}`,
  );
}
const pick = Number(process.argv[2] ?? 22);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const l of all)
  for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"])
    console.log("|" + w.padEnd(cols) + "|");
