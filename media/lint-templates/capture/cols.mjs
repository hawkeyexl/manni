// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// The wrap below is the replay's own (src/Demo.tsx wrapLine): trailing spaces count,
// and a continuation row carries the line's indent.
// Run from anywhere: node media/lint-templates/capture/cols.mjs [px]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync(join(here, f), "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");

const beats = {
  b1: ["$ cat docs/rotate-key.md", ...rd("cat-page.txt"), "$ "],
  b2: [
    "$ cat templates.yaml",
    ...rd("cat-stub.txt"),
    "$ manni lint structure docs/rotate-key.md",
    ...rd("lint-wall.ans"),
    "$ ",
  ],
  b3: ["$ manni lint templates infer docs/rotate-key.md", ...rd("infer-stdout.ans"), "$ "],
  b4: [
    "$ manni lint templates infer docs/rotate-key.md -o templates.yaml --force",
    ...rd("infer-write.ans"),
    "$ manni lint structure docs/rotate-key.md",
    ...rd("lint-pass.ans"),
    "$ ",
  ],
  b5: [
    "$ sed -i '/^## See also/,$d' docs/rotate-key.md",
    "$ manni lint structure docs/rotate-key.md",
    ...rd("lint-broken.ans"),
    "$ echo $?",
    "1",
    "$ ",
  ],
};

const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const longestToken = Math.max(
  ...all.map((l) => {
    const ind = /^ */.exec(l)[0].length;
    return Math.max(...l.trim().split(/ +/).map((t) => t.length + ind));
  }),
);
console.log("longest token incl. indent:", longestToken);

function wrap(line, cols) {
  if (line.length <= cols) return [line];
  const indent = /^ */.exec(line)[0];
  const rows = [];
  let start = 0;
  let first = true;
  for (;;) {
    const width = first ? cols : cols - indent.length;
    if (line.length - start <= width) break;
    const k = line.lastIndexOf(" ", start + width);
    if (k <= start + (first ? indent.length : 0)) return null;
    rows.push((first ? "" : indent) + line.slice(start, k).replace(/ +$/, ""));
    let next = k;
    while (line[next] === " ") next++;
    start = next;
    first = false;
  }
  rows.push((first ? "" : indent) + line.slice(start));
  return rows;
}

for (let px = 30; px >= 16; px--) {
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

const pick = Number(process.argv[2] ?? 22);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const [k, ls] of Object.entries(beats)) {
  console.log(`[${k}]`);
  for (const l of ls) for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|");
}
