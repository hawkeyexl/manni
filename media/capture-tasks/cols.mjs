// Font-size derivation (design.md "Capture geometry"): the largest size at which every
// real line either fits or wraps at a space, never inside a token, within the frame.
// Beats 2-4 and 5 are taller than the frame on purpose and scroll, so only width is checked.
// Run from media/: node capture-tasks/cols.mjs [px]
import { readFileSync } from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rd = (f) => strip(readFileSync("capture-tasks/" + f, "utf8")).replace(/\r/g, "").replace(/\n$/, "").split("\n");
const TASK = `manni test tasks docs/src/content/docs/meta/fix/index.mdx --persona theo --workspace test/test/fixtures/tasks/red-pr --task "The docs check on my pull request fails with: docs/install.md (root) must have required property 'description' (line 1) [manni:core:1.0.0]. Make it pass."`;
const T1 = "time manni test tasks --journey t1 --provider claude-cli";
const beats = {
  b1: ["$ manni meta validate", ...rd("red.ans"), "$ echo $?", "1", "$ "],
  b2: ["$ " + TASK, ...rd("raw/df1.err.txt"), ...rd("raw/df1.out.txt"), "$ "],
  b5: ["$ " + T1, ...rd("t1.ans"), "$ echo $?", "0", "$ "],
};
const all = Object.values(beats).flat();
const longest = all.reduce((a, l) => (l.length > a.length ? l : a), "");
console.log("longest line:", longest.length, "chars:", JSON.stringify(longest));
const tok = (l) => Math.max(...l.trim().split(/ +/).map((t) => t.length)) + l.match(/^ */)[0].length;
const worst = all.reduce((a, l) => (tok(l) > tok(a) ? l : a), "");
console.log("longest token incl. indent:", tok(worst), JSON.stringify(worst));
for (let px = 30; px >= 18; px--) {
  const cols = Math.floor(1040 / (0.6 * px));
  console.log(`px ${px} cols ${cols} ${tok(worst) <= cols ? "ok" : "TOKEN TOO WIDE"}`);
}
