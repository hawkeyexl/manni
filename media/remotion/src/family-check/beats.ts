import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The fast end, because
// the fix in beat 4 is a 58-character sed line and the video has four beats.
export const TYPING_MS = 38;

// Measured wall-clock latency on this machine, in media/scratch-family-check/
// (media/family-check/capture/latency.txt: the capture run plus three timing
// runs): status 1159-1190 ms, check 1274-1314 ms, the hook run 1160-1193 ms.
// The replay uses the median of the four, so output never lands at the fast
// end of what was measured. Nothing is sped up.
export const latency = {
  status: Math.round(1.17 * FPS),
  check: Math.round(1.29 * FPS),
  hook: Math.round(1.18 * FPS),
  sed: 2,
  cat: 2,
  echo: 1,
};

const sed = "sed -i '2a description: Timeouts and retries.' docs/limits.md";

export const beats: Beat[] = [
  {
    title: "What this repo set up",
    caption: "manni status reads the config and the pages. Two checks are in play here.",
    highlight: ["in play"],
    commands: [
      { typed: "manni status", output: captures.status, latencyFrames: latency.status, holdFrames: 4.6 * FPS },
    ],
  },
  {
    title: "One command runs them",
    caption: "A page has no description, so exit 1. What was never set up is skipped.",
    highlight: ["must have required property 'description'", "skipped  "],
    commands: [
      { typed: "manni check", output: captures.check1, latencyFrames: latency.check, holdFrames: 4.4 * FPS },
      { typed: "echo $?", output: `${captures.exits.check1}\n`, latencyFrames: latency.echo, holdFrames: 2.0 * FPS },
    ],
  },
  {
    title: "The same check, as a hook",
    caption: "Claude Code sends this after an agent's edit. Exit 2 blocks the agent.",
    highlight: ["Fix them before you continue."],
    commands: [
      { typed: "cat hook-edit.json", output: captures["cat hook-edit.json"], latencyFrames: latency.cat, holdFrames: 1.4 * FPS },
      { typed: "manni check < hook-edit.json", output: captures.hook, latencyFrames: latency.hook, holdFrames: 4.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.hook}\n`, latencyFrames: latency.echo, holdFrames: 2.0 * FPS },
    ],
  },
  {
    title: "Fix the page, pass the gate",
    caption: "Add the field. Every check in play passes, exit 0.",
    highlight: ["0 failed"],
    commands: [
      { typed: sed, output: "", latencyFrames: latency.sed, holdFrames: 0.3 * FPS },
      { typed: "manni check", output: captures.check2, latencyFrames: latency.check, holdFrames: 2.8 * FPS },
      { typed: "echo $?", output: `${captures.exits.check2}\n`, latencyFrames: latency.echo, holdFrames: 3.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
