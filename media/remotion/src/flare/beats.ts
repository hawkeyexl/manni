import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). The quick end of the range:
// nine commands, one of them a 129-character query, in under 45 s.
export const TYPING_MS = 35;

// Measured wall-clock latency on this machine, in C:\flare (the junction to
// media/scratch-flare-topics; media/capture-flare/latency.txt: the capture run
// plus three timing runs): get 307-368 ms, validate 379-427 ms, query 382-464 ms,
// build 747-913 ms, stats 617-651 ms. Each replay value sits inside its measured range.
export const latency = {
  get: Math.round(0.35 * FPS),
  validate: Math.round(0.45 * FPS),
  query: Math.round(0.42 * FPS),
  build: Math.round(0.78 * FPS),
  stats: Math.round(0.64 * FPS),
  shell: 2,
};

const q = `manni meta query "UPDATE docs SET description = 'How to set the widget''s options.' WHERE _path = 'Content/Topics/Configure.htm'"`;

export const beats: Beat[] = [
  {
    title: "A MadCap Flare topic",
    caption: "Flare writes an empty <title> as standard. Install.htm links to Configure.htm, misspelled Configur.htm.",
    highlight: ["<title></title>", 'href="Configur.htm"'],
    commands: [
      { typed: "grep -E '<title>|<h1>' Content/Topics/Configure.htm", output: captures["grep title"], latencyFrames: latency.shell, holdFrames: 1.0 * FPS },
      { typed: "grep xref Content/Topics/Install.htm", output: captures["grep xref"], latencyFrames: latency.shell, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "The title is the h1",
    caption: "The empty title reads as the h1, as Flare shows it. Only description fails: exit 1.",
    highlight: ["title=Configuring the widget", "must have required property"],
    commands: [
      { typed: "manni meta get title Content/Topics/Configure.htm", output: captures.get, latencyFrames: latency.get, holdFrames: 1.0 * FPS },
      { typed: "manni meta validate; echo $?", output: `${captures.validate}${captures.exits.validate}\n`, latencyFrames: latency.validate, holdFrames: 4.4 * FPS },
    ],
  },
  {
    title: "A write that closes its tags",
    caption: "query writes the description. The new <meta> closes itself, so the topic is still well-formed XML.",
    highlight: ['<meta name="description"'],
    commands: [
      { typed: q, output: captures.query, latencyFrames: latency.query, holdFrames: 1.0 * FPS },
      { typed: "git diff -U1", output: captures.diff, latencyFrames: latency.shell, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "The broken xref, found",
    caption: "graph reads MadCap:xref as a link. stats --check reports Configur.htm as broken and exits 1.",
    highlight: ["-> Configur.htm"],
    commands: [
      { typed: "manni graph build", output: captures.build, latencyFrames: latency.build, holdFrames: 0.8 * FPS },
      { typed: "manni graph stats --check > stats.txt; echo $?", output: `${captures.exits.stats}\n`, latencyFrames: latency.stats, holdFrames: 0.8 * FPS },
      { typed: 'grep -A1 "internal links" stats.txt', output: captures["grep stats"], latencyFrames: latency.shell, holdFrames: 3.8 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
