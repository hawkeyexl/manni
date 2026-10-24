import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The shared 45 ms default.
export const TYPING_MS = 45;

// Measured wall-clock latency, from media/cite-impact/latency.txt.
// Replayed at 1x: every run is under 0.75 s, so nothing is compressed.
//   check-before  503 ms
//   diff           82 ms
//   github        657 ms
//   pretty        700 ms
export const latency = {
  checkBefore: Math.round(0.503 * FPS),
  diff: Math.round(0.082 * FPS),
  github: Math.round(0.657 * FPS),
  pretty: Math.round(0.7 * FPS),
  cat: 2,
  echo: 1,
};

// Type size per beat, derived from each beat's own lines by
// media/cite-impact/cols.mjs. Beats 1 and 2 hold the series' 32 px with no
// wrap. Beat 3's annotation is one 448-character line: 22 px / 78 columns is
// the largest size that wraps it at spaces with no split token and no
// one-word last row. Beat 4 takes 22 px too, the largest size whose two
// wrapped guidance lines leave no one-word row.
export const beats: Beat[] = [
  {
    title: "The page names its readers",
    type: { fontPx: 32, linePx: 45, cols: 54 },
    caption: "The guide's sidecar names persona maya and journey m5.",
    highlight: ["personas: [maya]", "journeys: [m5]"],
    commands: [
      { typed: "cat pages/guide.meta.yaml", output: captures["cat pages/guide.meta.yaml"], latencyFrames: latency.cat, holdFrames: 2.2 * FPS },
      { typed: "manni cite check", output: captures.checkBefore, latencyFrames: latency.checkBefore, holdFrames: 2.5 * FPS },
    ],
  },
  {
    title: "One source line changes",
    type: { fontPx: 32, linePx: 45, cols: 54 },
    caption: "Both pages pin this line, so both pins go stale.",
    highlight: ["TIMEOUT_SECONDS = 10", "TIMEOUT_SECONDS = 30"],
    commands: [
      { typed: "git diff src/value.ts", output: captures.diff, latencyFrames: latency.diff, holdFrames: 3.2 * FPS },
    ],
  },
  {
    title: "manni cite check -f github",
    type: { fontPx: 22, linePx: 31, cols: 78 },
    caption: "The annotation now names maya and m5. Exit 1.",
    highlight: ["Serves maya"],
    commands: [
      { typed: "manni cite check -f github pages/guide.md", output: captures.github, latencyFrames: latency.github, holdFrames: 6.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.github}\n`, latencyFrames: latency.echo, holdFrames: 1.6 * FPS },
    ],
  },
  {
    title: "Who the findings reach",
    type: { fontPx: 22, linePx: 31, cols: 78 },
    caption: "Findings rolled up by persona and journey.",
    highlight: ["The pages with findings serve", "Maya, Documentation Engineer", "Pin a claim", "Keep citations"],
    commands: [
      { typed: "manni cite check -q", output: captures.pretty, latencyFrames: latency.pretty, holdFrames: 5.8 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
