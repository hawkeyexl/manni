import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// the traverse invocation is 108 characters, and at 45 ms it alone would eat
// five seconds of a forty-five second budget.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in C:\kgdemo
// (media/kg/capture/latency.txt: the capture run plus three timing runs):
// build 823-864 ms, traverse 757-793 ms, query 754-794 ms, stats --check
// 754-855 ms, grep 27-29 ms. Held to the slowest of each, so output never
// appears sooner than the real command produced it.
export const latency = {
  build: Math.round(0.86 * FPS),
  traverse: Math.round(0.79 * FPS),
  query: Math.round(0.79 * FPS),
  statsCheck: Math.round(0.86 * FPS),
  grep: 2,
};

const IRI = "https://acme.dev/doc/docs/configuration.md";

export const beats: Beat[] = [
  {
    title: "Two pages mention it",
    caption:
      "grep finds the pages that name configuration.md. It cannot find the pages that depend on those.",
    highlight: ["docs/getting-started.md", "docs/windows-notes.md"],
    commands: [
      {
        typed: "grep -rl configuration.md docs/",
        output: captures.grep,
        latencyFrames: latency.grep,
        holdFrames: 3.4 * FPS,
      },
    ],
  },
  {
    title: "manni kg finds three",
    caption:
      "harvest.md is reached through windows-notes.md. Two hops out, where grep never looked.",
    highlight: ["harvest.md", "3 nodes"],
    commands: [
      {
        typed: "manni kg build docs/",
        output: captures.build,
        latencyFrames: latency.build,
        holdFrames: 1.9 * FPS,
      },
      {
        typed: `manni kg traverse ${IRI} --predicates dcterms:references --impact -d 2`,
        output: captures.traverse,
        latencyFrames: latency.traverse,
        holdFrames: 5.0 * FPS,
      },
    ],
  },
  {
    title: "The build fails on it",
    caption:
      "The same graph carries every dead link, and stats --check exits 1. CI has something to fail on.",
    highlight: ["missing.md", "1"],
    commands: [
      {
        typed: "manni kg query --p kg:brokenLink",
        output: captures.query,
        latencyFrames: latency.query,
        holdFrames: 3.2 * FPS,
      },
      {
        typed: "manni kg stats --check > /dev/null; echo $?",
        output: `${captures.exits.statsCheck}\n`,
        latencyFrames: latency.statsCheck,
        holdFrames: 3.6 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
