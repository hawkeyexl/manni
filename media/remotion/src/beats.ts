import captures from "./captures.json";

export const FPS = 30;

// Timing (design.md "Capture geometry": TypingSpeed 35–70 ms).
export const TYPING_MS = 45;
export const ENTER_PAUSE_FRAMES = 14; // finger on Enter, ~0.47 s
export const IDLE_START_FRAMES = 12; // a bare prompt before typing begins

// Measured wall-clock latency of the real commands on this machine, three runs
// each: validate 331–362 ms, query 297–313 ms. Output never appears sooner.
export const latency = {
  validate: Math.round((0.35 * FPS)),
  query: Math.round((0.30 * FPS)),
  cat: 2,
  echo: 2,
};

export interface Command {
  typed: string;
  output: string; // raw bytes, ANSI included
  latencyFrames: number;
  holdFrames: number; // time on screen after the output lands
}

export interface Beat {
  title: string;
  caption: string;
  /** Start from beat N's finished screen instead of a cleared one. */
  continues?: boolean;
  commands: Command[];
  /**
   * Substrings of a logical line's visible text. Rows of a line containing one
   * are drawn on a faint accent ground, so the caption's subject can be found
   * at phone size. Chrome only: the bytes are untouched.
   */
  highlight?: string[];
  /** Extra frames held after the last command; lets a continuing beat carry only a new caption. */
  pauseFrames?: number;
}

const q = `manni meta query "UPDATE docs SET jira = 'PLAT-1' WHERE _path = 'docs/auth.md'"`;

export const beats: Beat[] = [
  {
    title: "A public page",
    caption:
      "The public page carries a title and nothing else. Its ticket and source file must not ship with it.",
    commands: [
      { typed: "cat docs/auth.md", output: captures["cat docs/auth.md"], latencyFrames: latency.cat, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "The sidecar",
    caption:
      "A private manifest supplies source and jira per page. Two lines of config declare which keys it owns.",
    commands: [
      { typed: "cat docs-meta.yaml", output: captures["cat docs-meta.yaml"], latencyFrames: latency.cat, holdFrames: 2.8 * FPS },
      { typed: "cat manni.config.yaml", output: captures["cat manni.config.yaml"], latencyFrames: latency.cat, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "validate sees one object",
    caption:
      "auth passes on the merged values. billing's bad ticket is reported at docs-meta.yaml:6, not in the page.",
    commands: [
      { typed: "manni meta validate", output: captures["manni meta validate"], latencyFrames: latency.validate, holdFrames: 5.2 * FPS },
      { typed: "echo $?", output: "1\n", latencyFrames: latency.echo, holdFrames: 2.4 * FPS },
    ],
  },
  {
    title: "The page stays clean",
    caption: "query refuses to write a sidecar-owned key into the public file.",
    commands: [
      { typed: q, output: captures["manni meta query"], latencyFrames: latency.query, holdFrames: 4.0 * FPS },
    ],
  },
  {
    title: "Exit codes for CI",
    caption: "1 for findings, 2 for the refusal. Nothing private reaches the public repo.",
    continues: true,
    commands: [
      { typed: "echo $?", output: "2\n", latencyFrames: latency.echo, holdFrames: 4.6 * FPS },
    ],
  },
];

// ---- Timeline ---------------------------------------------------------------

export const typingFrames = (typed: string, typingMs = TYPING_MS) => Math.ceil((typed.length * typingMs * FPS) / 1000);

export interface CommandTimeline extends Command {
  /** Frame (relative to the beat) at which the first character appears. */
  typeStart: number;
  /** Frame at which Enter is pressed. */
  enterAt: number;
  /** Frame at which the output is on screen. */
  outputAt: number;
  /** Frame at which the next prompt appears (same as outputAt for the CLI). */
  end: number;
}

export function timeline(beat: Beat, typingMs = TYPING_MS): { commands: CommandTimeline[]; duration: number } {
  let t = beat.continues ? 4 : IDLE_START_FRAMES;
  const commands: CommandTimeline[] = beat.commands.map((c) => {
    const typeStart = t;
    const enterAt = typeStart + typingFrames(c.typed, typingMs) + ENTER_PAUSE_FRAMES;
    const outputAt = enterAt + c.latencyFrames;
    const end = outputAt + c.holdFrames;
    t = end;
    return { ...c, typeStart, enterAt, outputAt, end };
  });
  t += beat.pauseFrames ?? 0;
  return { commands, duration: Math.round(t) };
}

export const beatDurations = beats.map((b) => timeline(b).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
