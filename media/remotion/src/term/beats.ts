import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// seven commands and four beats in under 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in media/scratch-term
// (media/capture-term/latency.txt: the capture run plus three timing runs):
// term write -f vale 533-548 ms, vale 120-126 ms, term write -f markdown
// 481-512 ms. Output never appears sooner than measured.
export const latency = {
  writeVale: Math.round(0.55 * FPS),
  vale: Math.round(0.13 * FPS),
  writeMarkdown: Math.round(0.52 * FPS),
  sed: 2,
  cat: 2,
  echo: 1,
};

export const beats: Beat[] = [
  {
    title: "One glossary, one guide",
    caption: "The glossary defines progressive lens, its acronym and a retired name. The guide gets all three wrong.",
    highlight: ["alt-labels: [PAL]", "hidden-labels:", "about a PAL", "no-line bifocal hides", "Progressive Lens"],
    commands: [
      { typed: "cat glossary.yaml", output: captures["cat glossary"], latencyFrames: latency.cat, holdFrames: 1.4 * FPS },
      { typed: "cat docs/fitting.md", output: captures["cat guide"], latencyFrames: latency.cat, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "Glossary to Vale style",
    caption: "manni term write -f vale turns the terms into Vale rules, one per kind of mistake.",
    highlight: ["Lowercase.yml", "Deprecated.yml", "PAL.yml ", "first:", "second:"],
    commands: [
      { typed: "manni term write -f vale", output: captures["write vale"], latencyFrames: latency.writeVale, holdFrames: 2.4 * FPS },
      { typed: "cat styles/Terms/PAL.yml", output: captures["cat pal"], latencyFrames: latency.cat, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "Vale catches all three",
    caption: "Add Terms to .vale.ini as the notice says. Vale flags the acronym, the old name and the casing: exit 1.",
    highlight: ["Terms.PAL", "Terms.Deprecated", "Terms.Lowercase"],
    commands: [
      { typed: "sed -i 's/= Vale$/= Vale, Terms/' .vale.ini", output: "", latencyFrames: latency.sed, holdFrames: 0.3 * FPS },
      { typed: "vale docs/fitting.md", output: captures.vale, latencyFrames: latency.vale, holdFrames: 3.4 * FPS },
      { typed: "echo $?", output: `${captures.exits.vale}\n`, latencyFrames: latency.echo, holdFrames: 2.6 * FPS },
    ],
  },
  {
    title: "Same terms, new format",
    caption: "The same glossary, rendered as Markdown: one page per term, every field kept.",
    highlight: ["one file each", "  - PAL", "  - no-line bifocal"],
    commands: [
      { typed: "manni term write -f markdown -o docs/terms/", output: captures["write markdown"], latencyFrames: latency.writeMarkdown, holdFrames: 1.2 * FPS },
      { typed: "cat docs/terms/progressive-lens.md", output: captures["cat page"], latencyFrames: latency.cat, holdFrames: 4.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
