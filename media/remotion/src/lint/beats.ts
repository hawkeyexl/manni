import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// seven commands and five beats inside 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in media/scratch-lint
// (media/capture-lint/latency.txt: the capture run plus three timing runs):
// lint structure 742-815 ms, templates infer to stdout 702-787 ms, and
// templates infer -o 714-804 ms. Output never appears sooner than measured.
export const latency = {
  lint: Math.round(0.78 * FPS),
  inferStdout: Math.round(0.75 * FPS),
  inferWrite: Math.round(0.76 * FPS),
  sed: 2,
  cat: 2,
  echo: 1,
};

const LINT = "manni lint structure docs/rotate-key.md";

export const beats: Beat[] = [
  {
    title: "A page with no template",
    caption: "This page is already the shape you want. Nothing in the repo describes that shape.",
    highlight: ["## Overview", "## Before you start", "## Rotate the key", "## See also"],
    commands: [
      { typed: "cat docs/rotate-key.md", output: captures["cat page"], latencyFrames: latency.cat, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "Writing one by hand",
    caption: "A half-written template makes every real section unexpected. Three findings, exit 1.",
    highlight: ["unexpected-section"],
    commands: [
      { typed: "cat templates.yaml", output: captures["cat stub"], latencyFrames: latency.cat, holdFrames: 1.4 * FPS },
      { typed: LINT, output: captures["lint wall"], latencyFrames: latency.lint, holdFrames: 3.8 * FPS },
    ],
  },
  {
    title: "Infer it from the page",
    caption: "manni lint templates infer reads the page and writes the template that describes it.",
    highlight: ["- heading: ", "codeBlocks:"],
    commands: [
      {
        typed: "manni lint templates infer docs/rotate-key.md",
        output: captures["infer stdout"],
        latencyFrames: latency.inferStdout,
        holdFrames: 4.0 * FPS,
      },
    ],
  },
  {
    title: "Save it, and it passes",
    caption: "Save it over the stub, and the same lint command passes.",
    highlight: ["Wrote template", "1 passed, 0 failed"],
    commands: [
      {
        typed: "manni lint templates infer docs/rotate-key.md -o templates.yaml --force",
        output: captures["infer write"],
        latencyFrames: latency.inferWrite,
        holdFrames: 1.1 * FPS,
      },
      { typed: LINT, output: captures["lint pass"], latencyFrames: latency.lint, holdFrames: 3.0 * FPS },
    ],
  },
  {
    title: "Break the page",
    caption: "Delete the required See also section: one finding, anchored at line 23, exit 1.",
    highlight: ["missing-section", "0 passed, 1 failed"],
    commands: [
      { typed: "sed -i '/^## See also/,$d' docs/rotate-key.md", output: "", latencyFrames: latency.sed, holdFrames: 0.3 * FPS },
      { typed: LINT, output: captures["lint broken"], latencyFrames: latency.lint, holdFrames: 2.2 * FPS },
      { typed: "echo $?", output: `${captures.exits.lintBroken}\n`, latencyFrames: latency.echo, holdFrames: 2.2 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
