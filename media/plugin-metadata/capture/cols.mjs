// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// Run from media/: node plugin-metadata/capture/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("plugin-metadata/capture/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n")
    .filter((l, i, a) => !(a.length === 1 && l === ""));
const SED = "sed -i 's/platform-docs/docs-team/' docs/limits.meta.yaml";
const GET = "manni meta get --all-fields --no-derived docs/limits.md";
const READ = "read-page docs/limits.md";
// Beat 5 replaces the two advisory notices with one marker line (see beats.ts).
const graph = rd("graph.ans");
const g5 = [graph[0], "… 2 advisory lines left out", ...graph.slice(3)];
const beats = {
  b1: ["$ head -4 docs/limits.md", ...rd("head.ans"), "$ cat docs/limits.meta.yaml", ...rd("sidecar.ans"), "$ "],
  b2: ["$ " + GET, ...rd("get.ans"), "$ "],
  b3: ["$ " + READ, ...rd("read1.ans")],
  b4: ["$ " + READ, ...rd("read1.ans"), "$ " + READ, "$ " + SED, "$ " + READ, ...rd("read3.ans"), "$ "],
  b5: ['$ mcp-call lookup "What is the fetch timeout?"', ...g5, "$ "],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
function wrap(line, cols) {
  const indent = line.match(/^ */)[0];
  const rows = [];
  let rest = line;
  while (rest.length > cols) {
    let k = rest.lastIndexOf(" ", cols);
    if (k <= indent.length) return null;
    rows.push(rest.slice(0, k).replace(/ +$/, ""));
    rest = indent + rest.slice(k + 1).replace(/^ +/, "");
  }
  rows.push(rest);
  return rows;
}
for (let px = 34; px >= 20; px--) {
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
const pick = Number(process.argv[2] ?? 28);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const l of [...beats.b4, ...beats.b5])
  for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"]) console.log("|" + w.padEnd(cols) + "|");
