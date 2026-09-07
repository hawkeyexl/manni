/**
 * The a11y tool's CLI. A thin commander wrapper over `runCheck`, following
 * clig.dev the way meta's does: primary output to stdout, diagnostics to
 * stderr, color only on a TTY (never under NO_COLOR/--no-color), and the
 * exit codes 0 ok, 1 findings, 2 operational/usage.
 *
 * Every flag is validated here and turned into an `A11yError` before the
 * browser is asked to launch, so a typo costs a message and not a launch.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { shouldColor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { CHECK_DEFAULTS, runCheck } from "./commands/check.js";
import { createPlaywrightAnalyzer } from "./core/analyzer.js";
import { loadA11yConfig, type LoadedA11yConfig } from "./core/config.js";
import { A11Y_FORMAT_LIST, isA11yFormat, render } from "./reporters/index.js";
import { CLEAR_LINE, createProgressReporter } from "./reporters/progress.js";
import { A11yError, SEVERITIES, isSeverity, type Severity, type ProgressListener } from "./types.js";

/** `--tags <list>`: commas separate, whitespace around them is trimmed, empty items are dropped. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether to paint what goes to `stream`. The report and the progress line
 * are decided separately, since stdout may be a pipe while stderr is still
 * the terminal (`-f json | jq`), and the other way round.
 */
function resolveColor(program: Command, stream: NodeJS.WriteStream): boolean {
  // commander maps --no-color to opts.color === false.
  const noColor = program.opts().color === false;
  // `isTTY` is undefined off a terminal, never false; `shouldColor` treats a
  // missing one as "not a terminal".
  return shouldColor({ noColor, isTTY: stream.isTTY });
}

interface Progress {
  /** Hears the run's events; `undefined` keeps the run silent. */
  listener: ProgressListener | undefined;
  /**
   * Erase the status line. On a terminal it is rewritten in place, and a run
   * that dies mid-crawl (no browser, a seed that will not load) would leave
   * it there for the error to land on. A no-op everywhere else.
   */
  clear: () => void;
}

/**
 * `--progress` and `--no-progress` decide; with neither, progress is on
 * exactly when stderr is a terminal, so a CI log stays as it was.
 */
function resolveProgress(program: Command, flag: boolean | undefined): Progress {
  // @types/node says boolean; off a terminal it is undefined (see resolveColor).
  const tty = (process.stderr.isTTY as boolean | undefined) ?? false;
  const silent: Progress = { listener: undefined, clear: () => undefined };
  if (!(flag ?? tty)) return silent;
  const listener = createProgressReporter({
    stream: process.stderr,
    color: resolveColor(program, process.stderr),
    tty,
  });
  if (!tty) return { listener, clear: silent.clear };
  return {
    listener,
    clear: () => {
      process.stderr.write(CLEAR_LINE);
    },
  };
}

/**
 * A positive integer flag, in canonical form. Anything else is a usage error:
 * `0`, `-3`, `2.5`, `many`, and `01`, since a leading zero is not how anyone
 * writes a page count and would read as an octal literal elsewhere.
 * Exported for its unit test only.
 */
export function positiveInteger(value: string, flag: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new A11yError(`${flag} must be an integer >= 1.`);
  }
  return Number(value);
}

function assertSeverity(value: string): Severity {
  if (!isSeverity(value)) {
    throw new A11yError(`Unknown --severity "${value}". Use ${SEVERITIES.join(" | ")}.`);
  }
  return value;
}

interface CheckCliOptions {
  /** `-f, --format` (default "pretty"). */
  format: string;
  /** `--no-crawl` → false. */
  crawl: boolean;
  /** `--max-pages <n>`, parsed to int here. */
  maxPages: string;
  /** `--tags <list>`, split on "," here (same helper shape as meta's --ext). */
  tags?: string;
  /** `--severity <level>`. */
  severity: string;
  /** `--timeout <ms>`, parsed to int here. */
  timeout: string;
  /** `-q, --quiet`. */
  quiet?: boolean;
  /** `--progress` → true, `--no-progress` → false, neither → undefined (auto). */
  progress?: boolean;
  /** `-c <path>` | `--no-config` → false. */
  config?: string | false;
}

/** Commander program named "a11y"; the umbrella mounts it. No entry point. */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("a11y")
    .description("Crawl a site and check every page for accessibility violations with axe-core")
    .version(pkg.version, "-V, --version")
    .option("--no-color", "disable colored output")
    // A pointer, not the whole help screen; the message before it already
    // names the offending flag.
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` call below. `copyInheritedSettings`
    // copies `_exitCallback` **by value** at subcommand-creation time, so an
    // `exitOverride()` installed afterwards leaves the subcommand calling
    // `process.exit(1)` while the program-level case looks fixed.
    .exitOverride();

  program
    .command("check")
    .description("Crawl from the given URLs and check every page with axe-core")
    .argument(
      "[urls...]",
      "http(s) seed URLs; falls back to a11y.urls in manni.config.yaml",
    )
    .option("-f, --format <format>", `output: ${A11Y_FORMAT_LIST}`, "pretty")
    .option("--no-crawl", "check exactly the given URLs: no sitemap, no link following")
    .option(
      "--max-pages <n>",
      "stop after this many pages; the rest are reported as skipped",
      String(CHECK_DEFAULTS.maxPages),
    )
    .option("--tags <list>", "comma-separated axe tags to restrict the rules to")
    .option(
      "--severity <level>",
      `minimum severity reported: ${SEVERITIES.join(" | ")}`,
      CHECK_DEFAULTS.severity,
    )
    .option(
      "--timeout <ms>",
      "per-page navigation timeout in milliseconds",
      String(CHECK_DEFAULTS.timeout),
    )
    .option("-q, --quiet", "in pretty output, hide pages with no violations")
    // `--progress` first, so that adding `--no-progress` leaves the default
    // undefined (auto) instead of commander's `true` for a lone negation.
    .option("--progress", "report progress on stderr (default: only on a terminal)")
    .option("--no-progress", "never report progress")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
    .action(async (urls: string[], options: CheckCliOptions, command: Command) => {
      // Settled once the flags are validated; until then there is no line to clear.
      let clearProgress = (): void => undefined;
      try {
        // A value commander filled in from the option's default yields to the
        // config file; one the user typed wins over it. Same three-way
        // precedence as meta: CLI flag > config key > default.
        const typed = (name: string): boolean =>
          command.getOptionValueSource(name) === "cli";

        const format = options.format;
        if (!isA11yFormat(format)) {
          throw new A11yError(`Unknown --format "${format}". Use ${A11Y_FORMAT_LIST}.`);
        }
        const severity = assertSeverity(options.severity);
        const maxPages = positiveInteger(options.maxPages, "--max-pages");
        const timeout = positiveInteger(options.timeout, "--timeout");

        const loaded: LoadedA11yConfig =
          options.config === false
            ? { config: {}, source: null }
            : await loadA11yConfig(process.cwd(), options.config);
        const cfg = loaded.config;

        const parent = command.parent ?? command;
        const progress = resolveProgress(parent, options.progress);
        clearProgress = progress.clear;

        const run = await runCheck(
          {
            urls: urls.length > 0 ? urls : (cfg.urls ?? []),
            crawl: typed("crawl") ? options.crawl : (cfg.crawl ?? CHECK_DEFAULTS.crawl),
            maxPages: typed("maxPages") ? maxPages : (cfg.maxPages ?? CHECK_DEFAULTS.maxPages),
            tags:
              options.tags !== undefined
                ? splitList(options.tags)
                : (cfg.tags ?? CHECK_DEFAULTS.tags),
            severity: typed("severity") ? severity : (cfg.severity ?? CHECK_DEFAULTS.severity),
            timeout: typed("timeout") ? timeout : (cfg.timeout ?? CHECK_DEFAULTS.timeout),
          },
          { analyzer: createPlaywrightAnalyzer(), onProgress: progress.listener },
        );

        const color = resolveColor(parent, process.stdout);
        const text = render(format, run, { color, quiet: Boolean(options.quiet) });
        // Only `github` may say nothing on a clean run; every other format
        // owes its envelope even when it is empty.
        if (text.length > 0 || format !== "github") {
          process.stdout.write(`${text}\n`);
        }
        process.exitCode = run.summary.failed > 0 ? 1 : 0;
      } catch (err) {
        clearProgress();
        fail(err);
      }
    });

  return program;
}

