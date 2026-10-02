import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// twelve commands in three beats, under 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in the demo repository
// (media/graph/capture/latency.txt: the capture run plus three timing runs).
// term check with graph: 604-941 ms, term check with kg: 588-781 ms,
// meta validate 607-834 ms. The replay uses the median of the four runs, so
// output never lands at the fast end of what was measured.
export const latency = {
  termCheckGraph: Math.round(0.77 * FPS),
  termCheckKg: Math.round(0.68 * FPS),
  validate: Math.round(0.81 * FPS),
  sed: 2,
  cat: 2,
  echo: 1,
};

export const beats: Beat[] = [
  {
    title: "graph: names the term",
    caption: "The guide's graph: block names progressive lens in concepts. manni term check resolves it: exit 0.",
    highlight: ["label: progressive lens", "concepts: [progressive lens]", "1 reference"],
    commands: [
      { typed: "cat docs/terms/progressive-lens.md", output: captures["b1 cat term"], latencyFrames: latency.cat, holdFrames: 1.2 * FPS },
      { typed: "cat docs/fitting.md", output: captures["b1 cat guide"], latencyFrames: latency.cat, holdFrames: 1.4 * FPS },
      { typed: "manni term check", output: captures["b1 term check"], latencyFrames: latency.termCheckGraph, holdFrames: 1.8 * FPS },
      { typed: "echo $?", output: `${captures.exits.b1}\n`, latencyFrames: latency.echo, holdFrames: 3.0 * FPS },
    ],
  },
  {
    title: "kg: no longer counts",
    caption: "manni term no longer reads kg.concepts. The term is now unused: a notice, so still exit 0.",
    highlight: ["kg:", "unused-term"],
    commands: [
      { typed: "sed -i 's/^graph:/kg:/' docs/fitting.md", output: "", latencyFrames: latency.sed, holdFrames: 0.4 * FPS },
      { typed: "cat docs/fitting.md", output: captures["b2 cat guide"], latencyFrames: latency.cat, holdFrames: 1.4 * FPS },
      { typed: "manni term check", output: captures["b2 term check"], latencyFrames: latency.termCheckKg, holdFrames: 2.4 * FPS },
      { typed: "echo $?", output: `${captures.exits.b2}\n`, latencyFrames: latency.echo, holdFrames: 3.0 * FPS },
    ],
  },
  {
    title: "The block is closed",
    caption: "The draft manni:graph:1.0.0-proposal.1 closes the block, so a typo inside it fails: exit 1.",
    highlight: ["concept: [", "additional property"],
    commands: [
      { typed: "sed -i 's/^kg:/graph:/; s/concepts:/concept:/' docs/fitting.md", output: "", latencyFrames: latency.sed, holdFrames: 0.4 * FPS },
      { typed: "cat docs/fitting.md", output: captures["b3 cat guide"], latencyFrames: latency.cat, holdFrames: 1.4 * FPS },
      { typed: "manni meta validate -s graph-1.0.0-proposal.1.json docs/fitting.md", output: captures["b3 validate"], latencyFrames: latency.validate, holdFrames: 2.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.b3}\n`, latencyFrames: latency.echo, holdFrames: 3.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
