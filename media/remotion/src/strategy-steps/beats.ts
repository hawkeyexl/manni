import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Every command is short,
// so the shared 45 ms default.
export const TYPING_MS = 45;

// Measured wall-clock latency, from media/capture-strategy-steps/latency.txt.
// Replayed at 1x: every run is under 0.7 s, so nothing is compressed.
//   check-before  611 ms
//   diff           98 ms
//   get           597 ms
export const latency = {
  checkBefore: Math.round(0.611 * FPS),
  diff: Math.round(0.098 * FPS),
  get: Math.round(0.597 * FPS),
  cat: 2,
  echo: 1,
};

// Type size per beat, derived from each beat's own lines by
// media/capture-strategy-steps/cols.mjs. Beat 2 takes the video's 19 px from
// Root.tsx and wraps under strategy check's 46-column gutter (hang). The others
// take the largest size at which none of their lines wraps.
export const beats: Beat[] = [
  {
    title: "A journey lists its steps",
    type: { fontPx: 32, linePx: 45, cols: 54 },
    caption: "A journey lists the pages it walks through, in order.",
    highlight: ["steps:", "doc: docs/reference.md", "exists: false"],
    commands: [
      { typed: "cat strategy/journeys/m1.md", output: captures["cat strategy/journeys/m1.md"], latencyFrames: latency.cat, holdFrames: 5.0 * FPS },
    ],
  },
  {
    title: "manni strategy check",
    hang: 46,
    caption: "Step 3's page skips m1. Step 4 is unwritten. Exit 0.",
    highlight: ['does not name "m1"', "names a page that does not exist"],
    commands: [
      { typed: "manni strategy check", output: captures.checkBefore, latencyFrames: latency.checkBefore, holdFrames: 7.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.checkBefore}\n`, latencyFrames: latency.echo, holdFrames: 1.8 * FPS },
    ],
  },
  {
    title: "The page joins the journey",
    type: { fontPx: 32, linePx: 45, cols: 54 },
    caption: "The reference page names m1, its persona and audience.",
    highlight: ["+journeys: [m1]"],
    commands: [
      { typed: "git diff docs/reference.md", output: captures.diff, latencyFrames: latency.diff, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "manni strategy get m1",
    type: { fontPx: 24, linePx: 34, cols: 72 },
    caption: "Coverage, in order: 3 of 4 served, 1 unwritten.",
    highlight: ["3 of 4 served", "unwritten"],
    commands: [
      { typed: "manni strategy get m1", output: captures.get, latencyFrames: latency.get, holdFrames: 6.4 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
