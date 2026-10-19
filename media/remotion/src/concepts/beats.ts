import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// nine commands and five beats in under 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, run in C:\concepts
// (media/capture-concepts/latency.txt: the capture run plus three timing runs):
// term check 375-402 ms (both runs), term fill --offline 1864-1902 ms,
// graph build 708-722 ms, graph fill 7333-7381 ms, graph check 604-637 ms.
// Output never appears sooner than measured, with one disclosed exception.
//
// graph fill runs a 3B model on CPU for 7.35 s, a sixth of the video. The
// replay shortens that wait, and only that wait, by 1/3.5 to 2.1 s. design.md
// allows compressing static wait and requires the real elapsed time on screen:
// bash's own `time` line is in frame, unedited. Typing and output stay 1x.
const COMPRESS = 3.5;
export const latency = {
  check: Math.round(0.4 * FPS),
  termFill: Math.round(1.9 * FPS),
  build: Math.round(0.72 * FPS),
  graphFill: Math.round((7.35 / COMPRESS) * FPS),
  graphCheck: Math.round(0.63 * FPS),
  grep: 2,
  sed: 2,
};

// `; echo $?` prints the exit code the capture recorded for that run.
const withExit = (name: "check before" | "check after" | "graph check") =>
  `${captures[name]}${captures.exits[name]}\n`;

export const beats: Beat[] = [
  {
    title: "Concepts nobody defined",
    caption: "Pages name concepts freely. Retry and Quota have no term page, so term check fails: exit 1.",
    highlight: ["undefined-term"],
    commands: [
      { typed: "grep concepts: docs/*.md", output: captures.grep, latencyFrames: latency.grep, holdFrames: 1.3 * FPS },
      { typed: "manni term check; echo $?", output: withExit("check before"), latencyFrames: latency.check, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "term fill --offline",
    caption: "--offline sends nothing off the machine. With no local model, term fill writes a stub per concept.",
    highlight: ["created "],
    commands: [
      { typed: "manni term fill --offline", output: captures.fill, latencyFrames: latency.termFill, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "What is left to write",
    caption: "No undefined terms left. check now names the two definitions a person, or a model, still writes.",
    highlight: ["missing-definition"],
    commands: [
      { typed: "manni term check; echo $?", output: withExit("check after"), latencyFrames: latency.check, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "Questions pinned to answers",
    caption: "3 concepts, all from the termbase. A local model pins each page's question to its answer's lines.",
    highlight: ["3 from the termbase", "re-pinned", "paired", "real"],
    commands: [
      { typed: "manni graph build", output: captures.build, latencyFrames: latency.build, holdFrames: 1.0 * FPS },
      {
        typed: "time manni graph fill docs/*.md --fields sample-questions --offline",
        output: captures["graph fill"],
        latencyFrames: latency.graphFill,
        holdFrames: 4.0 * FPS,
      },
    ],
  },
  {
    title: "The answer changed",
    caption: "Edit the pinned line, and graph check flags the question: its answer is no longer there.",
    highlight: ["no longer hold", "1 changed"],
    commands: [
      { typed: "sed -i 's/one gigabyte/two gigabytes/' docs/limits.md", output: "", latencyFrames: latency.sed, holdFrames: 0.5 * FPS },
      { typed: "manni graph check; echo $?", output: withExit("graph check"), latencyFrames: latency.graphCheck, holdFrames: 4.8 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
