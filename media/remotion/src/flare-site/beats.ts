import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// flare-site-1x1. Typing speed for this video (design.md: 35-70 ms).
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in C:\widget (the junction to
// media/scratch-flare-site; media/capture-flare-site/latency.txt: the capture run
// plus three timing runs, each line stamped with its millisecond after Enter):
//   build    manni's announce 445-482 ms, the stand-in's line 57-106 ms after it
//   preview  the URL 470-513 ms
//   curl     60-102 ms
//   start    444-488 ms
// The replay uses the first whole frame inside each range. No wait is compressed.
export const latency = {
  build: Math.round(0.46 * FPS),
  standin: 2,
  preview: Math.round(0.5 * FPS),
  curl: 2,
  start: Math.round(0.46 * FPS),
  shell: 2,
};

const withExit = (out: string, code: string) => `${out}${code}\n`;

export const beats: Beat[] = [
  {
    title: "A MadCap Flare project",
    caption: "A .flprj marks it. The config names the HTML5 target.",
    highlight: ["Widget.flprj", "target: HTML5"],
    commands: [
      { typed: "ls", output: captures.ls, latencyFrames: latency.shell, holdFrames: 1.4 * FPS },
      { typed: "tail -3 manni.config.yaml", output: captures["tail config"], latencyFrames: latency.shell, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "Build, with a stand-in madbuild",
    caption: "It runs madbuild. Here, a stand-in, not MadCap Flare.",
    highlight: ["Running madbuild", "stand-in madbuild"],
    commands: [
      {
        typed: "manni site build; echo $?",
        output: captures.build.announce,
        latencyFrames: latency.build,
        more: [{ afterFrames: latency.standin, output: withExit(captures.build.standin, captures.exits.build) }],
        holdFrames: 4.4 * FPS,
      },
    ],
  },
  {
    title: "manni site preview",
    caption: "It serves the last build. It does not build first.",
    highlight: ["127.0.0.1:4321"],
    commands: [
      { typed: "manni site preview", output: captures.preview, latencyFrames: latency.preview, holdFrames: 3.2 * FPS, running: true },
    ],
  },
  {
    title: "Default.htm answers at /",
    caption: "In a second terminal, / is the stand-in's Default.htm.",
    highlight: ["Stand-in build"],
    commands: [
      { typed: "curl -s http://127.0.0.1:4321/ | head -3", output: captures.curl, latencyFrames: latency.curl, holdFrames: 4 * FPS },
    ],
  },
  {
    title: "No development server",
    caption: "site start names the two commands to run. Exit 2.",
    highlight: ["no development server"],
    // 20 px / 86 columns for this beat alone: at the video's 24 px / 72 columns the
    // refusal wraps inside "manni site preview" (capture-flare-site/cols.mjs).
    type: { fontPx: 20, linePx: 28, cols: 86 },
    commands: [
      {
        typed: "manni site start; echo $?",
        output: withExit(captures.start, captures.exits.start),
        latencyFrames: latency.start,
        holdFrames: 4.4 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
