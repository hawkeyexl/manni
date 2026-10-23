import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The cite add line is 92
// characters, so the floor of the range.
export const TYPING_MS = 35;

// Measured wall-clock latency, from media/evidence-pins/latency.txt.
// Replayed at 1x: every run is under 0.7 s, so nothing is compressed.
//   add             489 ms
//   check-current   405 ms
//   diff-persona     58 ms
//   check-moved     417 ms
//   update          428 ms
//   diff-note        57 ms
//   check-changed   660 ms
export const latency = {
  add: Math.round(0.489 * FPS),
  checkCurrent: Math.round(0.405 * FPS),
  diffPersona: Math.round(0.058 * FPS),
  checkMoved: Math.round(0.417 * FPS),
  update: Math.round(0.428 * FPS),
  diffNote: Math.round(0.057 * FPS),
  checkChanged: Math.round(0.66 * FPS),
  cat: 2,
  echo: 1,
};

const THEO = "records/personas/theo.md";
const NOTE = "research/contributor.md";

// Type size per beat, derived from each beat's own lines by
// media/evidence-pins/cols.mjs. Beat 4 takes the video's 19 px from Root.tsx:
// its moved pin row is 87 characters, and every larger size leaves one word
// alone on a row. The others need not shrink with it.
export const beats: Beat[] = [
  {
    title: "A persona's pains",
    type: { fontPx: 27, linePx: 38, cols: 64 },
    caption: "A persona makes claims. What do they rest on?",
    highlight: ["pains:", "  - Error messages are terse"],
    commands: [{ typed: `cat ${THEO}`, output: captures.catPersona, latencyFrames: latency.cat, holdFrames: 2.3 * FPS }],
  },
  {
    title: "manni cite add",
    type: { fontPx: 29, linePx: 41, cols: 59 },
    caption: "Pin the first pain to line 3 of an interview note.",
    highlight: ["added terse-messages"],
    commands: [
      {
        typed: `manni cite add ${THEO}#/pains/0 ${NOTE}:3 --id terse-messages`,
        output: captures.add,
        latencyFrames: latency.add,
        holdFrames: 3.1 * FPS,
      },
    ],
  },
  {
    title: "manni cite check",
    type: { fontPx: 26, linePx: 36, cols: 66 },
    caption: "The pain and its evidence both read current.",
    highlight: ["#/pains/0 current"],
    commands: [
      { typed: `manni cite check ${THEO}`, output: captures["check-current"], latencyFrames: latency.checkCurrent, holdFrames: 2.2 * FPS },
    ],
  },
  {
    title: "The pains reorder",
    caption: "The pin follows the moved value. update rewrites it.",
    highlight: ["#/pains/0 moved -> #/pains/1", "claim #/pains/0 -> #/pains/1"],
    commands: [
      { typed: `git diff -U1 ${THEO}`, output: captures["diff-persona"], latencyFrames: latency.diffPersona, holdFrames: 1.2 * FPS },
      { typed: `manni cite check ${THEO}`, output: captures["check-moved"], latencyFrames: latency.checkMoved, holdFrames: 2.3 * FPS },
      { typed: `manni cite update ${THEO}`, output: captures.update, latencyFrames: latency.update, holdFrames: 1.8 * FPS },
    ],
  },
  {
    title: "The evidence changes",
    type: { fontPx: 23, linePx: 32, cols: 75 },
    caption: "The evidence changed, so the check fails. Exit 1.",
    highlight: ["+- The error named", "changed since", "manni:cite source-changed"],
    commands: [
      { typed: `git diff ${NOTE}`, output: captures["diff-note"], latencyFrames: latency.diffNote, holdFrames: 1.3 * FPS },
      { typed: `manni cite check ${THEO}`, output: captures["check-changed"], latencyFrames: latency.checkChanged, holdFrames: 2.4 * FPS },
      { typed: "echo $?", output: `${captures.exits["check-changed"]}\n`, latencyFrames: latency.echo, holdFrames: 1.6 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
