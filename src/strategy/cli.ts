/**
 * The `strategy` domain's commander program. Mounted by `src/cli.ts` under
 * `manni strategy`; no entry point of its own. The verbs are `list`, `get` and
 * `check` (proposal 0102), and there is no default subcommand.
 *
 * Follows clig.dev as the family does: primary output to stdout, diagnostics
 * to stderr, colour only on a TTY and never under `NO_COLOR`/`--no-color`,
 * exit `0` clean, `1` an error-severity finding, `2` operational/usage.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { readStdin, splitList, withInputs } from "../shared/cli-options.js";
import { shouldColor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { notice } from "../shared/warn.js";
import { OMITTED_WHEN_CLEAN, STDIN_TOKEN } from "../meta/internal.js";
import { runCheck } from "./commands/check.js";
import { FINDING_FORMATS, type FindingFormat, type StrategyReport } from "./commands/findings.js";
import { GET_FORMATS, runGet } from "./commands/get.js";
import { LIST_FORMATS, runList } from "./commands/list.js";
import { formatChoice, type StrategyCommandOptions } from "./commands/run.js";
import { renderFindingsGithub } from "./reporters/github.js";
import { renderFindingsJson, renderGetJson, renderListJson } from "./reporters/json.js";
import { renderFindingsJunit } from "./reporters/junit.js";
import { renderFindingsPretty, renderGetPretty, renderListPretty } from "./reporters/pretty.js";
import { renderFindingsSarif } from "./reporters/sarif.js";

/** What commander hands every verb. */
interface InputCliOptions {
  as?: string;
  /** `--ext <list>`, comma-separated and given once. */
  ext?: string;
  /** `--exclude <glob>`, repeatable; commander's default value is `[]`. */
  exclude: string[];
  allowEmpty?: boolean;
  /** `--no-gitignore`: `false` when given. */
  gitignore: boolean;
  /** `--collection <name>`, repeatable; commander's default value is `[]`. */
  collection: string[];
  config?: string;
  /** `--no-color`: `false` when given. */
  color: boolean;
  format: string;
}

interface CheckCliOptions extends InputCliOptions {
  baseline?: boolean;
}

const PATHS = "files, directories, or globs to read (use - for stdin)";

function colorFor(options: InputCliOptions): boolean {
  return shouldColor({ noColor: !options.color, isTTY: process.stdout.isTTY });
}

/** The core's shared options from commander's, with stdin read once when `-` is among the paths. */
async function coreOptions(paths: string[], options: InputCliOptions): Promise<StrategyCommandOptions> {
  return {
    inputs: paths,
    ...(paths.includes(STDIN_TOKEN) ? { stdin: await readStdin() } : {}),
    ...(options.as === undefined ? {} : { as: options.as }),
    ...(options.ext === undefined ? {} : { exts: splitList(options.ext) }),
    exclude: options.exclude,
    collection: options.collection,
    ...(options.allowEmpty === true ? { allowEmpty: true } : {}),
    ...(options.gitignore ? {} : { noGitignore: true }),
    ...(options.config === undefined ? {} : { configPath: options.config }),
    onNotice: notice,
  };
}

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

function renderFindings(report: StrategyReport, format: FindingFormat, options: InputCliOptions): void {
  let text: string;
  switch (format) {
    case "pretty":
      text = renderFindingsPretty(report, { color: colorFor(options) });
      break;
    case "json":
      text = renderFindingsJson(report);
      break;
    case "github":
      text = renderFindingsGithub(report);
      break;
    case "sarif":
      text = renderFindingsSarif(report, { onNotice: notice });
      break;
    case "junit":
      text = renderFindingsJunit(report);
      break;
  }
  if (text.length > 0 || !OMITTED_WHEN_CLEAN.has(format)) print(text);
  process.exitCode = report.summary.failed > 0 ? 1 : 0;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("strategy")
    .description("Check a docset's pages against its audiences, personas and journeys.")
    .version(pkg.version, "-V, --version")
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` calls below: commander copies the exit
    // callback into each subcommand by value when the subcommand is created.
    .exitOverride();

  withInputs(
    program.command("list").description("List the records as a tree").argument("[paths...]", PATHS),
    "no records",
  )
    .option("-f, --format <format>", `output: ${LIST_FORMATS.join(" | ")}`, "pretty")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni strategy list                       # every collection",
        "  manni strategy list -f json               # for a script",
      ].join("\n"),
    )
    .action(async (paths: string[], options: InputCliOptions) => {
      try {
        const format = formatChoice(options.format, LIST_FORMATS);
        const { entries } = await runList(await coreOptions(paths, options));
        print(format === "json" ? renderListJson(entries) : renderListPretty(entries));
        process.exitCode = 0;
      } catch (err) {
        fail(err);
      }
    });

  withInputs(
    program
      .command("get")
      .description("Show one record, its parent, and what names it")
      .argument("<id>", "the record's id, in any case")
      .argument("[paths...]", PATHS),
    "no records",
  )
    .option("-f, --format <format>", `output: ${GET_FORMATS.join(" | ")}`, "pretty")
    .addHelpText("after", ["", "Examples:", "  manni strategy get m5", "  manni strategy get maya -f json"].join("\n"))
    .action(async (id: string, paths: string[], options: InputCliOptions) => {
      try {
        const format = formatChoice(options.format, GET_FORMATS);
        const entry = await runGet({ ...(await coreOptions(paths, options)), id });
        print(format === "json" ? renderGetJson(entry) : renderGetPretty(entry, { color: colorFor(options) }));
        process.exitCode = 0;
      } catch (err) {
        fail(err);
      }
    });

  withInputs(
    program.command("check").description("Check the pages against the records").argument("[paths...]", PATHS),
    "no records",
  )
    .option("-f, --format <format>", `output: ${FINDING_FORMATS.join(" | ")}`, "pretty")
    .option("--baseline", "record the findings on the first run; after that, fail only on new ones")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni strategy check                      # every collection",
        "  manni strategy check -f github            # CI annotations",
        "  manni strategy check --baseline           # ramp in on an existing docset",
      ].join("\n"),
    )
    .action(async (paths: string[], options: CheckCliOptions) => {
      try {
        const format = formatChoice(options.format, FINDING_FORMATS);
        const report = await runCheck({
          ...(await coreOptions(paths, options)),
          ...(options.baseline === true ? { baseline: true } : {}),
        });
        renderFindings(report, format, options);
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
