import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// the traverse invocation is 102 characters.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in media/scratch-formats
// (media/graph/capture-formats/latency.txt: the capture run plus three timing runs):
// build --ext 1124-1129 ms, build 1158-1175 ms, stats 993-1005 ms,
// traverse 999-1010 ms. Held to the slowest of each, so output never appears
// sooner than the real command produced it. Nothing is sped up.
export const latency = {
  buildMd: Math.round(1.13 * FPS),
  buildAll: Math.round(1.18 * FPS),
  stats: Math.round(1.01 * FPS),
  traverse: Math.round(1.01 * FPS),
};

const STATS = "manni graph stats --top 6 | head -13";
const IRI = "https://example.com/formats/doc/index.md";

export const beats: Beat[] = [
  {
    title: "Markdown only",
    caption: "The old Markdown-only walk reads 1 page of 6. Its 8 links into the other formats look broken.",
    highlight: ["Documents:", "Broken internal links"],
    commands: [
      {
        typed: "manni graph build --ext .md,.mdx,.markdown > /dev/null",
        output: captures.buildMd,
        latencyFrames: latency.buildMd,
        holdFrames: 0.4 * FPS,
      },
      {
        typed: STATS,
        output: captures.statsMd,
        latencyFrames: latency.stats,
        holdFrames: 5.0 * FPS,
      },
    ],
  },
  {
    title: "Every format, no flag",
    caption: "With no --ext, graph build also reads HTML, DITA, AsciiDoc and reStructuredText. 6 pages.",
    highlight: ["Documents:", "guide.html", "topic.dita", "notes.adoc", "ref.rst", "map.ditamap"],
    commands: [
      {
        typed: "manni graph build > /dev/null",
        output: captures.buildAll,
        latencyFrames: latency.buildAll,
        holdFrames: 0.4 * FPS,
      },
      {
        typed: STATS,
        output: captures.statsAll,
        latencyFrames: latency.stats,
        holdFrames: 5.0 * FPS,
      },
    ],
  },
  {
    title: "Links cross formats",
    caption: "What depends on the Markdown page: HTML, AsciiDoc and RST pages, and a DITA map one hop out.",
    highlight: ["guide.html", "notes.adoc", "ref.rst", "map.ditamap"],
    commands: [
      {
        typed: `manni graph traverse ${IRI} --predicates dcterms:references --impact`,
        output: captures.traverse,
        latencyFrames: latency.traverse,
        holdFrames: 6.0 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
