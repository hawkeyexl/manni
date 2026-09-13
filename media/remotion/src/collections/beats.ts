import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

/**
 * Measured wall-clock latency of the real commands on this machine
 * (media/scratch-collections, same shell). Output never appears sooner.
 *
 *   meta validate (refused by the moved key)  543 / 568 / 569 ms
 *   meta validate (the collection)            613 / 597 / 608 ms
 *   a11y check --collection guides            2564 / 1620 / 1588 / 2531 ms
 *
 * The a11y figure is bimodal: a cold Chromium launch costs about a second more
 * than a warm one. 2.0 s is the middle of the four measured runs, and the range
 * is disclosed in media/collections-1x1.script.md rather than trimmed away.
 */
export const latency = {
  refused: Math.round(0.55 * FPS),
  validate: Math.round(0.61 * FPS),
  a11y: Math.round(2.0 * FPS),
  cat: 2,
  echo: 2,
};

const a11yCmd = "manni a11y check --collection guides --no-progress";

export const beats: Beat[] = [
  {
    title: "One set, named twice",
    caption:
      "One document set, spelled twice: a glob under meta:, a URL under a11y:. Move the docs and one goes stale.",
    highlight: ['- "guides/**/*.md"', "- http://127.0.0.1:4321/"],
    commands: [
      {
        typed: "cat manni.config.yaml",
        output: captures["cat manni.config.yaml (old)"],
        latencyFrames: latency.cat,
        holdFrames: 3.6 * FPS,
      },
    ],
  },
  {
    title: "0.3.0 refuses it",
    caption:
      "Exit 2, and the message names where the key went: a top-level collections: list.",
    continues: true,
    highlight: ["is no longer a meta key"],
    commands: [
      {
        typed: "manni meta validate",
        output: captures["manni meta validate (refused)"],
        latencyFrames: latency.refused,
        holdFrames: 4.4 * FPS,
      },
      { typed: "echo $?", output: "2\n", latencyFrames: latency.echo, holdFrames: 2.2 * FPS },
    ],
  },
  {
    title: "Declared once",
    caption:
      "One collection: the paths, and the url those pages are published at. No tool owns it.",
    highlight: ["collections:", "url: http://127.0.0.1:4321/"],
    commands: [
      {
        typed: "cat manni.config.yaml",
        output: captures["cat manni.config.yaml (new)"],
        latencyFrames: latency.cat,
        holdFrames: 4.8 * FPS,
      },
    ],
  },
  {
    title: "meta reads it",
    caption:
      "A bare validate checks the collection's files. Nothing typed on the command line.",
    highlight: ["guides/auth.md", "guides/install.md"],
    commands: [
      {
        typed: "manni meta validate",
        output: captures["manni meta validate"],
        latencyFrames: latency.validate,
        holdFrames: 3.4 * FPS,
      },
    ],
  },
  {
    title: "a11y reads it too",
    caption:
      "--collection guides seeds the crawl from that same url:. No URL typed, no second key.",
    continues: true,
    highlight: ["127.0.0.1:4321/"],
    commands: [
      {
        typed: a11yCmd,
        output: captures["manni a11y check --collection guides"],
        latencyFrames: latency.a11y,
        holdFrames: 5.6 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
