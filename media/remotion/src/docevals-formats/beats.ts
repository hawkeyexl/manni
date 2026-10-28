import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Four commands, in under 45 s.
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in C:\formats (the junction to
// media/scratch-docevals-formats; media/capture-docevals-formats/latency.txt: the
// capture run plus three timing runs): docevals run 591-808 ms. The replay value
// sits inside the measured range, at the low end. No wait is compressed.
export const latency = {
  run: Math.round(0.6 * FPS),
  shell: 2,
};

const withExit = (out: string, code: string) => `${out}${code}\n`;

export const beats: Beat[] = [
  {
    title: "Four formats, four TODOs",
    caption: "DITA, AsciiDoc, RST and HTML, each with a TODO.",
    highlight: ["TODO: name"],
    commands: [
      { typed: "ls Content", output: captures.ls, latencyFrames: latency.shell, holdFrames: 1.6 * FPS },
      { typed: "grep -n TODO Content/*.{dita,adoc,rst,htm}", output: captures["grep todo"], latencyFrames: latency.shell, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "The eval sits beside the page",
    caption: "Markup takes no YAML block. A manifest holds it.",
    highlight: ["Content/topic.htm:", "not-contains"],
    commands: [
      { typed: "cat Content/topic.meta.yaml", output: captures.manifest, latencyFrames: latency.shell, holdFrames: 4.4 * FPS },
    ],
  },
  {
    title: "docevals grades every format",
    caption: "Each finding names the page's own line. Exit 1.",
    highlight: ["error:", "below target"],
    // 19 px / 91 columns for this beat alone: its 30 rows at the video's 24 px
    // would be 1020 px, taller than the frame (capture-docevals-formats/cols.mjs).
    type: { fontPx: 19, linePx: 27, cols: 91 },
    commands: [
      {
        typed: "manni docevals run --deterministic-only; echo $?",
        output: withExit(captures.run, captures.exits.run),
        latencyFrames: latency.run,
        holdFrames: 7 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
