// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// Run from media/: node system-prompt/capture/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) =>
  strip(readFileSync("system-prompt/capture/" + f, "utf8"))
    .replace(/\r/g, "")
    .replace(/\n$/, "")
    .split("\n");
const PROMPT = `grep -o '"systemPrompt":[^]]*' system-prompt.jsonl | head -1`;
const DONE = `tail -1 system-prompt.jsonl | grep -o '"text":"[^"]*"'`;
const CUSTOM = `grep -o '"systemPrompt":[^]]*' system-prompt-custom.jsonl | head -1`;
const beats = {
  b1: ["$ " + PROMPT, ...rd("grep-prompt.txt"), "$ " + DONE, ...rd("grep-done.txt"), "$ "],
  b2: ["$ manni tracevals check system-prompt.jsonl --project .", ...rd("default.ans"), "$ echo $?", "0", "$ "],
  b3: ["$ " + CUSTOM, ...rd("grep-custom.txt"), "$ manni tracevals check system-prompt-custom.jsonl --project .", ...rd("custom.ans"), "$ echo $?", "1", "$ "],
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
    let k = rest.lastIndexOf(" ", cols);
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
const pick = Number(process.argv[2] ?? 24);
const cols = Math.floor(1040 / (0.6 * pick));
console.log(`\n--- rows at ${pick}px / ${cols} cols`);
for (const l of all)
  for (const w of wrap(l, cols) ?? [l + "   <-- CANNOT WRAP"])
    console.log("|" + w.padEnd(cols) + "|");
