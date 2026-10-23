import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Every command is short,
// so the shared 45 ms default.
export const TYPING_MS = 45;

// Measured wall-clock latency, from media/capture-strategy/latency.txt.
// Replayed at 1x: every run is under 0.5 s, so nothing is compressed.
//   check-before  340 ms
//   diff           83 ms
//   check-after   336 ms
//   list          336 ms
export const latency = {
  checkBefore: Math.round(0.340 * FPS),
  diff: Math.round(0.083 * FPS),
  checkAfter: Math.round(0.336 * FPS),
  list: Math.round(0.336 * FPS),
  cat: 2,
  echo: 1,
};

// Type size per beat, derived from each beat's own lines by
// media/capture-strategy/cols.mjs. Beat 2 takes the video's 19 px from Root.tsx:
// strategy check's 46-column gutter holds it there. The others need not shrink with it.
export const beats: Beat[] = [
  {
    title: "A journey filed as a persona",
    type: { fontPx: 32, linePx: 45, cols: 54 },
    caption: "m1 is a journey, but the guide lists it as a persona.",
    highlight: ["type: journey", "personas: [maya]", "personas: [m1]"],
    commands: [
      { typed: "cat strategy/journeys/m1.md", output: captures["cat strategy/journeys/m1.md"], latencyFrames: latency.cat, holdFrames: 2.0 * FPS },
      { typed: "cat docs/guide.md", output: captures["cat docs/guide.md"], latencyFrames: latency.cat, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "manni strategy check",
    caption: "It suggests maya, and finds m2 with no page. Exit 1.",
    highlight: ['"m1" is a journey', "Did you mean its persona", "no page names this journey"],
    commands: [
      { typed: "manni strategy check", output: captures.checkBefore, latencyFrames: latency.checkBefore, holdFrames: 6.2 * FPS },
      { typed: "echo $?", output: `${captures.exits.checkBefore}\n`, latencyFrames: latency.echo, holdFrames: 1.8 * FPS },
    ],
  },
  {
    title: "Fix the page, and it passes",
    type: { fontPx: 31, linePx: 43, cols: 55 },
    caption: "The guide now names maya, and both journeys. Exit 0.",
    highlight: ["+personas: [maya]", "+journeys: [m1, m2]", "no findings"],
    commands: [
      { typed: "git diff docs/guide.md", output: captures.diff, latencyFrames: latency.diff, holdFrames: 3.0 * FPS },
      { typed: "manni strategy check", output: captures.checkAfter, latencyFrames: latency.checkAfter, holdFrames: 1.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.checkAfter}\n`, latencyFrames: latency.echo, holdFrames: 1.8 * FPS },
    ],
  },
  {
    title: "manni strategy list",
    type: { fontPx: 24, linePx: 34, cols: 72 },
    caption: "Each record, and how many pages name it. m2 has one.",
    highlight: ["    m2 "],
    commands: [
      { typed: "manni strategy list", output: captures.list, latencyFrames: latency.list, holdFrames: 4.8 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
