/**
 * The `term` domain's commander program. Mounted by `src/cli.ts` under
 * `manni term`; no entry point of its own. Grammar per proposal 0034: the verbs
 * are `list`, `get`, `check`, `lint`, `write` and `formats`, and there is no
 * default subcommand.
 *
 * Follows clig.dev as the family does: primary output to stdout, diagnostics
 * and notices to stderr, colour only on a TTY and never under
 * `NO_COLOR`/`--no-color`, exit `0` clean, `1` an error-severity finding or a
 * `--check` that found drift, `2` operational/usage.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import { collect, readStdin, splitList } from "../shared/cli-options.js";
import { shouldColor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { notice } from "../shared/warn.js";
import { OMITTED_WHEN_CLEAN, STDIN_TOKEN } from "../meta/internal.js";
import { runCheck } from "./commands/check.js";
import { FINDING_FORMATS, type FindingFormat, type TermReport } from "./commands/findings.js";
import { FORMATS_FORMATS, listFormats } from "./commands/formats.js";
import { GET_FORMATS, runGet } from "./commands/get.js";
import { runLint } from "./commands/lint.js";
import { LIST_FORMATS, runList } from "./commands/list.js";
import { formatChoice, type TermCommandOptions } from "./commands/run.js";
import { runWrite, writeFormats } from "./commands/write.js";
import { renderListCsv } from "./reporters/csv.js";
import { renderFindingsGithub } from "./reporters/github.js";
import { renderFindingsJson, renderFormatsJson, renderGetJson, renderListJson } from "./reporters/json.js";
import { renderFindingsJunit } from "./reporters/junit.js";
import {
  renderFindingsPretty,
  renderFormatsPretty,
  renderGetPretty,
  renderListPretty,
  renderValeWiring,
  renderWritePretty,
} from "./reporters/pretty.js";
import { renderFindingsSarif } from "./reporters/sarif.js";

/** What commander hands every verb that reads terms. */
interface InputCliOptions {
  as?: string;
  /** `--ext <list>`, comma-separated and given once. */
  ext?: string;
  /** `--exclude <glob>`, repeatable; commander's default value is `[]`. */
  exclude: string[];
  /** `--allow-empty`. */
  allowEmpty?: boolean;
  /** `--no-gitignore`: `false` when given. */
  gitignore: boolean;
  /** `--collection <name>`, repeatable; commander's default value is `[]`. */
  collection: string[];
  config?: string;
  /** `--no-color`: `false` when given. */
  color: boolean;
}

interface FormatCliOptions extends InputCliOptions {
  format: string;
}

interface CheckCliOptions extends FormatCliOptions {
  baseline?: boolean;
}

interface WriteCliOptions extends InputCliOptions {
  format?: string;
  out?: string;
  check?: boolean;
  dryRun?: boolean;
}

/** Colour for a verb's pretty output: off under `--no-color` or `NO_COLOR`, on only for a TTY. */
function colorFor(options: InputCliOptions): boolean {
  return shouldColor({ noColor: !options.color, isTTY: process.stdout.isTTY });
}

/** The core's shared options from commander's, with stdin read once when `-` is among the paths. */
async function coreOptions(paths: string[], options: InputCliOptions): Promise<TermCommandOptions> {
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

/** The shared input flags, declared once so every verb spells them alike. */
function withInputs(command: Command): Command {
  return command
    .option("--as <format>", "input format for stdin (-)")
    .option("--ext <list>", "comma-separated extensions for directory walks")
    .option("--exclude <glob>", "glob to exclude; repeatable", collect, [])
    .option("--collection <name>", "configured collection to read; repeatable", collect, [])
    .option("--allow-empty", "treat zero matched files as success")
    .option("--no-gitignore", "read files .gitignore covers")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-color", "disable colored output");
}

function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

function renderFindings(report: TermReport, format: FindingFormat, options: InputCliOptions, references: boolean): void {
  let text: string;
  switch (format) {
    case "pretty":
      text = renderFindingsPretty(report, { color: colorFor(options), references });
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
    .name("term")
    .description("Check, lint and render a docset's terms and the references into them.")
    .version(pkg.version, "-V, --version")
    // A pointer, not the whole help screen: the message that precedes it
    // already names the offending flag.
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` calls below: commander copies the exit
    // callback into each subcommand by value when the subcommand is created.
    .exitOverride();

  withInputs(
    program
      .command("list")
      .description("List the resolved entries")
      .argument("[paths...]", "files, directories, or globs to read (use - for stdin)"),
  )
    .option("-f, --format <format>", `output: ${LIST_FORMATS.join(" | ")}`, "pretty")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni term list                       # every collection",
        "  manni term list docs/terms/           # one directory",
        "  manni term list -f csv | head -2      # for a script",
      ].join("\n"),
    )
    .action(async (paths: string[], options: FormatCliOptions) => {
      try {
        const format = formatChoice(options.format, LIST_FORMATS);
        const { terms } = await runList(await coreOptions(paths, options));
        print(format === "json" ? renderListJson(terms) : format === "csv" ? renderListCsv(terms) : renderListPretty(terms));
        process.exitCode = 0;
      } catch (err) {
        fail(err);
      }
    });

  withInputs(
    program
      .command("get")
      .description("Show one entry")
      .argument("<term>", "the entry's id, or its label or an alt-label in any case")
      .argument("[paths...]", "files, directories, or globs to read (use - for stdin)"),
  )
    .option("-f, --format <format>", `output: ${GET_FORMATS.join(" | ")}`, "pretty")
    .addHelpText(
      "after",
      ["", "Examples:", "  manni term get progressive-lens", '  manni term get "progressive lens" -f json'].join("\n"),
    )
    .action(async (term: string, paths: string[], options: FormatCliOptions) => {
      try {
        const format = formatChoice(options.format, GET_FORMATS);
        const found = await runGet({ ...(await coreOptions(paths, options)), term });
        print(format === "json" ? renderGetJson(found) : renderGetPretty(found, { color: colorFor(options) }));
        process.exitCode = 0;
      } catch (err) {
        fail(err);
      }
    });

  withInputs(
    program
      .command("check")
      .description("Check the set and every reference into it")
      .argument("[paths...]", "files, directories, or globs to read (use - for stdin)"),
  )
    .option("-f, --format <format>", `output: ${FINDING_FORMATS.join(" | ")}`, "pretty")
    .option("--baseline", "record the findings on the first run; after that, fail only on new ones")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni term check                      # every collection",
        "  manni term check -f github            # CI annotations",
        "  manni term check --baseline           # ramp in on an existing docset",
      ].join("\n"),
    )
    .action(async (paths: string[], options: CheckCliOptions) => {
      try {
        const format = formatChoice(options.format, FINDING_FORMATS);
        const report = await runCheck({
          ...(await coreOptions(paths, options)),
          ...(options.baseline === true ? { baseline: true } : {}),
        });
        renderFindings(report, format, options, true);
      } catch (err) {
        fail(err);
      }
    });

  withInputs(
    program
      .command("lint")
      .description("Run Vale over the definitions")
      .argument("[paths...]", "files, directories, or globs to read (use - for stdin)"),
  )
    .option("-f, --format <format>", `output: ${FINDING_FORMATS.join(" | ")}`, "pretty")
    .addHelpText(
      "after",
      ["", "Examples:", "  manni term lint", "  manni term lint -f github"].join("\n"),
    )
    .action(async (paths: string[], options: FormatCliOptions) => {
      try {
        const format = formatChoice(options.format, FINDING_FORMATS);
        const report = await runLint(await coreOptions(paths, options));
        renderFindings(report, format, options, false);
      } catch (err) {
        fail(err);
      }
    });

  withInputs(
    program
      .command("write")
      .description("Write the set back, or render it elsewhere")
      .argument("[paths...]", "files, directories, or globs to read (use - for stdin)"),
  )
    .option("-f, --format <format>", `render as: ${writeFormats().join(" | ")} (default: each entry's own, in place)`)
    .option("-o, --out <path>", "file or directory to render into; a trailing / means a directory")
    .option("--check", "write nothing; exit 1 when the target differs from the render")
    .option("--dry-run", "write nothing; print what would change")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni term write                            # each entry back to its source",
        "  manni term write -f json -o build/terms.json",
        "  manni term write -f vale                    # into Vale's styles directory",
        "  manni term write -f vale --check            # keep the style in step",
      ].join("\n"),
    )
    .action(async (paths: string[], options: WriteCliOptions) => {
      try {
        const report = await runWrite({
          ...(await coreOptions(paths, options)),
          ...(options.format === undefined ? {} : { format: options.format }),
          ...(options.out === undefined ? {} : { out: options.out }),
          ...(options.check === true ? { check: true } : {}),
          ...(options.dryRun === true ? { dryRun: true } : {}),
        });
        print(renderWritePretty(report));
        if (report.wiring !== undefined) process.stderr.write(`${renderValeWiring(report.wiring)}\n`);
        process.exitCode = report.check && report.changes.length > 0 ? 1 : 0;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("formats")
    .description("List the constructs read and written, per format")
    .option("-f, --format <format>", `output: ${FORMATS_FORMATS.join(" | ")}`, "pretty")
    .action((options: { format: string }) => {
      try {
        const format = formatChoice(options.format, FORMATS_FORMATS);
        const rows = listFormats();
        print(format === "json" ? renderFormatsJson(rows) : renderFormatsPretty(rows));
        process.exitCode = 0;
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
