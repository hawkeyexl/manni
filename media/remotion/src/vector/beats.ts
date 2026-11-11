import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because two of the typed lines run past 80 characters.
export const TYPING_MS = 40;

// Measured wall-clock latency, from media/capture-vector/latency.txt:
//   graph embed     606 ms     (refused before anything is read)
//   vector build    3m21.828s  (268 pages, 3174 vectors, --no-cache: every vector computed)
//   vector search   1536-1790 ms over four runs (model load included)
//
// The build is four times longer than the whole video, so the replay shortens
// the wait between Enter and the output by one factor, 1/100.9, to 2.0 s.
// design.md allows compressing static wait only, and requires the real elapsed
// time on screen: bash's own `time` output is in frame, unedited, and a chrome
// note under the command says the wait was shortened. Typing and output are 1x,
// and the refusal and the search run at their real speed.
const COMPRESS = 100.9;
export const latency = {
  embed: Math.round(0.606 * FPS), // 18 frames, 1x
  build: Math.round((201.828 / COMPRESS) * FPS), // 60 frames, 2.00 s
  search: Math.round(1.6 * FPS), // 48 frames, 1x
  ls: 2,
  echo: 1,
};

const OUT = "media/scratch-vector/out";

export const beats: Beat[] = [
  {
    title: "Vectors used to need a graph",
    caption:
      "It took three graph commands: build, export search, embed. The last one now says where it went.",
    highlight: ["moved to manni vector build"],
    commands: [
      { typed: "manni graph embed", output: captures.embed, latencyFrames: latency.embed, holdFrames: 3.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.embed}\n`, latencyFrames: latency.echo, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "Pages to vectors, one step",
    caption:
      "The site's 268 pages become 3174 vectors, every one computed fresh. No graph.ttl is written.",
    highlight: ["3174 embedded, 0 from cache", "3m21.828s"],
    commands: [
      {
        typed: `time manni vector build --collection site --no-cache -o ${OUT}`,
        output: captures.build,
        latencyFrames: latency.build,
        holdFrames: 4.6 * FPS,
        note: "[201.8 s run; the wait is cut to 2 s]",
      },
      { typed: `ls -1 ${OUT}`, output: captures.ls, latencyFrames: latency.ls, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "Search by meaning",
    caption:
      "Top hits: the concept of pinning a fact to a sentence, and the page that teaches it.",
    highlight: ["Pin a fact to the sentence"],
    // Search hits are long: a 26 px beat keeps each hit's title whole on one row,
    // and continuation rows hang under the score gutter the CLI prints.
    type: { fontPx: 26, linePx: 36, cols: 66 },
    hang: 8,
    commands: [
      {
        typed: `manni vector search "pin a sentence to its source" --limit 3 -i ${OUT}`,
        output: captures.search,
        latencyFrames: latency.search,
        holdFrames: 4.2 * FPS,
      },
    ],
  },
  {
    title: "Same ids as the graph",
    caption:
      "Every hit is a graph node IRI, so the graph, its chunks and the vectors join on one id.",
    continues: true,
    type: { fontPx: 26, linePx: 36, cols: 66 },
    hang: 8,
    highlight: ["https://hawkeyexl.github.io/manni/id/"],
    commands: [],
    pauseFrames: 4.4 * FPS,
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
