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
import { A11yError, IMPACTS, isImpact, type Impact } from "./types.js";

/** `--tags <list>`: commas separate, whitespace around them is trimmed, empty items are dropped. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveColor(program: Command): boolean {
  // commander maps --no-color to opts.color === false.
  const noColor = program.opts().color === false;
  // `isTTY` is undefined off a terminal, never false; `shouldColor` treats a
  // missing one as "not a terminal".
  return shouldColor({ noColor, isTTY: process.stdout.isTTY });
}

/** A positive integer flag. Anything else, `0` and `2.5` included, is a usage error. */
function positiveInteger(value: string, flag: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new A11yError(`${flag} must be an integer >= 1.`);
  }
  return Number(value);
}

function assertImpact(value: string): Impact {
  if (!isImpact(value)) {
    throw new A11yError(`Unknown --impact "${value}". Use ${IMPACTS.join(" | ")}.`);
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
  /** `--impact <level>`. */
  impact: string;
  /** `--timeout <ms>`, parsed to int here. */
  timeout: string;
  /** `-q, --quiet`. */
  quiet?: boolean;
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
      "--impact <level>",
      `minimum impact reported: ${IMPACTS.join(" | ")}`,
      CHECK_DEFAULTS.impact,
    )
    .option(
      "--timeout <ms>",
      "per-page navigation timeout in milliseconds",
      String(CHECK_DEFAULTS.timeout),
    )
    .option("-q, --quiet", "in pretty output, hide pages with no violations")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
    .action(async (urls: string[], options: CheckCliOptions, command: Command) => {
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
        const impact = assertImpact(options.impact);
        const maxPages = positiveInteger(options.maxPages, "--max-pages");
        const timeout = positiveInteger(options.timeout, "--timeout");

        const loaded: LoadedA11yConfig =
          options.config === false
            ? { config: {}, source: null }
            : await loadA11yConfig(process.cwd(), options.config);
        const cfg = loaded.config;

        const run = await runCheck(
          {
            urls: urls.length > 0 ? urls : (cfg.urls ?? []),
            crawl: typed("crawl") ? options.crawl : (cfg.crawl ?? CHECK_DEFAULTS.crawl),
            maxPages: typed("maxPages") ? maxPages : (cfg.maxPages ?? CHECK_DEFAULTS.maxPages),
            tags:
              options.tags !== undefined
                ? splitList(options.tags)
                : (cfg.tags ?? CHECK_DEFAULTS.tags),
            impact: typed("impact") ? impact : (cfg.impact ?? CHECK_DEFAULTS.impact),
            timeout: typed("timeout") ? timeout : (cfg.timeout ?? CHECK_DEFAULTS.timeout),
          },
          { analyzer: createPlaywrightAnalyzer() },
        );

        const color = resolveColor(command.parent ?? command);
        const text = render(format, run, { color, quiet: Boolean(options.quiet) });
        // Only `github` may say nothing on a clean run; every other format
        // owes its envelope even when it is empty.
        if (text.length > 0 || format !== "github") {
          process.stdout.write(`${text}\n`);
        }
        process.exitCode = run.summary.failed > 0 ? 1 : 0;
      } catch (err) {
        fail(err);
      }
    });

  return program;
}

