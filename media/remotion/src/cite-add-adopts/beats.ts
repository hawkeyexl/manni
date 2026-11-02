import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because beat 4 types a 73-character command.
export const TYPING_MS = 38;

// Measured wall-clock latency, from media/capture-cite-adopts/latency.txt.
// Replayed at 1x: every run is under 1 s, so nothing is compressed.
//   b2-check  624 ms
//   b3-add    695 ms
//   b4-add    744 ms
//   b5-check  568 ms
//   b5-diff    66 ms (git)
export const latency = {
  b2: Math.round(0.624 * FPS),
  b3: Math.round(0.695 * FPS),
  b4: Math.round(0.744 * FPS),
  b5: Math.round(0.568 * FPS),
  git: Math.round(0.066 * FPS),
  cat: 2,
};

const page = "docs/design/retry.md";
// A check is typed with `; echo $?`, so its exit code prints under the summary.
const withExit = (output: string, exit: string) => `${output}${exit}\n`;

export const beats: Beat[] = [
  {
    title: "Spec before code",
    caption: "The spec comes first. A marker names two claims that no entry pins yet.",
    highlight: ["cite retry-default", "Failed requests"],
    commands: [{ typed: `cat -n ${page}`, output: captures.b1, latencyFrames: latency.cat, holdFrames: 3.2 * FPS }],
  },
  {
    title: "The to-do list",
    caption: "check lists a marker-orphan for each id. Exit 1 is the to-do list.",
    highlight: ["marker-orphan"],
    commands: [
      { typed: `manni cite check ${page}; echo $?`, output: withExit(captures.b2, captures.exits.b2), latencyFrames: latency.b2, holdFrames: 5.0 * FPS },
    ],
  },
  {
    title: "Pin the first claim",
    caption: "add adopts the marker. No --marker flag, and the sentence is untouched.",
    highlight: ["adopted the marker"],
    commands: [
      { typed: `manni cite add ${page}:7 lib/limits.ts:2 --id retry-default`, output: captures.b3, latencyFrames: latency.b3, holdFrames: 4.8 * FPS },
    ],
  },
  {
    title: "Pin the second claim",
    caption: "The sentence sits at line 16 now. The first entry grew the frontmatter.",
    highlight: ["adopted the marker"],
    commands: [
      { typed: `manni cite add ${page}:16 lib/limits.test.ts:1 --id retry-default-test`, output: captures.b4, latencyFrames: latency.b4, holdFrames: 4.4 * FPS },
    ],
  },
  {
    title: "Nothing left to fix",
    caption: "Both rows current, exit 0. The diff holds insertions only, no edits.",
    // 22 px / 78 columns: the check rows are 77 characters, and 66 columns would orphan "current".
    type: { fontPx: 22, linePx: 31, cols: 78 },
    highlight: ["marker :23", "0 findings", "insertions"],
    commands: [
      { typed: `manni cite check ${page}; echo $?`, output: withExit(captures.b5, captures.exits.b5), latencyFrames: latency.b5, holdFrames: 2.4 * FPS },
      { typed: `git diff --stat ${page}`, output: captures.b5diff, latencyFrames: latency.git, holdFrames: 3.4 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
