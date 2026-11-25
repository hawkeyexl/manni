import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms).
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in media/scratch-template-evals
// (media/capture-template-evals/latency.txt: the capture run plus three timing
// runs): list 614-1493 ms, run 1014-1560 ms. Each replay value sits inside the
// measured range, at the low end. No wait is compressed.
export const latency = {
  list: Math.round(0.62 * FPS),
  run: Math.round(1.02 * FPS),
  shell: 2,
};

const withExit = (out: string, code: string) => `${out}${code}\n`;

// Beats 3 and 4 run at 20 px / 86 columns: the list's 29 rows at the video's
// 26 px would be 1044 px, taller than the terminal (capture-template-evals/cols.mjs).
const small = { fontPx: 20, linePx: 28, cols: 86 };

export const beats: Beat[] = [
  {
    title: "A page that says how-to",
    caption: "type: how-to, and no manni command on the page.",
    highlight: ["type: how-to", "Read the page"],
    commands: [
      { typed: "cat docs/typed-fails.md", output: captures.page, latencyFrames: latency.shell, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "The template carries evals",
    caption: "It extends TGDP's how-to, skips one eval and adds one.",
    highlight: ["extends:", "use: tgdp-one-method", "skip: true", "id: shows-the-command"],
    commands: [
      { typed: "cat templates/how-to.yaml", output: captures.template, latencyFrames: latency.shell, holdFrames: 5.2 * FPS },
    ],
  },
  {
    title: "The type routes the evals",
    caption: "TGDP's guidance arrives as evals. One is skipped.",
    highlight: ["(template:", "tgdp-one-method [", "shows-the-command ["],
    type: small,
    commands: [
      { typed: "manni docevals list docs/typed-fails.md", output: captures.list, latencyFrames: latency.list, holdFrames: 6.4 * FPS },
    ],
  },
  {
    title: "The house eval fails",
    caption: "FAIL at the page's type: line. Exit 1.",
    highlight: ["FAIL shows-the-command", "error:1"],
    type: small,
    commands: [
      {
        typed: "manni docevals run --deterministic-only docs/typed-fails.md; echo $?",
        output: withExit(captures.run, captures.exits.run),
        latencyFrames: latency.run,
        holdFrames: 5.6 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
