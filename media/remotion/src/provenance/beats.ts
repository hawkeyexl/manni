import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// eleven commands in under 45 s, the longest 51 characters.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, from media/scratch-provenance
// (media/capture-provenance/latency.txt, plus three timing runs each on a copy):
// derive 682-708 ms, validate 692-757 ms, get 627-666 ms, git diff 43-46 ms,
// git commit 60-63 ms, sed 32 ms. Output never appears sooner than measured.
export const latency = {
  derive: Math.round(0.71 * FPS),
  validate: Math.round(0.76 * FPS),
  get: Math.round(0.67 * FPS),
  git: 2,
  sed: 1,
  echo: 1,
};

export const beats: Beat[] = [
  {
    title: "An agent wrote part of it",
    caption: "An agent just wrote these lines. Once they are committed, nothing records which were its.",
    highlight: ["+The limit", "+Bursts", "+A 429"],
    commands: [
      { typed: "git diff", output: captures["git diff"], latencyFrames: latency.git, holdFrames: 3.5 * FPS },
    ],
  },
  {
    title: "Stamp before committing",
    caption: "derive pins the uncommitted lines to claude-fable-5: a body range and a hash of their text.",
    highlight: ["provenance  lines 9-12", "- generated-by:", "lines: 6-9", "integrity:"],
    commands: [
      { typed: "MANNI_GENERATED_BY=claude-fable-5 manni meta derive", output: captures["derive uncommitted"], latencyFrames: latency.derive, holdFrames: 1.0 * FPS },
      { typed: "head -7 docs/limits.md", output: captures["head -7"], latencyFrames: latency.git, holdFrames: 2.6 * FPS },
      { typed: 'git commit -qam "docs: add the limits"', output: "", latencyFrames: latency.git, holdFrames: 0.5 * FPS },
    ],
  },
  {
    title: "A person edits one line",
    caption: "A person changes one line inside the agent's range, and commits it.",
    highlight: ["-Bursts of 20", "+Bursts of 50"],
    commands: [
      { typed: "sed -i 's/of 20/of 50/' docs/limits.md", output: "", latencyFrames: latency.sed, holdFrames: 0.2 * FPS },
      { typed: "git diff -U0", output: captures["git diff -U0"], latencyFrames: latency.git, holdFrames: 1.8 * FPS },
      { typed: 'git commit -qam "docs: raise the burst"', output: "", latencyFrames: latency.git, holdFrames: 0.6 * FPS },
    ],
  },
  {
    title: "validate: the pin broke",
    caption: "The pinned text changed since claude-fable-5 wrote it. validate names the range: exit 1.",
    highlight: ["/provenance"],
    commands: [
      { typed: "manni meta validate", output: captures["validate stale"], latencyFrames: latency.validate, holdFrames: 2.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.validate1}\n`, latencyFrames: latency.echo, holdFrames: 1.6 * FPS },
    ],
  },
  {
    title: "derive re-attributes",
    caption: "The agent keeps its untouched lines. The edited line is attributed to no machine. Exit 0.",
    highlight: ["provenance=lines"],
    commands: [
      { typed: "manni meta derive", output: captures["derive again"], latencyFrames: latency.derive, holdFrames: 0.5 * FPS },
      { typed: "manni meta get provenance docs/limits.md", output: captures["get provenance"], latencyFrames: latency.get, holdFrames: 2.0 * FPS },
      { typed: "manni meta validate", output: captures["validate clean"], latencyFrames: latency.validate, holdFrames: 0.4 * FPS },
      { typed: "echo $?", output: `${captures.exits.validate2}\n`, latencyFrames: latency.echo, holdFrames: 2.5 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
