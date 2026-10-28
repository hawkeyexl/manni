import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// eight commands and two multi-second graph runs in under 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in C:\flare (the junction to
// media/scratch-flare-targets; media/capture-flare-targets/latency.txt: the capture
// run plus three timing runs): lint 1251-1338 ms, build 2168-3024 ms, export
// 3223-4894 ms, get 763-869 ms. Each replay value sits inside its measured range,
// at the low end. No wait is compressed.
export const latency = {
  lint: Math.round(1.26 * FPS),
  build: Math.round(2.2 * FPS),
  export: Math.round(3.25 * FPS),
  get: Math.round(0.78 * FPS),
  shell: 2,
};

export const beats: Beat[] = [
  {
    title: "A Flare topic as written",
    caption: "Install.htm uses a variable, a snippet and a PrintOnly paragraph. HTML5 sets ProductVersion to 4.3.",
    highlight: ["Default.PrintOnly", ">4.3<"],
    // 20 px / 86 columns for this beat alone: at the video's 21 px the highlighted
    // HTML5.fltar line (83 characters) wraps inside its <Variable> tag. The topic's
    // Version line is 87 and wraps at a space at either size (capture-flare-targets/cols.mjs).
    type: { fontPx: 20, linePx: 28, cols: 86 },
    commands: [
      { typed: "grep -E 'variable|snippet|PrintOnly' Content/Topics/Install.htm", output: captures["grep topic"], latencyFrames: latency.shell, holdFrames: 0.8 * FPS },
      { typed: "grep -r ProductVersion Project", output: captures["grep version"], latencyFrames: latency.shell, holdFrames: 3.3 * FPS },
    ],
  },
  {
    title: "Project and target, found",
    caption: "lint finds Widget.flprj and the HTML5 target from config. The snippet's h2 fills before-you-start.",
    highlight: ["· flare", "before-you-start"],
    commands: [
      { typed: "manni lint structure Content/Topics/Install.htm -t tgdp:how-to:1.6 --explain", output: captures.lint, latencyFrames: latency.lint, holdFrames: 3.8 * FPS },
    ],
  },
  {
    title: "Passages as HTML5 builds them",
    caption: "Graph passages carry the text HTML5 builds: version 4.3, and the PrintOnly paragraph is gone.",
    highlight: ["Version 4.3 needs", "jsonl:0", "json:0"],
    commands: [
      {
        typed: "manni graph build && manni graph export chunks -o out",
        output: captures.build,
        latencyFrames: latency.build,
        more: [{ afterFrames: latency.export, output: captures.export }],
        holdFrames: 0.7 * FPS,
      },
      { typed: 'grep -m1 -o "Version [0-9.]* needs Node 20" out/*.jsonl', output: captures["grep passage"], latencyFrames: latency.shell, holdFrames: 0.7 * FPS },
      { typed: 'grep -rc "prints only" out', output: captures["grep printonly"], latencyFrames: latency.shell, holdFrames: 3.3 * FPS },
    ],
  },
  {
    title: "Index keywords, read",
    caption: "Index keyword markers become the keywords field.",
    highlight: ['term="install;setup"', 'keywords=["install"'],
    commands: [
      { typed: "grep keyword Content/Topics/Install.htm", output: captures["grep keyword"], latencyFrames: latency.shell, holdFrames: 0.7 * FPS },
      { typed: "manni meta get keywords Content/Topics/Install.htm", output: captures.get, latencyFrames: latency.get, holdFrames: 3.4 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
