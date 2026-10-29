import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// metadata-dir-1x1. Typing speed for this video (design.md: 35-70 ms).
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in media/scratch-metadata-dir
// (media/capture-metadata-dir/latency.txt: the capture run plus three timing runs,
// each output line stamped with its millisecond after Enter):
//   "Using manni.config.yaml (.)"  301-456 ms, every manni run
//   validate's orphan line         41-48 ms after it
//   relocate's report              556-635 ms after Enter
//   validate's pass                22-83 ms after the config line
//   get's value                    33-36 ms after it
//   the missing-directory refusal  41-47 ms after it
//   git mv 58-106 ms, cat 37-90 ms
// The replay uses the first whole frame inside each range, or the first after it
// when none falls inside. No wait is compressed. Lines of one chunk that the
// stamps put ~20 ms apart land together: that gap is the stamping loop's own
// `date` process per line, not the CLI.
export const latency = {
  using: 10,
  usingRenamed: 11,
  orphan: 2,
  report: 17 - 10,
  pass: 1,
  value: 1,
  refusal: 2,
  shell: 2,
};

const withExit = (out: string, code: string) => `${out}${code}\n`;
const c = captures;

export const beats: Beat[] = [
  {
    title: "Metadata beside the page",
    caption: "The sidecar holds personas and owner, keyed by path.",
    highlight: ["docs/guide.md:"],
    commands: [
      { typed: "cat docs/guide.meta.yaml", output: c["cat sidecar"], latencyFrames: latency.shell, holdFrames: 2.2 * FPS },
    ],
  },
  {
    title: "Rename it, and the run stops",
    caption: "The sidecar still names docs/guide.md. Exit 2.",
    highlight: ["did not load"],
    commands: [
      { typed: "git mv docs/guide.md docs/getting-started.md", output: "", latencyFrames: latency.shell, holdFrames: 0.4 * FPS },
      {
        typed: "manni meta validate; echo $?",
        output: c["validate orphan"].using,
        latencyFrames: latency.using,
        more: [{ afterFrames: latency.orphan, output: withExit(c["validate orphan"].rest, c.exits["validate orphan"]) }],
        holdFrames: 2.8 * FPS,
      },
    ],
  },
  {
    title: "manni meta relocate --from",
    caption: "Rename undone. Values move to metadata/, keyed by id.",
    highlight: ["minted guide", "metadata/guide.yaml"],
    commands: [
      { typed: "git mv docs/getting-started.md docs/guide.md", output: "", latencyFrames: latency.shell, holdFrames: 0.4 * FPS },
      {
        typed: 'manni meta relocate --from "{page}.meta.yaml"',
        output: c.relocate.using,
        latencyFrames: latency.using,
        more: [{ afterFrames: latency.report, output: c.relocate.rest }],
        holdFrames: 3.9 * FPS,
      },
    ],
  },
  {
    title: "One file per id",
    caption: "Named and keyed by guide, the id minted into the page.",
    highlight: ["guide:"],
    commands: [
      { typed: "cat metadata/guide.yaml", output: c["cat manifest"], latencyFrames: latency.shell, holdFrames: 2.4 * FPS },
    ],
  },
  {
    title: "Rename it again",
    caption: "Found by id, not path. Exit 0; owner still reads ada.",
    highlight: ["1 passed", "owner=ada"],
    commands: [
      { typed: "git mv docs/guide.md docs/getting-started.md", output: "", latencyFrames: latency.shell, holdFrames: 0.4 * FPS },
      {
        typed: "manni meta validate; echo $?",
        output: c["validate renamed"].using,
        latencyFrames: latency.usingRenamed,
        more: [{ afterFrames: latency.pass, output: withExit(c["validate renamed"].rest, c.exits["validate renamed"]) }],
        holdFrames: 1.4 * FPS,
      },
      {
        typed: "manni meta get docs/getting-started.md --fields owner",
        output: c.get.using,
        latencyFrames: latency.using,
        more: [{ afterFrames: latency.value, output: c.get.rest }],
        holdFrames: 2.6 * FPS,
      },
    ],
  },
  {
    title: "Another checkout, not there",
    caption: "The variable moves the directory. Missing, it exits 2.",
    highlight: ["does not exist"],
    commands: [
      {
        typed: "MANNI_EXTERNAL_METADATA_DIR=../elsewhere manni meta validate; echo $?",
        output: c["env missing"].using,
        latencyFrames: latency.using,
        more: [{ afterFrames: latency.refusal, output: withExit(c["env missing"].rest, c.exits["env missing"]) }],
        holdFrames: 3.0 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
