import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// six commands and four beats in about 35 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, run in C:\concepts
// (media/capture-concepts/latency.txt: the capture run plus three timing runs):
// term check 379-418 ms (both runs), term fill --offline 385-424 ms,
// graph build 713-836 ms, graph check 594-650 ms. Output never appears sooner.
export const latency = {
  check: Math.round(0.4 * FPS),
  fill: Math.round(0.41 * FPS),
  build: Math.round(0.76 * FPS),
  graphCheck: Math.round(0.62 * FPS),
  grep: 2,
};

// `; echo $?` prints the exit code the capture recorded for that run.
const withExit = (name: keyof typeof captures.exits & keyof typeof captures) =>
  `${captures[name]}${captures.exits[name]}\n`;

export const beats: Beat[] = [
  {
    title: "Concepts nobody defined",
    caption: "Pages name concepts freely. Retry and Quota have no term page, so term check fails: exit 1.",
    highlight: ["undefined-term"],
    commands: [
      { typed: "grep concepts: docs/*.md", output: captures.grep, latencyFrames: latency.grep, holdFrames: 1.6 * FPS },
      { typed: "manni term check; echo $?", output: withExit("check before"), latencyFrames: latency.check, holdFrames: 4.6 * FPS },
    ],
  },
  {
    title: "term fill --offline",
    caption: "term fill creates a term page for each missing concept. With no model, each page is a stub.",
    highlight: ["created "],
    commands: [
      { typed: "manni term fill --offline", output: captures.fill, latencyFrames: latency.fill, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "What is left to write",
    caption: "No undefined terms left. check now names the two definitions a person, or a model, still writes.",
    highlight: ["missing-definition"],
    commands: [
      { typed: "manni term check; echo $?", output: withExit("check after"), latencyFrames: latency.check, holdFrames: 4.6 * FPS },
    ],
  },
  {
    title: "One concept scheme",
    caption: "3 concepts, all from the termbase. limits.md's own question finds another page: a warning, exit 0.",
    highlight: ["3 from the termbase", "sampleQuestion"],
    commands: [
      { typed: "manni graph build", output: captures.build, latencyFrames: latency.build, holdFrames: 2.0 * FPS },
      { typed: "manni graph check; echo $?", output: withExit("graph check"), latencyFrames: latency.graphCheck, holdFrames: 5.4 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
