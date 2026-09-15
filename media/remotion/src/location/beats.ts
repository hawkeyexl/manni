import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// seven commands and five beats in under 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in media/scratch-location
// (media/capture-location/latency.txt: the capture run plus three timing runs):
// validate 536-558 ms, relocate 571-584 ms, validate after relocate 532-552 ms,
// git diff 37-38 ms. Output never appears sooner than measured.
export const latency = {
  validate: Math.round(0.56 * FPS),
  relocate: Math.round(0.58 * FPS),
  validateClean: Math.round(0.55 * FPS),
  git: 2,
  cat: 2,
  echo: 1,
};

export const beats: Beat[] = [
  {
    title: "Maintainer data on the page",
    caption: "owner, stakeholders and review-interval ship with the page. The schema marks them external.",
    highlight: ["owner: platform", "stakeholders: [", "review-interval: 90d", '"external"'],
    commands: [
      { typed: "cat docs/install.md", output: captures["cat page"], latencyFrames: latency.cat, holdFrames: 1.5 * FPS },
      { typed: "cat page.schema.json", output: captures["cat schema"], latencyFrames: latency.cat, holdFrames: 3.8 * FPS },
    ],
  },
  {
    title: "validate: warn, don't fail",
    caption: "validate flags each misplaced value as location:external. Exit 0, so CI never blocks.",
    highlight: ["[location:external]"],
    commands: [
      { typed: "manni meta validate", output: captures["validate warns"], latencyFrames: latency.validate, holdFrames: 4.2 * FPS },
      { typed: "echo $?", output: `${captures.exits.validate1}\n`, latencyFrames: latency.echo, holdFrames: 1.5 * FPS },
    ],
  },
  {
    title: "relocate moves them",
    caption: "relocate creates site.metadata.yaml and moves the three values into it, keyed by page.",
    highlight: ["→ site.metadata.yaml"],
    commands: [
      { typed: "manni meta relocate", output: captures.relocate, latencyFrames: latency.relocate, holdFrames: 1.5 * FPS },
      { typed: "cat site.metadata.yaml", output: captures["cat manifest"], latencyFrames: latency.cat, holdFrames: 3.5 * FPS },
    ],
  },
  {
    title: "The page slims down",
    caption: "The page drops three lines. manni.config.yaml now says the manifest owns those keys.",
    highlight: ["-owner:", "-stakeholders:", "-review-interval:", "externalMetadata:", "file: ./site.metadata.yaml", "keys: [owner"],
    commands: [
      { typed: "git diff -U1", output: captures["git diff -U1"], latencyFrames: latency.git, holdFrames: 5.0 * FPS },
    ],
  },
  {
    title: "validate: clean",
    caption: "Same values, now in the manifest. validate is clean: no warnings, exit 0.",
    highlight: ["1 file checked"],
    commands: [
      { typed: "manni meta validate", output: captures["validate clean"], latencyFrames: latency.validateClean, holdFrames: 0.8 * FPS },
      { typed: "echo $?", output: `${captures.exits.validate2}\n`, latencyFrames: latency.echo, holdFrames: 3.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
