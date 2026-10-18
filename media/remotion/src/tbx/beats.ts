import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// eight commands and five beats in under 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in media/scratch-tbx
// (media/capture-tbx/latency.txt: the capture run plus three timing runs):
// list 281-299 ms, get 290-319 ms, write -f tbx3 291-319 ms, write in place
// 288-328 ms, check 286-307 ms. Output never appears sooner than measured.
export const latency = {
  list: Math.round(0.3 * FPS),
  get: Math.round(0.32 * FPS),
  writeTbx3: Math.round(0.32 * FPS),
  writeInPlace: Math.round(0.33 * FPS),
  check: Math.round(0.31 * FPS),
  grep: 2,
  cmp: 2,
};

// `cmp` prints nothing when the files match and exits 0, so `&& echo` runs.
const cmpOutput = captures.exits.cmp === "0" ? "same bytes\n" : "";

export const beats: Beat[] = [
  {
    title: "A translator's termbase",
    caption: "glossary.tbx came from the translators: TBX concept entries, with English and German terms.",
    highlight: ['xml:lang="de"', "Gleitsichtglas"],
    commands: [
      { typed: "grep -E '<(conceptEntry|langSec|term)[ >]' glossary.tbx", output: captures.grep, latencyFrames: latency.grep, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "One term per language",
    caption: "manni term reads TBX v2 and v3. Each language is its own term, joined on the concept id.",
    highlight: ["   de   "],
    commands: [
      { typed: "manni term list glossary.tbx", output: captures.list, latencyFrames: latency.list, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "Every field kept",
    caption: "get finds the entry by its alt label: part of speech, term type, inline markup, the German term.",
    highlight: ["part-of-speech", "term-type", "tbx-markup", 'startRef="b1"', "other languages"],
    commands: [
      { typed: "manni term get PAL glossary.tbx", output: captures.get, latencyFrames: latency.get, holdFrames: 5.0 * FPS },
    ],
  },
  {
    title: "Write TBX v3",
    caption: "-f tbx3 writes TBX v3. Read back, it lists the same records, in a byte-identical file.",
    highlight: ["Wrote 3 terms", "same bytes"],
    commands: [
      { typed: "manni term write glossary.tbx -f tbx3 -o build/glossary.tbx", output: captures["write tbx3"], latencyFrames: latency.writeTbx3, holdFrames: 1.0 * FPS },
      { typed: "manni term list build/glossary.tbx", output: captures["list build"], latencyFrames: latency.list, holdFrames: 1.4 * FPS },
      { typed: "cmp glossary.tbx build/glossary.tbx && echo same bytes", output: cmpOutput, latencyFrames: latency.cmp, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "No churn in place",
    caption: "Written back in place, nothing changes. check passes, exit 0: notices never fail it.",
    highlight: ["Nothing to write", "3 notices"],
    commands: [
      { typed: "manni term write glossary.tbx", output: captures["write inplace"], latencyFrames: latency.writeInPlace, holdFrames: 1.4 * FPS },
      { typed: "manni term check glossary.tbx; echo $?", output: `${captures.check}${captures.exits.check}\n`, latencyFrames: latency.check, holdFrames: 4.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
