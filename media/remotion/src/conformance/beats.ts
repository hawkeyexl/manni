import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms).
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in media/scratch-conformance/
// (media/conformance/capture/latency.txt: the capture run plus three timing
// runs): tracevals check 2136-3137 ms cold, the Stop hook 2151-3152 ms. The
// replay uses the median of the four, so nothing is sped up.
export const latency = {
  check: Math.round(2.54 * FPS),
  hook: Math.round(2.53 * FPS),
  cat: 2,
  grep: 2,
  echo: 1,
};

const grep = `grep -o '"command": "[^"]*"' breaks.jsonl`;

export const beats: Beat[] = [
  {
    title: "The rule it ran under",
    caption: "This agent's CLAUDE.md: never git push --force.",
    highlight: ["Never run `git push --force`."],
    commands: [
      { typed: "cat CLAUDE.md", output: captures["cat CLAUDE.md"], latencyFrames: latency.cat, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "What the agent did",
    caption: "Its last turn ran npm test, then git push --force.",
    continues: true,
    highlight: ["git push --force origin main"],
    commands: [
      { typed: grep, output: captures.grep, latencyFrames: latency.grep, holdFrames: 3.2 * FPS },
    ],
  },
  {
    title: "Judge the turn",
    caption: "Each broken rule, under its file. Exit 1.",
    highlight: ["no-force-push", "never-use-innerhtml-in-components"],
    commands: [
      { typed: "manni tracevals check breaks.jsonl --project .", output: captures.check, latencyFrames: latency.check, holdFrames: 5.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.check}\n`, latencyFrames: latency.echo, holdFrames: 2.2 * FPS },
    ],
  },
  {
    title: "The Stop hook blocks once",
    caption: "As a Stop hook, it sends the agent back to fix it.",
    highlight: ['"decision":"block"'],
    commands: [
      { typed: "cat stop.json", output: captures["cat stop.json"], latencyFrames: latency.cat, holdFrames: 1.6 * FPS },
      { typed: "manni check < stop.json", output: captures.hook, latencyFrames: latency.hook, holdFrames: 6.5 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
