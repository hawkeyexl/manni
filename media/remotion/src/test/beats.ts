import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because three of the five typed lines are over 40 characters.
export const TYPING_MS = 38;

// Measured wall-clock latency, from media/capture-test/latency.txt:
//   fail     7.765 s
//   github   8.013 s
//   pass     7.802 s
// Almost all of it is Doc Detective starting up. Three 8 s waits would be
// more than half the video, so the replay shortens the wait between Enter and
// the output, **all three by the same factor, 1/4**. design.md allows
// compressing static wait only, and requires the real elapsed time on screen:
// bash's own `time` output is in frame, unedited, for every run. Typing and
// output are 1x.
const COMPRESS = 4;
export const latency = {
  fail: Math.round((7.765 / COMPRESS) * FPS), // 58 frames, 1.94 s
  github: Math.round((8.013 / COMPRESS) * FPS), // 60 frames, 2.00 s
  pass: Math.round((7.802 / COMPRESS) * FPS), // 59 frames, 1.95 s
  cat: 2,
  sed: 2,
  echo: 1,
};

const run = "time manni test run fail.md --no-progress";
const github = "time manni test run fail.md -f github --no-progress";

export const beats: Beat[] = [
  {
    title: "A page that tests itself",
    caption: "fail.md carries an inline Doc Detective test. Its step runs exit 1 and expects 0.",
    highlight: ['"exit 1"'],
    commands: [
      { typed: "cat fail.md", output: captures["cat fail.md"], latencyFrames: latency.cat, holdFrames: 4.6 * FPS },
    ],
  },
  {
    title: "Run the page",
    caption: "manni test run names the file, line 4 and Doc Detective's reason. Exit 1.",
    highlight: ["FAIL", "1 failed"],
    commands: [
      { typed: run, output: captures.fail, latencyFrames: latency.fail, holdFrames: 4.4 * FPS },
      { typed: "echo $?", output: `${captures.exits.fail}\n`, latencyFrames: latency.echo, holdFrames: 2.4 * FPS },
    ],
  },
  {
    title: "Annotations for CI",
    caption: "With -f github, the same failure is an annotation on fail.md, line 4.",
    highlight: ["::error"],
    commands: [
      { typed: github, output: captures.github, latencyFrames: latency.github, holdFrames: 4.4 * FPS },
    ],
  },
  {
    title: "Fix the page, rerun",
    caption: "Correct line 4 and rerun. One test passed, exit 0.",
    highlight: ["s/exit 1/exit 0/", "1 passed"],
    commands: [
      { typed: "sed -i 's/exit 1/exit 0/' fail.md", output: "", latencyFrames: latency.sed, holdFrames: 0.6 * FPS },
      { typed: run, output: captures.pass, latencyFrames: latency.pass, holdFrames: 3.0 * FPS },
      { typed: "echo $?", output: `${captures.exits.pass}\n`, latencyFrames: latency.echo, holdFrames: 3.2 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
