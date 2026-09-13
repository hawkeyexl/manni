import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Slightly quicker than the
// earlier two because the query command is 87 characters long.
export const TYPING_MS = 40;

// Measured wall-clock latency of the real commands on this machine, three runs
// each, from media/scratch-join: validate 593-614 ms, query 585-605 ms.
// Output never appears sooner than the slowest run.
export const latency = {
  validate: Math.round(0.61 * FPS),
  query: Math.round(0.61 * FPS),
  cat: 2,
  mv: 2,
  echo: 2,
};

const mv = "mkdir -p docs/guides && mv docs/auth.md docs/guides/authentication.md";
const q = `manni meta query "UPDATE docs SET id = 'other' WHERE _path = 'docs/guides/authentication.md'"`;

export const beats: Beat[] = [
  {
    title: "join: id",
    caption: "The manifest names pages by their id field, not their path. join: id says which field.",
    highlight: ["join: id", "auth-guide:", "billing-guide:", "shared:"],
    commands: [
      { typed: "cat manni.config.yaml", output: captures["cat manni.config.yaml"], latencyFrames: latency.cat, holdFrames: 2.4 * FPS },
      { typed: "cat docs-meta.yaml", output: captures["cat docs-meta.yaml"], latencyFrames: latency.cat, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "Rename the page",
    caption: "The page moved; its entry did not. The values arrive by id, and the new path passes.",
    highlight: ["✓ docs/guides/authentication.md"],
    commands: [
      { typed: mv, output: "", latencyFrames: latency.mv, holdFrames: 0.7 * FPS },
      { typed: "manni meta validate", output: captures["manni meta validate"], latencyFrames: latency.validate, holdFrames: 4.0 * FPS },
      { typed: "echo $?", output: "1\n", latencyFrames: latency.echo, holdFrames: 1.2 * FPS },
    ],
  },
  {
    title: "One id, two pages",
    caption: "dup-a and dup-b both say id: shared. That is a finding on both, and each names the other.",
    highlight: ["docs/dup-a.md", "docs/dup-b.md"],
    continues: true,
    commands: [],
    pauseFrames: 4.8 * FPS,
  },
  {
    title: "The id is the join",
    caption: "query refuses to change the id of a page the manifest matched. Change the manifest first.",
    highlight: ["manni: "],
    commands: [
      { typed: q, output: captures["manni meta query"], latencyFrames: latency.query, holdFrames: 3.8 * FPS },
    ],
  },
  {
    title: "Exit codes for CI",
    caption: "1 for findings. 2 for the refusal. A rename is neither: nothing to edit, nothing orphaned.",
    continues: true,
    commands: [
      { typed: "echo $?", output: "2\n", latencyFrames: latency.echo, holdFrames: 3.8 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
