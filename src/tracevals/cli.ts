/**
 * The tracevals program. Named `tracevals` because that is where it is
 * mounted (`manni tracevals …`); `src/cli.ts` adds it to the umbrella and
 * runs it. Thin commander wrapper; all behavior lives in commands.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { renderList, runList } from "./commands/list.js";
import { runFill } from "./commands/fill.js";
import { runRun } from "./commands/run.js";
import { TracevalsError } from "./types.js";
import type { ReportFormat } from "./reporters/index.js";

const { version } = pkg;

export function buildProgram(): Command {
const program = new Command();

program
  .name("tracevals")
  .description(
    "Deterministic and LLM-as-judge adherence evals for AI agent session traces.",
  )
  .version(version);

interface RunFlags {
  project?: string;
  provider?: string;
  model?: string;
  runs?: number;
  deterministicOnly?: boolean;
  cache?: boolean;
  maxCostUsd?: number;
  format?: string;
  output?: string;
  history?: boolean;
  failOnNeedsReview?: boolean;
  commands?: boolean;
  require?: string[];
  reportUnusedArtifacts?: boolean;
  manifest?: string;
  allProjects?: boolean;
  since?: string;
  limit?: number;
}

/** Repeatable option collector — commander keeps only the last value otherwise. */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

const range = (min: number, max: number): string =>
  Number.isFinite(max) ? `between ${min} and ${max}` : `of at least ${min}`;

/**
 * A numeric flag, checked before anything reads it.
 *
 * `parseFloat("abc")` is NaN, and every comparison against NaN is false — so a
 * flag that failed to parse does **not** fall back to the config. `undefined`
 * is what defers to the config, and NaN is not undefined: it survives the `??`
 * overlay and lands in the runtime as a limit that can never be reached. A
 * budget of NaN bills without a ceiling while the report still claims one,
 * which is the most expensive way for a safety limit to fail. Range checks
 * therefore test for a *finite* number, not only for the range.
 */
function numeric(
  name: string,
  value: number | undefined,
  min: number,
  max: number = Number.POSITIVE_INFINITY,
): void {
  if (value === undefined) return;
  if (Number.isFinite(value) && value >= min && value <= max) return;
  throw new TracevalsError(
    `${name} must be a number ${range(min, max)}, got ${value}`,
  );
}

/**
 * The same for a count. Kept apart from `numeric` because a fraction is never
 * meant here: `--limit 2.5` and `--limit -1` both reach `slice(0, n)`, where
 * the negative one silently evaluates every trace except the oldest.
 */
function whole(
  name: string,
  value: number | undefined,
  min: number,
  max: number = Number.POSITIVE_INFINITY,
): void {
  if (value === undefined) return;
  if (Number.isInteger(value) && value >= min && value <= max) return;
  throw new TracevalsError(
    `${name} must be a whole number ${range(min, max)}, got ${value}`,
  );
}

/**
 * The single mapping from `addRunFlags`' options onto the shared run options.
 *
 * `run` and `calibrate` accept the same flags, and `calibrate` used to
 * hand-copy the list — which is how it came to accept `--no-commands` and drop
 * it on the floor. `addRunFlags`' own docstring says an accepted flag that
 * quietly does nothing is worse than an absent one, so there is now one place
 * to add a flag rather than two places to remember.
 *
 * Validation lives here for the same reason: both commands get it, or neither.
 */
function sharedRunOptions(opts: RunFlags) {
  whole("--runs", opts.runs, 1);
  whole("--limit", opts.limit, 1);
  numeric("--max-cost-usd", opts.maxCostUsd, 0);

  return {
    project: opts.project,
    provider: opts.provider,
    model: opts.model,
    runs: opts.runs,
    deterministicOnly: opts.deterministicOnly,
    noCache: opts.cache === false,
    maxCostUsd: opts.maxCostUsd,
    format: (opts.format as ReportFormat | undefined) ?? "human",
    output: opts.output,
    // Undefined when neither spelling is passed, so the config still decides.
    // Both spellings are declared for precisely that reason: commander
    // defaults a lone `--no-x` to `true`, which makes the config's own value
    // unreachable from the command line.
    failOnNeedsReview: opts.failOnNeedsReview,
    commands: opts.commands,
    reportUnusedArtifacts: opts.reportUnusedArtifacts,
    ...(opts.require !== undefined ? { require: opts.require } : {}),
    ...(opts.allProjects !== undefined ? { allProjects: opts.allProjects } : {}),
    ...(opts.since !== undefined ? { since: opts.since } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  };
}

async function executeRun(traces: string[], opts: RunFlags) {
  const shared = {
    ...sharedRunOptions(opts),
    // Run-only, both of them: `--history` is a point in one session's
    // timeline, and a manifest belongs to exactly one session (ADR 01024).
    history: opts.history,
    ...(opts.manifest !== undefined ? { manifest: opts.manifest } : {}),
  };

  // What decides the report shape is *how traces were selected*, not how many
  // came back. One named trace is a `RunReport`, byte for byte as before; a
  // discovery selector is a `BatchReport` even when it matches exactly one, so
  // a script piping `--format json` gets a stable shape (ADR 01018).
  const selecting =
    opts.allProjects === true ||
    opts.since !== undefined ||
    opts.limit !== undefined;

  if (traces.length > 1 || selecting) {
    if (opts.manifest !== undefined) {
      // Each trace finds its own manifest by convention; one named file cannot
      // be evidence about more than the session it was captured for.
      throw new TracevalsError(
        "--manifest names one session's manifest, so it cannot be used with a corpus; drop it and each trace will find its own",
      );
    }
    const { runBatch } = await import("./commands/batch.js");
    const { report, rendered } = await runBatch({
      ...shared,
      ...(traces.length > 0 ? { traces } : {}),
    });
    console.log(rendered);
    process.exitCode = report.exitCode;
    return;
  }

  let trace = traces[0];
  if (trace === undefined) {
    // The interactive picker needs a TTY; scripted callers must name a trace.
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      throw new TracevalsError(
        "no trace given; pass a trace file or run `manni tracevals list`",
      );
    }
    const { pickTrace } = await import("./trace/picker.js");
    trace = await pickTrace();
  }
  const { report, rendered } = await runRun({ ...shared, tracePath: trace });
  console.log(rendered);
  process.exitCode = report.exitCode;
}

/**
 * Flags shared by `run` and `calibrate`. `--history` is run-only: calibration
 * is a measurement of a corpus, not a point in one session's timeline, and an
 * accepted flag that quietly does nothing is worse than an absent one.
 */
function addRunFlags(cmd: Command, options: { history?: boolean } = {}): Command {
  const withHistory = options.history !== false;
  const base = cmd
    .option(
      "--project <dir>",
      "artifact-lookup root (overrides the trace's recorded cwd)",
    )
    .option("--provider <name>", "judge provider: claude-cli, anthropic, openai, mock")
    .option("--model <model>", "judge model override")
    // `Number`, not `parseInt`: parseInt truncates, so `--runs 1.5` would be
    // silently accepted as 1 and `--runs 1e3` as 1. `whole()` below refuses
    // what Number keeps.
    .option("--runs <n>", "ensemble runs per eval", (v) => Number(v))
    .option("--deterministic-only", "skip LLM-judged evals")
    .option("--no-cache", "bypass the judge cache")
    .option("--max-cost-usd <usd>", "judge cost budget", (v) => parseFloat(v))
    .option("-f, --format <format>", "human | json | markdown", "human")
    .option("-o, --output <file>", "also write the report to a file")
    .option(
      "--report-unused-artifacts",
      "list every skill and agent the session was offered and never used",
    )
    .option("--fail-on-needs-review", "treat needs-review as a failure")
    .option("--no-fail-on-needs-review", "do not fail the run on needs-review")
    // Declared as a pair. A lone `--no-commands` makes commander default
    // `opts.commands` to `true`, and the `??` overlay in `prepareRun` then
    // never sees `undefined` — which left `graders.command.enabled: false`
    // unreachable from the CLI and ADR 01011's opt-out dead (see
    // `--fail-on-needs-review`, which has had the pair from the start).
    .option("--commands", "execute command-graded evals (the default)")
    .option(
      "--no-commands",
      "do not execute command-graded evals; they report skipped",
    )
    .option(
      "--require <module>",
      "load a grader plugin; repeatable, and added to config plugins",
      collect,
    )
    .option("--all-projects", "evaluate every project's traces in the session store")
    .option("--since <duration>", "only traces newer than e.g. 30m, 24h, 7d, 2w")
    .option("--limit <n>", "maximum traces to evaluate", (v) => Number(v));
  return withHistory
    ? base.option(
        "--history",
        "append to history and compare with the previous run",
      )
    : base;
}

addRunFlags(
  program
    .command("run [traces...]", { isDefault: true })
    .description(
      "Evaluate one or more traces against the skills and instructions they used",
    ),
)
  // Run-only, and single-trace-only: a manifest belongs to exactly one session
  // (ADR 01024). A corpus still picks one up per trace by convention — this
  // flag is for naming one outright, which only a single trace can mean.
  .option(
    "--manifest <file>",
    "session manifest to compare artifacts against; without it one is looked for beside the trace and under the project",
  )
  .action(executeRun);

// `calibrate` shares `run`'s flags because it *is* a run — plus the labels it
// is measured against. Kept a separate command rather than a flag on `run`:
// the report answers a different question and carries a different shape, and
// a script must be able to tell which it is asking for (ADR 01022).
addRunFlags(
  program
    .command("calibrate [traces...]")
    .description(
      "Measure judged and graded verdicts against a labels file: false passes, false fails, and review volume",
    )
    .option(
      "--labels <file>",
      "calibration labels sidecar (default: calibrate.labels)",
    )
    .option(
      "--sweep",
      "re-score the corpus across the configured grid of zones and ensemble sizes, from cached verdicts",
    )
    .option("--max-false-pass <n>", "exit 1 above this many false passes", (v) =>
      Number(v),
    )
    .option("--max-false-fail <n>", "exit 1 above this many false fails", (v) =>
      Number(v),
    )
    .option(
      "--max-review <n>",
      "exit 1 above this many needs-review outcomes",
      (v) => Number(v),
    ),
  { history: false },
).action(
  async (
    traces: string[],
    opts: RunFlags & {
      labels?: string;
      sweep?: boolean;
      maxFalsePass?: number;
      maxFalseFail?: number;
      maxReview?: number;
    },
  ) => {
    const shared = sharedRunOptions(opts);
    // A threshold that never trips looks exactly like a threshold that held.
    whole("--max-false-pass", opts.maxFalsePass, 0);
    whole("--max-false-fail", opts.maxFalseFail, 0);
    whole("--max-review", opts.maxReview, 0);

    const { runCalibrate } = await import("./commands/calibrate.js");
    const { report, rendered } = await runCalibrate({
      ...shared,
      ...(traces.length > 0 ? { traces } : {}),
      ...(opts.labels !== undefined ? { labels: opts.labels } : {}),
      ...(opts.sweep !== undefined ? { sweep: opts.sweep } : {}),
      ...(opts.maxFalsePass !== undefined
        ? { maxFalsePass: opts.maxFalsePass }
        : {}),
      ...(opts.maxFalseFail !== undefined
        ? { maxFalseFail: opts.maxFalseFail }
        : {}),
      ...(opts.maxReview !== undefined ? { maxReview: opts.maxReview } : {}),
    });
    console.log(rendered);
    process.exitCode = report.exitCode;
  },
);

program
  .command("fill [paths...]")
  .description(
    "Propose evals for skills, agent definitions, and project rules, and write those above the confidence threshold",
  )
  .option("--project <dir>", "project root to scan (default: current directory)")
  .option("--dry-run", "report proposals without writing them")
  .option(
    "--confidence <n>",
    "minimum confidence to write (0-1)",
    (v) => parseFloat(v),
  )
  .option(
    "--max-evals <n>",
    "maximum evals per artifact, including existing ones",
    (v) => Number(v),
  )
  .option("--max-cost-usd <usd>", "proposal cost budget", (v) => parseFloat(v))
  .option("--no-cache", "bypass the proposal cache")
  .option("--provider <name>", "provider: claude-cli, anthropic, openai, mock")
  .option("--model <model>", "model override")
  .option(
    "--require <module>",
    "load a grader plugin; repeatable, and added to config plugins",
    collect,
  )
  .option("-f, --format <format>", "human | json", "human")
  .action(async (paths: string[], opts: {
    project?: string;
    dryRun?: boolean;
    confidence?: number;
    maxEvals?: number;
    maxCostUsd?: number;
    cache?: boolean;
    provider?: string;
    model?: string;
    require?: string[];
    format?: string;
  }) => {
    numeric("--confidence", opts.confidence, 0, 1);
    whole("--max-evals", opts.maxEvals, 1);
    numeric("--max-cost-usd", opts.maxCostUsd, 0);

    const { report, rendered } = await runFill({
      ...(paths.length > 0 ? { paths } : {}),
      ...(opts.project !== undefined ? { project: opts.project } : {}),
      ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
      ...(opts.confidence !== undefined ? { confidence: opts.confidence } : {}),
      ...(opts.maxEvals !== undefined ? { maxEvals: opts.maxEvals } : {}),
      ...(opts.maxCostUsd !== undefined ? { maxCostUsd: opts.maxCostUsd } : {}),
      ...(opts.cache === false ? { noCache: true } : {}),
      ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.require !== undefined ? { require: opts.require } : {}),
    });
    console.log(
      opts.format === "json" ? JSON.stringify(report, null, 2) : rendered,
    );
    process.exitCode = report.exitCode;
  });

// The one write path `run` never takes (ADR 01024). Meant for a `SessionStart`
// hook, which is why it reads its payload on stdin and — in that mode — writes
// its report to stderr: a SessionStart hook's stdout becomes model context.
program
  .command("capture")
  .description(
    "Record a session manifest: sha256 of every instruction artifact plus the git SHA, read from a Claude Code hook payload on stdin",
  )
  .option("--project <dir>", "project root to scan (default: the payload's cwd)")
  .option("--session-id <id>", "session id (default: the payload's session_id)")
  .option("-o, --out <file>", "write here instead of the configured directory")
  .option("-f, --format <format>", "human | json", "human")
  .action(async (opts: {
    project?: string;
    sessionId?: string;
    out?: string;
    format?: string;
  }) => {
    const { runCapture } = await import("./commands/capture.js");
    const result = await runCapture({
      version,
      ...(opts.project !== undefined ? { project: opts.project } : {}),
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
      ...(opts.out !== undefined ? { out: opts.out } : {}),
      format: opts.format === "json" ? "json" : "human",
    });
    if (result.stdout !== "") console.log(result.stdout);
    if (result.stderr !== "") console.error(result.stderr);
    process.exitCode = result.exitCode;
  });

program
  .command("list")
  .description("List discoverable traces (Claude Code session files)")
  .option(
    "-p, --project <dir>",
    "project directory to scope to (default: current directory)",
  )
  .option("-a, --all-projects", "scan every project in the session store")
  .option("-l, --limit <n>", "maximum traces to list", (v) => Number(v))
  .option("--json", "emit JSON instead of a table")
  .action(async (opts: {
    project?: string;
    allProjects?: boolean;
    limit?: number;
    json?: boolean;
  }) => {
    // The same footgun as `run --limit`: `slice(0, -1)` lists everything but
    // the oldest, and reads as a shorter store rather than as a bad flag.
    whole("--limit", opts.limit, 1);
    const run = await runList({
      project: opts.project,
      allProjects: opts.allProjects,
      limit: opts.limit,
    });
    if (opts.json) {
      console.log(JSON.stringify(run, null, 2));
    } else {
      console.log(renderList(run));
    }
  });

return program;
}
