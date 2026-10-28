import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Typing speed for this video (design.md: 35-70 ms). Seven commands, two of them
// sed edits typed in full, in under 45 s.
export const TYPING_MS = 40;

// Measured wall-clock latency on this machine, in C:lare (the junction to
// media/scratch-flare-resources; media/capture-flare-resources/latency.txt: the
// capture run plus three timing runs): term check 408-449 ms, meta get 292-314 ms,
// term check after the edit 405-449 ms, meta validate 325-382 ms. Each replay
// value sits inside its measured range, at the low end. No wait is compressed.
export const latency = {
  term: Math.round(0.41 * FPS),
  get: Math.round(0.3 * FPS),
  undefined: Math.round(0.41 * FPS),
  validate: Math.round(0.33 * FPS),
  shell: 2,
};

const withExit = (out: string, code: string) => `${out}${code}\n`;

export const beats: Beat[] = [
  {
    title: "The glossary is a termbase",
    caption: "Each entry is a term. HTML5 drops the print-only one.",
    highlight: ["Glossary.flglo:15", "in 2 terms"],
    // 19 px / 91 columns for this beat alone: at the video's 20 px the notice's
    // "Name it in the concepts: of a page that uses it." row (89 characters)
    // orphans "it." (capture-flare-resources/cols.mjs).
    type: { fontPx: 19, linePx: 27, cols: 91 },
    commands: [
      { typed: "manni term check; echo $?", output: withExit(captures.term, captures.exits.term), latencyFrames: latency.term, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "Glossary markers are concepts",
    caption: "The topic's glossaryTerm marker is its concepts.",
    highlight: ['glossTerm="Glossary.Term0"', 'concepts=["Glossary.Term0"]'],
    commands: [
      { typed: "grep -no '<MadCap:glossaryTerm[^>]*>' Content/Topics/Install.htm", output: captures["grep marker"], latencyFrames: latency.shell, holdFrames: 1.2 * FPS },
      { typed: "manni meta get concepts Content/Topics/Install.htm", output: captures.get, latencyFrames: latency.get, holdFrames: 3.4 * FPS },
    ],
  },
  {
    title: "A missing entry fails",
    caption: "Term9 names no entry. Line 10 fails, exit 1.",
    highlight: ["Install.htm:10", "undefined-term"],
    commands: [
      { typed: "sed -i 's/Term0/Term9/' Content/Topics/Install.htm", output: "", latencyFrames: latency.shell, holdFrames: 0.6 * FPS },
      {
        typed: "manni term check | grep -A1 Install.htm; echo ${PIPESTATUS[0]}",
        output: withExit(captures.undefined, captures.exits.undefined),
        latencyFrames: latency.undefined,
        holdFrames: 3.6 * FPS,
      },
    ],
  },
  {
    title: "A meta tag set is a schema",
    caption: "Status takes only Draft, Reviewed or Published.",
    highlight: ["/Status", "Status: Where"],
    commands: [
      { typed: "sed -i 's/Reviewed/Reviewd/' Content/Topics/Install.htm", output: "", latencyFrames: latency.shell, holdFrames: 0.6 * FPS },
      {
        typed: "manni meta validate Content/Topics/Install.htm; echo $?",
        output: withExit(captures.validate, captures.exits.validate),
        latencyFrames: latency.validate,
        holdFrames: 4.4 * FPS,
      },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b, TYPING_MS).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
