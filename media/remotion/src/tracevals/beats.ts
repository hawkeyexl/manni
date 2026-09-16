import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Two of the three typed
// lines are 56 characters, so the fast end of the range keeps the whole thing
// inside 40 s without touching a hold.
export const TYPING_MS = 38;

// Measured wall-clock latency on this machine, in ~/demo
// (media/capture-tracevals/latency.txt: the capture run plus three timing
// runs): session-1 701-731 ms, session-2 705-730 ms. Output never appears
// sooner than measured.
export const latency = {
  run: Math.round(0.72 * FPS),
  cat: 2,
  echo: 1,
};

export const beats: Beat[] = [
  {
    title: "The rules, and the checks",
    caption:
      "CLAUDE.md states two house rules. It now carries the evals that encode them.",
    highlight: [
      "- Source edits go through the fix-bug skill.",
      "id: source-edits-use-the-skill",
    ],
    commands: [
      {
        typed: "cat CLAUDE.md",
        output: captures["cat CLAUDE.md"],
        latencyFrames: latency.cat,
        holdFrames: 6.6 * FPS,
      },
    ],
  },
  {
    title: "Grade a real session",
    // No hyphenated word may land on a caption line break: the band wraps at
    // the hyphen, and "fix-" / "bug skill." reads as a typo (design.md check 2).
    caption:
      "It read before editing. It edited src/ without the skill. One eval fails, exit 1.",
    highlight: [
      "FAIL",
      "skill fix-bug was never invoked",
    ],
    commands: [
      {
        typed: "manni tracevals run session-1.jsonl --deterministic-only",
        output: captures["run session-1"],
        latencyFrames: latency.run,
        holdFrames: 5.8 * FPS,
      },
      {
        typed: "echo $?",
        output: `${captures.exits.run1}\n`,
        latencyFrames: latency.echo,
        holdFrames: 2.6 * FPS,
      },
    ],
  },
  {
    title: "The next session",
    caption:
      "Same rules, same gate. This session used the skill: both evals pass, exit 0.",
    highlight: ["PASS", "2 pass"],
    commands: [
      {
        typed: "manni tracevals run session-2.jsonl --deterministic-only",
        output: captures["run session-2"],
        latencyFrames: latency.run,
        holdFrames: 5.6 * FPS,
      },
      {
        typed: "echo $?",
        output: `${captures.exits.run2}\n`,
        latencyFrames: latency.echo,
        holdFrames: 3.0 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
