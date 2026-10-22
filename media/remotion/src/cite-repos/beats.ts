import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because beat 1 types two 57-character commands.
export const TYPING_MS = 38;

// Measured wall-clock latency, from media/capture-repos/latency.txt.
// Replayed at 1x: every run is under 1 s, so nothing is compressed.
//   b1-api    518 ms
//   b1-sdk    546 ms
//   b3-check  517 ms
//   b4-log     53 ms (git)
//   b5-check  768 ms
export const latency = {
  b1api: Math.round(0.518 * FPS),
  b1sdk: Math.round(0.546 * FPS),
  b3: Math.round(0.517 * FPS),
  git: Math.round(0.053 * FPS),
  b5: Math.round(0.768 * FPS),
  cat: 2,
};

// Each check is typed with `; echo $?`, so its exit code prints under the summary.
const check = "manni cite check pages/limits.md";
const withExit = (output: string, exit: string) => `${output}${exit}\n`;

export const beats: Beat[] = [
  {
    title: "One root per run",
    caption: "The page cites api and sdk. Either --root fails the other pin, exit 1.",
    highlight: [":2 missing"],
    commands: [
      {
        typed: `${check} --root ../api; echo $?`,
        output: withExit(captures.b1api, captures.exits.b1api),
        latencyFrames: latency.b1api,
        holdFrames: 3.4 * FPS,
      },
      {
        typed: `${check} --root ../sdk; echo $?`,
        output: withExit(captures.b1sdk, captures.exits.b1sdk),
        latencyFrames: latency.b1sdk,
        holdFrames: 4.6 * FPS,
      },
    ],
  },
  {
    title: "Name each checkout",
    caption: "One key in manni.config.yaml. cite.repos names each checkout.",
    highlight: ["api: ../api", "sdk: ../sdk"],
    commands: [{ typed: "cat manni.config.yaml", output: captures.config, latencyFrames: latency.cat, holdFrames: 3.6 * FPS }],
  },
  {
    title: "One run, both pins",
    caption: "Each pin resolves in its own checkout, printed as api: and sdk:. Exit 0.",
    highlight: ["api:lib/limits.ts:2", "sdk:src/client.ts:2"],
    commands: [
      { typed: `${check}; echo $?`, output: withExit(captures.b3, captures.exits.b3), latencyFrames: latency.b3, holdFrames: 4.6 * FPS },
    ],
  },
  {
    title: "The SDK changes",
    caption: "A commit in sdk moves the pinned line from 3 attempts to 5.",
    highlight: ["attempts"],
    commands: [
      { typed: "git -C ../sdk log -1 -p --oneline -U0", output: captures.b4, latencyFrames: latency.git, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "The stale sentence",
    caption: "Only retries reports, in sdk, with the commit it changed since. Exit 1.",
    highlight: ["changed since", "Check the sentence"],
    commands: [
      { typed: `${check}; echo $?`, output: withExit(captures.b5, captures.exits.b5), latencyFrames: latency.b5, holdFrames: 6.4 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
