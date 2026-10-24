import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The shared 45 ms default.
export const TYPING_MS = 45;

// Measured wall-clock latency, from media/capture-personas/latency.txt:
//   run-before  8192 ms (bash `time`: real 0m8.172s)
//   diff          57 ms
//   run-after   8114 ms (bash `time`: real 0m8.095s)
// Each judged run is two real calls to a 3B model on this machine. The replay
// shortens that wait, and only that wait, by 1/3.5 to 2.3 s. design.md allows
// compressing static wait and requires the real elapsed time on screen: bash's
// own `time` line is in frame, unedited. Typing and output stay 1x.
const COMPRESS = 3.5;
export const latency = {
  runBefore: Math.round((8.172 / COMPRESS) * FPS),
  diff: 2,
  runAfter: Math.round((8.095 / COMPRESS) * FPS),
  cat: 2,
  echo: 1,
};

const run = "time manni docevals run docs/one-reader.md --ai-only";

// Type size per beat, derived from each beat's own lines by
// media/capture-personas/cols.mjs. Beat 2 takes the video's 21 px from Root.tsx:
// the judge's reasoning and the notices wrap there, and its 28 rows fit.
export const beats: Beat[] = [
  {
    title: "One eval reads as Theo",
    type: { fontPx: 27, linePx: 38, cols: 64 },
    caption: "readers: personas on one eval. The page names theo.",
    highlight: ["readers: personas", "- theo"],
    commands: [{ typed: "cat docs/one-reader.md", output: captures["cat docs/one-reader.md"], latencyFrames: latency.cat, holdFrames: 4.6 * FPS }],
  },
  {
    title: "manni docevals run",
    caption: "Read as theo: FAIL. The untagged eval passes. Exit 1.",
    highlight: ["(read as theo)", "No statement on which schema fired", "0m8."],
    commands: [
      { typed: run, output: captures.runBefore, latencyFrames: latency.runBefore, holdFrames: 6.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.runBefore}\n`, latencyFrames: latency.echo, holdFrames: 1.8 * FPS },
    ],
  },
  {
    title: "Speak to Theo's pains",
    type: { fontPx: 27, linePx: 38, cols: 64 },
    caption: "He can't tell which schema fired. Now the page says.",
    highlight: ["names its schema", "schema: house"],
    commands: [{ typed: "git diff docs/one-reader.md", output: captures.diff, latencyFrames: latency.diff, holdFrames: 3.6 * FPS }],
  },
  {
    title: "Run it again",
    type: { fontPx: 25, linePx: 35, cols: 69 },
    caption: "Passes, read as theo. Exit 0. Waits shown 3.5x faster.",
    highlight: ["(read as theo)", "0m8."],
    commands: [
      { typed: run, output: captures.runAfter, latencyFrames: latency.runAfter, holdFrames: 2.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.runAfter}\n`, latencyFrames: latency.echo, holdFrames: 2.4 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
