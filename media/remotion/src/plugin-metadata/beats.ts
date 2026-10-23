import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The fast end: five beats in
// 45 s, and the longest typed line is 60 characters.
export const TYPING_MS = 36;

// Measured wall-clock latency on this machine, in media/scratch-plugin-metadata/
// (media/plugin-metadata/capture/latency.txt: the capture run plus three timing
// runs). get 298-335 ms, the Read hook 407-500 ms (the timing runs clear the
// hook's memory first, so they include a cold hook), head and cat under 70 ms.
// The MCP server's first line landed 855 ms after Enter and the rest 654 ms
// later (graph.times). The replay uses the slower end of each, so output never
// lands sooner than it did. Nothing is sped up.
export const latency = {
  head: 2,
  cat: 2,
  get: Math.round(0.32 * FPS),
  read: Math.round(0.45 * FPS),
  sed: 2,
  graphFirst: Math.round(0.86 * FPS),
  graphGap: Math.round((captures.graphGapMs / 1000) * FPS),
};

const sed = "sed -i 's/platform-docs/docs-team/' docs/limits.meta.yaml";
const get = "manni meta get --all-fields --no-derived docs/limits.md";
const read = "read-page docs/limits.md";

export const beats: Beat[] = [
  {
    title: "Fields a Read never shows",
    caption: "owner and eval-suite live in a sidecar. Reading the page alone never shows them.",
    highlight: ["owner:", "eval-suite:"],
    commands: [
      { typed: "head -4 docs/limits.md", output: captures.head, latencyFrames: latency.head, holdFrames: 1.4 * FPS },
      { typed: "cat docs/limits.meta.yaml", output: captures.sidecar, latencyFrames: latency.cat, holdFrames: 3.0 * FPS },
    ],
  },
  {
    title: "manni meta get --all-fields",
    caption: "The new flag prints every stored field, page and sidecar alike.",
    highlight: ["owner=", "eval-suite="],
    commands: [{ typed: get, output: captures.get, latencyFrames: latency.get, holdFrames: 3.6 * FPS }],
  },
  {
    title: "What the Read hook adds",
    caption: "When the agent reads the page, the plugin's hook hands it the metadata, sidecar included.",
    highlight: ['"owner"'],
    commands: [{ typed: read, output: captures.read1, latencyFrames: latency.read, holdFrames: 4.0 * FPS }],
  },
  {
    title: "Once, then on change",
    caption: "A second Read adds nothing. Change the sidecar and the next Read says so.",
    continues: true,
    highlight: ["changed since"],
    commands: [
      { typed: read, output: captures.read2, latencyFrames: latency.read, holdFrames: 1.2 * FPS },
      { typed: sed, output: "", latencyFrames: latency.sed, holdFrames: 0.3 * FPS },
      { typed: read, output: captures.read3, latencyFrames: latency.read, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "The graph, over MCP",
    caption: "The plugin's MCP server publishes the graph on first use, then answers from it.",
    highlight: ["published the graph", "lookup: docs"],
    commands: [
      {
        typed: 'mcp-call lookup "What is the fetch timeout?"',
        output: captures.graphFirst,
        latencyFrames: latency.graphFirst,
        more: [{ afterFrames: latency.graphGap, output: captures.graphRest }],
        holdFrames: 4.8 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
