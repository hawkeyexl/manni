import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms).
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in the demo directory
// (media/vocabularies/capture/latency.txt: the capture run plus three timing
// runs). validate before fill 584-656 ms, validate after fill 589-604 ms.
// The replay uses 0.60 s for both, the median of the eight runs.
//
// fill took 22.919 s (bash's `time`, in frame). design.md allows compressing
// static wait only, with the real time disclosed. The replay shortens the gap
// between Enter and fill's output to 2.0 s, a factor of 1/11.5. Typing and
// output run at 1x, and the `real 0m22.919s` line is on screen unedited.
export const FILL_REAL_S = 22.919;
export const FILL_REPLAY_S = 2.0;
export const latency = {
  validate: Math.round(0.6 * FPS),
  fill: Math.round(FILL_REPLAY_S * FPS),
  cat: 2,
  head: 2,
  echo: 1,
};

const FIELDS = "description,audiences,lifecycle";

export const beats: Beat[] = [
  {
    title: "A page, no description",
    caption: "A guide with a type and a title, and no description. No config, no schema named.",
    highlight: ["title: Fitting progressive lenses"],
    commands: [
      { typed: "cat page.md", output: captures["b1 cat page"], latencyFrames: latency.cat, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "The default set checks it",
    caption: "A bare validate now applies manni:core:1.0.0, which requires a description: exit 1.",
    highlight: ["'description'"],
    commands: [
      { typed: "manni meta validate page.md", output: captures["b2 validate"], latencyFrames: latency.validate, holdFrames: 2.2 * FPS },
      { typed: "echo $?", output: `${captures.exits.b2}\n`, latencyFrames: latency.echo, holdFrames: 3.2 * FPS },
    ],
  },
  {
    title: "fill proposes the fields",
    caption: "fill infers the description, plus audiences and lifecycle. It took 23 s; the wait is shortened.",
    highlight: ["/description  A", "/audiences  [", "/lifecycle  draft", "real "],
    commands: [
      {
        typed: `time manni meta fill page.md --fields ${FIELDS}`,
        output: captures["b3 fill"],
        latencyFrames: latency.fill,
        holdFrames: 5.2 * FPS,
      },
    ],
  },
  {
    title: "Written to the page",
    caption: "The three values are frontmatter now. The lines below them record which model wrote them.",
    highlight: ["description:", "audiences:", "  - ", "lifecycle:"],
    commands: [
      { typed: `head -n ${captures.headN} page.md`, output: captures["b4 head page"], latencyFrames: latency.head, holdFrames: 4.4 * FPS },
    ],
  },
  {
    title: "Valid: exit 0",
    caption: "The same bare validate passes: exit 0. The warning is ai-context asking for a sidecar.",
    highlight: ["1 passed"],
    commands: [
      { typed: "manni meta validate page.md", output: captures["b5 validate"], latencyFrames: latency.validate, holdFrames: 2.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.b5}\n`, latencyFrames: latency.echo, holdFrames: 3.6 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
