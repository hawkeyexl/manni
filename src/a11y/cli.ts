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
import { FAMILY_CONFIG_NAMES } from "../shared/config-file.js";
import { fail } from "../shared/run.js";
import { CHECK_DEFAULTS, runCheck } from "./commands/check.js";
import { createPlaywrightAnalyzer } from "./core/analyzer.js";
import { excludeEntryLabel, loadA11yConfig, type LoadedA11yConfig } from "./core/config.js";
import { MUST_START_WITH_SLASH, isUrlPathGlob, type ExcludeGlob } from "./core/exclude.js";
import { resolveSeeds } from "./core/seeds.js";
import { A11Y_FORMAT_LIST, isA11yFormat, render } from "./reporters/index.js";
import { CLEAR_LINE, createProgressReporter } from "./reporters/progress.js";
import {
  A11yError,
  SEVERITY_LIST,
  isSeverity,
  type Severity,
  type ProgressListener,
} from "./types.js";

/**
 * `--collection <name>` and `--exclude <glob>`: one value per occurrence,
 * never split on commas. The two lines are meta's `collect`, copied rather
 * than imported: a tool does not reach into a sibling tool's CLI.
 */
function collect(value: string, prev: string[]): string[] {
  return prev.concat([value]);
}

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

/**
 * `--max-pages <n>` and `--no-max-pages` share one option value, the way `-c`
 * and `--no-config` do, so the pair has three states rather than two:
 * a number the user typed, `"uncapped"` for the negation, and `undefined`
 * when neither half was typed and the config key still decides.
 */
export type MaxPagesFlag = number | "uncapped" | undefined;

/**
 * The typed half of that pair, in canonical form. commander hands the
 * negation over as `false`, which is not the same as saying nothing: it is
 * the typed way to ask for a run with no cap at all. Parsed before the config
 * file is read, so a bad value costs a message and nothing else.
 * Exported for its unit test only.
 */
export function parseMaxPages(value: string | false | undefined): MaxPagesFlag {
  if (value === false) return "uncapped";
  if (value === undefined) return undefined;
  return positiveInteger(value, "--max-pages");
}

/**
 * The cap in force: a typed flag beats the config key, and `undefined` out
 * means no cap, which is what `runCheck` reads as "check everything found".
 * Exported for its unit test only.
 */
export function resolveMaxPages(
  flag: MaxPagesFlag,
  configured: number | undefined,
): number | undefined {
  if (flag === "uncapped") return undefined;
  return flag ?? configured;
}

/**
 * Whether to crawl: `--crawl` and `--no-crawl` are both declared, so
 * commander holds no default for the pair and `undefined` means the user
 * typed neither. Same three-way precedence as meta: CLI flag > config key >
 * built-in default.
 * Exported for its unit test only.
 */
export function resolveCrawl(flag: boolean | undefined, configured: boolean | undefined): boolean {
  return flag ?? configured ?? CHECK_DEFAULTS.crawl;
}

/**
 * Every `--exclude` value has to be able to match a path, which always starts
 * with `/`. Checked before the config file is read and long before a browser
 * launches, so a pattern that could only ever miss costs a message. Each
 * survivor carries the flag spelling a later message names it by.
 * Exported for its unit test only.
 */
export function assertExcludeGlobs(globs: readonly string[]): ExcludeGlob[] {
  return globs.map((glob) => {
    if (!isUrlPathGlob(glob)) {
      throw new A11yError(`--exclude "${glob}" ${MUST_START_WITH_SLASH}`);
    }
    return { glob, source: `--exclude "${glob}"` };
  });
}

/**
 * The same list as it arrives from `a11y.exclude:`, named the way the config
 * errors name it. A run whose patterns came from a file never reports them as
 * a flag, which would send a reader looking through a shell history for
 * something they never typed.
 * Exported for its unit test only.
 */
export function configExcludeGlobs(
  globs: readonly string[],
  source: string | null,
): ExcludeGlob[] {
  const file = source ?? FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml";
  return globs.map((glob, i) => ({ glob, source: excludeEntryLabel(file, i) }));
}

function assertSeverity(value: string): Severity {
  if (!isSeverity(value)) {
    throw new A11yError(`Unknown --severity "${value}". Use ${SEVERITY_LIST}.`);
  }
  return value;
}

interface CheckCliOptions {
  /** `-f, --format` (default "pretty"). */
  format: string;
  /** `--crawl` → true, `--no-crawl` → false, neither → undefined (config decides). */
  crawl?: boolean;
  /** `--max-pages <n>` → the string; `--no-max-pages` → commander's false; neither → undefined. */
  maxPages?: string | false;
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
  /** `--collection <name>`, one value per occurrence. `[]` when never given. */
  collection: string[];
  /** `--exclude <glob>`, one value per occurrence. `[]` when never given. */
  exclude: string[];
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
      "http(s) seed URLs; falls back to a collection's url: or a11y.urls in manni.config.yaml",
    )
    .option("-f, --format <format>", `output: ${A11Y_FORMAT_LIST}`, "pretty")
    // `--crawl` first, so that `--no-crawl` leaves the pair's default
    // undefined instead of commander's `true` for a lone negation. Undefined
    // is what lets `crawl:` in config be read as the next rung down.
    .option("--crawl", "crawl from the given URLs: sitemap and link following (default)")
    .option("--no-crawl", "check exactly the given URLs: no sitemap, no link following")
    // No commander default on purpose: the built-in behaviour is to check
    // everything discovered, and "no cap" is not a value commander could hold.
    .option(
      "--max-pages <n>",
      "cap on pages checked; the rest are reported as skipped (default: no cap)",
    )
    .option("--no-max-pages", "check every page found, ignoring a configured maxPages")
    .option(
      "--exclude <glob>",
      "URL path glob to keep out of the crawl; repeatable",
      collect,
      [],
    )
    .option("--tags <list>", "comma-separated axe tags to restrict the rules to")
    .option(
      "--severity <level>",
      `minimum severity reported: ${SEVERITY_LIST}`,
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
    .option(
      "--collection <name>",
      "configured collection to run over; repeatable",
      collect,
      [],
    )
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
        const maxPages = parseMaxPages(options.maxPages);
        const timeout = positiveInteger(options.timeout, "--timeout");
        const exclude = assertExcludeGlobs(options.exclude);

        const loaded: LoadedA11yConfig =
          options.config === false
            // --no-config drops the collections with the section: the file
            // the user told the run to ignore is where both live.
            ? { config: {}, source: null, collections: [] }
            : await loadA11yConfig(process.cwd(), options.config);
        const cfg = loaded.config;

        // Before the analyzer exists: a run with nothing to check, or a
        // --collection that cannot be honoured, costs a message and not a
        // browser launch.
        const seeds = resolveSeeds({
          urls,
          collections: options.collection,
          ...(cfg.urls === undefined ? {} : { configUrls: cfg.urls }),
          declared: loaded.collections,
          source: loaded.source,
        });

        const parent = command.parent ?? command;
        const progress = resolveProgress(parent, options.progress);
        clearProgress = progress.clear;

        const run = await runCheck(
          {
            urls: seeds,
            crawl: resolveCrawl(options.crawl, cfg.crawl),
            // Typed flag > config key > no cap. There is no default to fall
            // to, and `--no-max-pages` is the typed way to ask for none.
            maxPages: resolveMaxPages(maxPages, cfg.maxPages),
            tags:
              options.tags !== undefined
                ? splitList(options.tags)
                : (cfg.tags ?? CHECK_DEFAULTS.tags),
            // A typed flag replaces the config list entirely; the two do not
            // merge. Merging would only ever let a run exclude *more* than
            // the repository's default, so checking one excluded section on
            // purpose would need --no-config, which also drops collections:.
            exclude: typed("exclude")
              ? exclude
              : configExcludeGlobs(cfg.exclude ?? [], loaded.source),
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

