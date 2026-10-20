import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Near the quick end,
// because the 4.13.0 command is 95 characters.
export const TYPING_MS = 38;

// Measured wall-clock latency, from media/capture-findings/latency.txt.
// Replayed at 1x: every run is under 1.5 s, so nothing is compressed.
//   before  1403 ms (npx resolving the locally installed 4.13.0, then the run)
//   after    338 ms
//   show     286 ms
//   cite     399 ms
export const latency = {
  before: Math.round(1.403 * FPS),
  after: Math.round(0.338 * FPS),
  show: Math.round(0.286 * FPS),
  cite: Math.round(0.399 * FPS),
  cat: 2,
  echo: 1,
};

const args = "meta validate dcmi-bad-date.md -s dcmi:elements:1.1 --no-config";

export const beats: Beat[] = [
  {
    title: "Before, in 4.13.0",
    caption: "June 5th is not a date. 4.13.0 shows a pattern and a wrapper line.",
    highlight: ['"else" schema'],
    commands: [
      { typed: "cat dcmi-bad-date.md", output: captures["cat dcmi-bad-date.md"], latencyFrames: latency.cat, holdFrames: 1.4 * FPS },
      { typed: `npx -y @hawkeyexl/manni@4.13.0 ${args}`, output: captures.before, latencyFrames: latency.before, holdFrames: 4.4 * FPS },
    ],
  },
  {
    title: "Now it says what to do",
    caption: "One finding. It names the rule, says what date is for and links a guide.",
    highlight: ["dcmi:elements:1.1 date:", "Guide:"],
    commands: [
      { typed: `manni ${args}`, output: captures.after, latencyFrames: latency.after, holdFrames: 5.6 * FPS },
      { typed: "echo $?", output: `${captures.exits.after}\n`, latencyFrames: latency.echo, holdFrames: 1.8 * FPS },
    ],
  },
  {
    title: "Start from a skeleton",
    caption: "schemas show -f markdown prints frontmatter to start from, every key explained.",
    highlight: ["# Guide:", "title:", "description:"],
    commands: [
      { typed: "manni meta schemas show manni:core:1.0.0 -f markdown", output: captures.show, latencyFrames: latency.show, holdFrames: 5.0 * FPS },
    ],
  },
  {
    title: "Across the family",
    caption: "cite names its rule too, and the command to run once you have checked.",
    highlight: ["Check the sentence", "source-changed:", "Guide:"],
    commands: [
      { typed: "manni cite check pages/source-changed.md", output: captures.cite, latencyFrames: latency.cite, holdFrames: 6.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
