import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The fast end: beat 3 types
// an 89-character loop.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, run inside the two scratch
// checkouts (media/strategy-shared/capture/latency.txt: the capture run plus
// three timing runs of each command but git rm, which ran once). check with
// the copy 694-812 ms, git rm 72 ms, check
// without it 577-632 ms, both lists 2247-2535 ms, the join 123-160 ms. Each
// replay is the fastest measured run, rounded up to a whole frame, so output
// never lands sooner than it did. Nothing is compressed.
const at = (ms: number) => Math.ceil((ms / 1000) * FPS);
export const latency = {
  checkCopy: at(694),
  rm: at(72),
  checkBorrowed: at(577),
  cd: 2,
  lists: at(2247),
  join: at(123),
  echo: 1,
};

const lists = "for r in manni manni-plugin; do (cd $r && manni strategy list -f json > ../$r.json); done";

// Per-beat type, derived by media/strategy-shared/capture/cols.mjs from each beat's
// own lines (see strategy-shared-1x1.script.md). Beat 1 wraps under strategy
// check's 46-column gutter (hang), and its borrowed path and Guide URL break once
// each, after a "/".
const type = (fontPx: number) => ({ fontPx, linePx: Math.round(fontPx * 1.4), cols: Math.floor(1040 / (0.6 * fontPx)) });

export const beats: Beat[] = [
  {
    title: "A kept copy of Maya",
    caption: "Two Mayas. The check names the copy.",
    hang: 46,
    highlight: ["strategy/personas/maya.md:3", "Remove this copy"],
    type: type(20),
    commands: [
      { typed: "manni strategy check", output: captures.checkCopy, latencyFrames: latency.checkCopy, holdFrames: 5.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.checkCopy}\n`, latencyFrames: latency.echo, holdFrames: 2.0 * FPS },
    ],
  },
  {
    title: "Remove the copy",
    caption: "One Maya, read from manni.",
    highlight: ["(85 borrowed)"],
    type: type(32),
    commands: [
      { typed: "git rm strategy/personas/maya.md", output: captures.rm, latencyFrames: latency.rm, holdFrames: 0.8 * FPS },
      { typed: "manni strategy check", output: captures.checkBorrowed, latencyFrames: latency.checkBorrowed, holdFrames: 3.2 * FPS },
      { typed: "echo $?", output: `${captures.exits.checkBorrowed}\n`, latencyFrames: latency.echo, holdFrames: 2.0 * FPS },
    ],
  },
  {
    title: "Pages per journey, per repo",
    caption: "Coverage across products, as data.",
    highlight: ['{"id":'],
    type: type(32),
    commands: [
      { typed: "cd ..", output: "", latencyFrames: latency.cd, holdFrames: 0.3 * FPS },
      { typed: lists, output: captures.lists, latencyFrames: latency.lists, holdFrames: 0.5 * FPS },
      // 254 characters, too long to type inside the beat, so it lands whole, as a paste.
      // node -e stands in for the docs' jq, which the capture machine does not have.
      { typed: captures.joinTyped, output: captures.join, latencyFrames: latency.join, holdFrames: 4.5 * FPS, paste: true },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
