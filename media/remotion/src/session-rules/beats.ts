import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms).
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in media/scratch-session-rules/
// (media/session-rules/capture/latency.txt: the capture run plus three timing
// runs): tracevals check 401-427 ms cold, the JSON run piped to grep
// 378-393 ms. The replay uses about the median, so nothing is sped up.
export const latency = {
  check: Math.round(0.41 * FPS),
  sources: Math.round(0.38 * FPS),
  grep: 2,
  echo: 1,
};

const prompts = `grep human requests.jsonl | grep -o '"content":"[^"]*"'`;
const edits = `grep -o '"Edit","input":{"file_path":"[^"]*"' requests.jsonl`;
const done = `tail -1 requests.jsonl | grep -o '"text":"[^"]*"'`;
const sources = `manni tracevals check requests.jsonl --project . -f json | grep '"path"'`;

export const beats: Beat[] = [
  {
    title: "What you asked",
    caption: "Two prompts. The second: do not edit src/legacy.ts.",
    highlight: ["Do not edit"],
    commands: [
      { typed: prompts, output: captures.prompts, latencyFrames: latency.grep, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "The agent said it was done",
    caption: "It edited src/legacy.ts anyway, then said done.",
    continues: true,
    highlight: ['src/legacy.ts"', "Done."],
    commands: [
      { typed: edits, output: captures.edits, latencyFrames: latency.grep, holdFrames: 2.4 * FPS },
      { typed: done, output: captures.done, latencyFrames: latency.grep, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "Hold it to what it was asked",
    caption: "The broken request, under its source: prompt. Exit 1.",
    highlight: ["do-not-edit-src-legacy"],
    commands: [
      { typed: "manni tracevals check requests.jsonl --project .", output: captures.check, latencyFrames: latency.check, holdFrames: 5.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.check}\n`, latencyFrames: latency.echo, holdFrames: 2.2 * FPS },
    ],
  },
  {
    title: "Every source it was asked by",
    caption: "Prompts, the approved plan, and every spec it touched.",
    highlight: ['"prompt"', '"plan"', "specs/", "openspec/", "docs/plans/"],
    commands: [
      { typed: sources, output: captures.sources, latencyFrames: latency.sources, holdFrames: 6.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
