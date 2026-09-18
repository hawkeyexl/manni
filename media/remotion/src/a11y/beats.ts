import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because two of the four typed lines are long.
export const TYPING_MS = 40;

// Measured wall-clock latency, from media/capture-a11y/latency.txt:
//   full      1m46.641s   (101 pages, real browser, cold)
//   excluded  1m7.458s    (67 pages, real browser, cold)
//   seed-clash    532ms   (refused before anything was fetched)
//
// The two crawls are far longer than the whole video, so the replay shortens
// the wait between Enter and the output. It shortens **both by the same factor,
// 1/53.3**, so the replay's own rhythm keeps the ratio the real runs had: the
// excluded crawl waits 0.63 of the time the full one does, exactly as it did on
// the machine. design.md allows compressing static wait only, and requires the
// real elapsed time on screen. bash's own `time` output is in frame, unedited,
// for both runs. Nothing else is scaled: typing and output are 1x.
//
// The refusal is not scaled. Half a second is already shorter than the pause
// before Enter, and its speed is part of what the beat says.
const COMPRESS = 53.3;
export const latency = {
  full: Math.round((106.641 / COMPRESS) * FPS), // 60 frames, 2.00 s
  excluded: Math.round((67.458 / COMPRESS) * FPS), // 38 frames, 1.27 s
  seedClash: Math.round(0.532 * FPS), // 16 frames, 1x
  echo: 1,
};

const full = "time manni a11y check -q --no-progress";
const excluded = `${full} --exclude "/manni/meta/reference/**"`;
const clash =
  'manni a11y check http://127.0.0.1:4321/manni/meta/reference/ --exclude "/manni/meta/reference/**"';

export const beats: Beat[] = [
  {
    title: "Every page, every time",
    caption:
      "manni a11y check crawls every page the site links to. 101 pages, 1 minute 47, every pull request.",
    highlight: ["0 violations on 0 of 101 pages", "1m46.641s"],
    commands: [
      { typed: full, output: captures.full, latencyFrames: latency.full, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "One glob, one section",
    caption:
      "--exclude takes a glob matched against the URL path. Here it drops the reference shelf.",
    continues: true,
    highlight: ["--exclude", "Checked 67 of 67 pages"],
    commands: [
      { typed: excluded, output: captures.excluded, latencyFrames: latency.excluded, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "34 pages never fetched",
    caption:
      "67 pages checked, 34 excluded, 39 seconds saved. An excluded URL is never fetched and never counted.",
    continues: true,
    highlight: ["0 of 67 pages; 34 excluded", "1m7.458s"],
    commands: [],
    pauseFrames: 4.3 * FPS,
  },
  {
    title: "Seed and pattern disagree",
    caption:
      "A seed the pattern excludes is a contradiction. manni refuses with exit 2, before anything loads.",
    highlight: ["excludes the seed"],
    commands: [
      { typed: clash, output: captures["seed-clash"], latencyFrames: latency.seedClash, holdFrames: 2.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.seedClash}\n`, latencyFrames: latency.echo, holdFrames: 3.4 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
