import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms).
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in media/scratch-system-prompt/
// (media/system-prompt/capture/latency.txt: the capture run plus three timing
// runs): the default-prompt check 396-412 ms cold, the custom one 382-405 ms
// after it. The replay uses about the median, so nothing is sped up.
export const latency = {
  check: Math.round(0.4 * FPS),
  grep: 2,
  echo: 1,
};

const prompt = `grep -o '"systemPrompt":[^]]*' system-prompt.jsonl | head -1`;
const done = `tail -1 system-prompt.jsonl | grep -o '"text":"[^"]*"'`;
const custom = `grep -o '"systemPrompt":[^]]*' system-prompt-custom.jsonl | head -1`;

export const beats: Beat[] = [
  {
    title: "The prompt it ran under",
    caption: "It bans an unshown Tests pass. The agent claims one.",
    highlight: ["Never say", '"text":"Tests pass'],
    commands: [
      { typed: prompt, output: captures.prompt, latencyFrames: latency.grep, holdFrames: 3.0 * FPS },
      { typed: done, output: captures.done, latencyFrames: latency.grep, holdFrames: 3.0 * FPS },
    ],
  },
  {
    title: "Claude Code's default prompt",
    caption: "Its break is reported with !, not blocked. Exit 0.",
    highlight: ["never-say-tests-pass-without", "None broken"],
    commands: [
      { typed: "manni tracevals check system-prompt.jsonl --project .", output: captures.default, latencyFrames: latency.check, holdFrames: 5.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.default}\n`, latencyFrames: latency.echo, holdFrames: 2.4 * FPS },
    ],
  },
  {
    title: "A prompt you wrote",
    caption: "No default marker. Its break blocks with ✖. Exit 1.",
    highlight: ["never-say-tests-pass-without", "1 broken"],
    commands: [
      { typed: custom, output: captures.custom, latencyFrames: latency.grep, holdFrames: 2.2 * FPS },
      { typed: "manni tracevals check system-prompt-custom.jsonl --project .", output: captures.customCheck, latencyFrames: latency.check, holdFrames: 5.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.custom}\n`, latencyFrames: latency.echo, holdFrames: 2.6 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
