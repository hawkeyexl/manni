/**
 * The lint program. Named `lint` because that is where it is mounted
 * (`manni lint …`); `src/cli.ts` adds it to the umbrella and runs it. Thin
 * commander wrapper over the command cores. Follows clig.dev: primary output to
 * stdout, diagnostics to stderr, color only on a TTY (and never under
 * NO_COLOR/--no-color), meaningful exit codes.
 *
 * Grammar per proposal 0034: the verbs are `check`, `structure`, `templates`
 * and `tools`, and there is no default subcommand, so a bare `manni lint` is a
 * usage error that lists them. `check` runs every configured job; `structure`
 * runs one of them, and carries the options that belong to the tool performing
 * it.
 *
 * Exit codes are the contract CI reads:
 *   0  every file linted clean
 *   1  the run produced findings
 *   2  the tool could not do its job - bad usage, missing template, unreadable
 *      input. A LintError is always this, never a lint failure.
 *
 * The 1/2 split is what lets a workflow tell "the docs are wrong" apart from
 * "the linter is misconfigured", which a single non-zero exit cannot.
 */
import { Command } from "commander";
import pkg from "../../package.json" with { type: "json" };
import {
  collect,
  configOption,
  explicitFalse,
  readStdin,
  reportConfig,
  splitList,
} from "../shared/cli-options.js";
import { shouldColor } from "../shared/color.js";
import { fail } from "../shared/run.js";
import { notice } from "../shared/warn.js";
import {
  OMITTED_WHEN_CLEAN,
  REPORT_FORMAT_LIST,
  STDIN_TOKEN,
} from "../meta/internal.js";
import {
  REPORT_FORMATS,
  isReportFormat,
  type ReportFormat as FamilyFormat,
} from "../meta/index.js";
import { LintError } from "./types.js";
import { runLint } from "./commands/lint.js";
import { runTemplates, runTemplatesInfer } from "./commands/templates.js";
import { runTools } from "./commands/tools.js";
import { INFER_FORMATS, isInferFormat, type InferFormat } from "./core/infer.js";
import {
  LINT_JOBS,
  TOOLS_BY_JOB,
  loadConfig,
  rebaseConfig,
} from "./core/config.js";
import { resolveStructureTool } from "./tools/index.js";
import {
  render,
  renderTemplates,
  renderTools,
  type ListFormat,
  type ReportFormat,
} from "./reporters/index.js";

/** The options `check` and `structure` share, in the family's spelling. */
interface InputCliOptions {
  /** `--collection <name>`, repeatable; commander's default value is `[]`. */
  collection: string[];
  /** `--ext <list>`; the command splits it. */
  ext?: string;
  /** `--exclude <glob>`, repeatable; commander's default value is `[]`. */
  exclude: string[];
  /** `--as <format>`: force a parser. */
  as?: string;
  /**
   * `-c, --config <path>` and `--no-config` share one commander attribute:
   * `undefined` with neither flag, the path with `-c`, `false` with
   * `--no-config`. Split by `configOption`.
   */
  config?: string | boolean;
  allowEmpty?: boolean;
  /** `--no-gitignore`. */
  gitignore: boolean;
  /** `-f, --format <format>`. Always a string: the declaration has a default. */
  format: string;
}

/** `structure` adds the options of the tool that performs the job. */
interface StructureCliOptions extends InputCliOptions {
  tool?: string;
  template?: string;
  /** `--templates <path>`, repeatable; commander's default value is `[]`. */
  templates: string[];
  explain?: boolean;
}

/** What commander parses for `templates`. */
interface TemplatesCommandOptions {
  templates: string[];
  config?: string | boolean;
  format: string;
}

/** What commander parses for `templates infer`. */
interface TemplatesInferCliOptions {
  as?: string;
  name?: string;
  config?: string | boolean;
  format: string;
  out?: string;
  force?: boolean;
}

/** What commander parses for `tools`. */
interface ToolsCommandOptions {
  config?: string | boolean;
  format: string;
}

// `explain` is reachable through `--explain`, not `-f`: it reports on
// configuration rather than on documents, and offering it as a format would
// invite `-f explain` alongside a lint that then never happens. The `-f` set
// itself is the family's, from meta, rather than a fourth hand-kept copy of
// the same five words.
const LIST_FORMATS = new Set<string>(["pretty", "json"]);

/** The heading the tool's own options print under, after the shared ones. */
const TOOL_OPTIONS_GROUP = "Tool options:";

function resolveColor(program: Command): boolean {
  // commander maps --no-color to opts.color === false.
  const noColor = program.opts().color === false;
  return shouldColor({ noColor, isTTY: process.stdout.isTTY });
}

function reportFormat(value: unknown): FamilyFormat {
  const format = String(value);
  if (!isReportFormat(format)) {
    throw new LintError(
      `Unknown --format "${format}". Use ${REPORT_FORMAT_LIST}.`,
    );
  }
  return format;
}

/**
 * Whether a clean run may print nothing at all in this format.
 *
 * Only `github` may: an empty annotation stream is a clean check. Every other
 * format owes its envelope - an empty JSON array, a SARIF log with no results,
 * a JUnit suite of passing testcases - because a consumer parsing stdout must
 * not have to treat "no output" as a third outcome. `explain` is never clean
 * or dirty; it always has something to say.
 */
function omittedWhenClean(format: ReportFormat): boolean {
  return format !== "explain" && OMITTED_WHEN_CLEAN.has(format);
}

function listFormat(value: unknown): ListFormat {
  const format = String(value);
  if (!LIST_FORMATS.has(format)) {
    throw new LintError(
      `Unknown --format "${format}". Use pretty or json.`,
    );
  }
  return format as ListFormat;
}

/**
 * `templates infer -f`: the format a *template file* is written in, which is
 * not the set a report is rendered in. A template is YAML or JSON because those
 * are the two the loader reads back, and `pretty` would name a third thing the
 * tool cannot then load.
 */
function inferFormat(value: unknown): InferFormat {
  const format = String(value);
  if (!isInferFormat(format)) {
    throw new LintError(`Unknown --format "${format}". Use yaml or json.`);
  }
  return format;
}

/**
 * `--tool <name>`: which tool performs the structure job. Refused by name
 * rather than ignored, because falling through to manni's engine would lint
 * with something other than what was asked for and say nothing.
 *
 * The refusal is the registry's, not a second copy of it here. `runLint`
 * refuses the same name with the same sentence for a caller that never touches
 * commander; this one fires first, so a bad `--tool` is reported before the
 * run asks what it was pointed at.
 */
function assertStructureTool(value: string | undefined): void {
  if (value === undefined) return;
  resolveStructureTool(value);
}

/**
 * `-c/--config` and `--no-config`, in one place.
 *
 * Every verb here takes them, and they had been written out three times. A flag
 * two commands both have carries the same name *and* the same description, so
 * the declaration is shared rather than copied - which is what kept the fourth
 * copy, on `templates infer`, from spelling either of them slightly differently.
 */
function withConfigOptions(command: Command): Command {
  return command
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file");
}

/**
 * The value of a flag a command and its parent both declare.
 *
 * Commander keeps parsing a parent's options past a subcommand name unless
 * `enablePositionalOptions()` is on, so `templates infer page.md -f json` sets
 * `format` on `templates` and leaves `infer` holding its own default. Both
 * commands declare `-f`, `-c` and `--no-config`, because "commands must have
 * parallel behaviors" and `infer` must list them in its own `--help`.
 *
 * Turning positional options on would fix it and move every other flag in this
 * program with it: `manni lint structure docs/ --no-color` is a root option
 * written after its command, and there are three more like it. So the lookup
 * changes instead. The nearest command actually *given* the flag wins, and the
 * subcommand's own default is the fallback - which is the reading a person
 * typing the line already has.
 */
function optionValue(command: Command, key: string): unknown {
  for (
    let cmd: Command | null = command;
    cmd !== null;
    cmd = cmd.parent ?? null
  ) {
    if (cmd.getOptionValueSource(key) === "cli") return cmd.getOptionValue(key);
  }
  return command.getOptionValue(key);
}

/** The options every job verb takes, in one place so the two cannot drift. */
function withInputOptions(command: Command): Command {
  command
    .argument(
      "[paths...]",
      "files, directories, or globs to lint (use - for stdin)",
    )
    .option(
      "--collection <name>",
      "configured collection to run over; repeatable",
      collect,
      [],
    )
    .option("--ext <list>", "comma-separated extensions for directory walks")
    .option("--exclude <glob>", "glob to exclude; repeatable", collect, [])
    .option("--as <format>", "force an input format (e.g. markdown, mdx)")
    .option(
      "-f, --format <format>",
      `output: ${REPORT_FORMATS.join(" | ")}`,
      "pretty",
    );
  return withConfigOptions(command)
    .option("--allow-empty", "treat zero matched files as success")
    .option("--no-gitignore", "lint files .gitignore covers");
}

/** The lint options every job verb turns its shared flags into. */
function inputOptions(
  paths: string[],
  options: InputCliOptions,
): {
  inputs: string[];
  collection: string[];
  exts?: string[];
  exclude: string[];
  as?: string;
  configPath?: string;
  noConfig?: boolean;
  allowEmpty?: boolean;
  respectGitignore?: boolean;
  onNotice: (message: string) => void;
} {
  return {
    inputs: paths,
    collection: options.collection,
    ...(options.ext ? { exts: splitList(options.ext) } : {}),
    exclude: options.exclude,
    ...(options.as === undefined ? {} : { as: options.as }),
    ...configOption(options.config),
    // `undefined` rather than `false` when absent, so config still wins.
    ...(options.allowEmpty ? { allowEmpty: true } : {}),
    respectGitignore: explicitFalse(options.gitignore),
    onNotice: notice,
  };
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("lint")
    .description(
      "Validate document structure against doctype templates. Deterministic, CI-friendly.",
    )
    .version(pkg.version, "-V, --version")
    .option("--no-color", "disable colored output")
    .showHelpAfterError()
    // Exit code 1 is reserved for "the docs are wrong". Commander exits 1 on a
    // usage error by default, which would make a typo'd flag look exactly like
    // a failing lint to a workflow. With no callback, commander throws the
    // CommanderError instead, and the umbrella's runner maps it: help and
    // --version stay 0, every other usage error becomes 2. Commander has
    // already written its own message. This has to precede .command(), which
    // copies the callback into each subcommand.
    .exitOverride();

  /** Run one lint, render it, and settle the exit code. Both job verbs share it. */
  const lint = async (
    paths: string[],
    options: StructureCliOptions | InputCliOptions,
    command: Command,
    job: { tool?: StructureCliOptions } = {},
  ): Promise<void> => {
    const tool = job.tool;
    const format = reportFormat(options.format);
    const explain = tool?.explain === true;
    const stdinContent = paths.includes(STDIN_TOKEN) ? await readStdin() : undefined;
    const cwd = process.cwd();

    const run = await runLint({
      ...inputOptions(paths, options),
      ...(tool?.tool === undefined ? {} : { tool: tool.tool }),
      ...(tool?.template === undefined ? {} : { template: tool.template }),
      ...(tool && tool.templates.length > 0 ? { templates: tool.templates } : {}),
      ...(explain ? { explain: true } : {}),
      ...(stdinContent === undefined ? {} : { stdinContent }),
      // Which config governed the run, said where a report cannot be parsed
      // around: discovery walks up to the project boundary, so an unexpected
      // ancestor config is the difference between a five-minute diagnosis and
      // an hour of confusion.
      onConfigLoaded: reportConfig(format === "pretty", cwd),
    });

    const color = resolveColor(command.parent ?? command);
    const chosen: ReportFormat = explain ? "explain" : format;
    const text = render(run, chosen, { color });
    if (text.length > 0 || !omittedWhenClean(chosen)) {
      process.stdout.write(`${text}\n`);
    }
    // `--explain` answers a question about configuration, so its exit code
    // reports whether it could answer it - not whether the docs are clean.
    //
    // That covers routing failures too: a page whose `type` matches no
    // template is a answered question, not an unanswered one, so it exits 0
    // like everything else here. Automation must not read this code as
    // "everything routed" - the ordinary run is what reports that, with exit
    // 1. Said in `--help` and the README, because the distinction is invisible
    // from the exit code alone.
    process.exitCode = explain ? 0 : run.summary.failed > 0 ? 1 : 0;
  };

  withInputOptions(
    program
      .command("check")
      .description("Run every configured lint job over the given files/dirs/globs"),
  )
    .addHelpText(
      "after",
      [
        "",
        "Jobs: structure.",
        "",
        "Examples:",
        "  manni lint check docs/                          # every configured job",
        "  manni lint check                                # targets from collections:",
        "  manni lint check --collection guides",
        '  manni lint check "**/*.md" -f github            # CI annotations',
        "  cat page.md | manni lint check - --as markdown",
      ].join("\n"),
    )
    .action(async (paths: string[], options: InputCliOptions, command: Command) => {
      try {
        // Which jobs this run covered, said once, beside the config line. The
        // full form also names the jobs that exist and are not configured;
        // `structure` is the only job there is, so today it is one word.
        if (options.format === "pretty") {
          process.stderr.write(`Checked: ${LINT_JOBS.join(", ")}.\n`);
        }
        await lint(paths, options, command);
      } catch (err) {
        fail(err);
      }
    });

  const structure = withInputOptions(
    program
      .command("structure")
      .description(
        "Lint document structure against doctype templates, routing each page by its `type`",
      ),
  );
  structure
    .optionsGroup(TOOL_OPTIONS_GROUP)
    .option(
      "--tool <name>",
      `tool that performs the job: ${TOOLS_BY_JOB.structure.join(", ")}`,
    )
    .option(
      "-t, --template <ref>",
      "apply this template to every file, overriding type routing",
    )
    .option(
      "--templates <path>",
      "template file to route by: its `types:` win over built-ins; repeatable",
      collect,
      [],
    )
    .option(
      "--explain",
      "print how each file's template was chosen, and lint nothing (always exits 0, unrouted pages included)",
    )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni lint structure docs/                               # route each page by its `type`",
        "  manni lint structure docs/ --templates ./templates.yaml  # add your own templates",
        "  manni lint structure                                     # targets from collections:",
        "  manni lint structure docs/ --explain                     # show why each page routed where",
        "  manni lint structure page.md -t tgdp:how-to:1.6          # force one template",
        '  manni lint structure "**/*.md" -f github                 # CI annotations',
        "  manni lint structure docs/ --exclude '**/drafts/**'",
        "  cat page.md | manni lint structure - -t tgdp:how-to:1.6 --as markdown",
      ].join("\n"),
    )
    .action(
      async (paths: string[], options: StructureCliOptions, command: Command) => {
        try {
          assertStructureTool(options.tool);
          await lint(paths, options, command, { tool: options });
        } catch (err) {
          fail(err);
        }
      },
    );

  const templates = program
    .command("templates")
    .description("List the templates that can be applied, and the types they serve")
    .option(
      "--templates <path>",
      "also list the templates in this file; repeatable",
      collect,
      [],
    );
  withConfigOptions(templates)
    .option("-f, --format <format>", "output: pretty | json", "pretty")
    .action(async (options: TemplatesCommandOptions, command: Command) => {
      try {
        const format = listFormat(options.format);
        // The listing answers "what could route a page?", so it has to see the
        // same template files a lint would - rebased the same way, or it would
        // answer for a different set of files depending on where it was run.
        const { configPath, noConfig } = configOption(options.config);
        const found = noConfig ? null : await loadConfig(configPath);
        const info = await runTemplates({
          templates:
            options.templates.length > 0
              ? options.templates
              : rebaseConfig(found).templates,
        });
        const color = resolveColor(command.parent ?? command);
        process.stdout.write(`${renderTemplates(info, format, { color })}\n`);
      } catch (err) {
        fail(err);
      }
    });

  const inferCommand = templates
    .command("infer")
    .description("Write a first template from a page that already has the shape you want")
    .argument("<page>", "one file to infer from (use - for stdin)")
    .option("--as <format>", "force an input format (e.g. markdown, mdx)")
    .option(
      "--name <name>",
      "name for the template; defaults to the page's `type`, else its filename",
    )
    .option("-f, --format <format>", `output: ${INFER_FORMATS.join(" | ")}`, "yaml")
    .option("-o, --out <path>", "write the template here instead of to stdout")
    .option("--force", "overwrite the --out path");
  withConfigOptions(inferCommand)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni lint templates infer docs/guides/install.md",
        "  manni lint templates infer docs/guides/install.md --name how-to",
        "  manni lint templates infer page.mdx -f json",
        "  manni lint templates infer page.md -o ./templates.yaml",
        "  manni lint templates infer page.md -o ./templates.yaml --force",
        "  cat page.md | manni lint templates infer - --as markdown",
        "",
        "One page, and every rule it writes is exactly one occurrence: a single",
        "page cannot show what varies. Loosening a heading into a list or a",
        "pattern, setting `min: 0`, and adding a trailing rule with no heading",
        "for the sections that may follow are your edits to make.",
      ].join("\n"),
    )
    .action(
      async (
        page: string,
        options: TemplatesInferCliOptions,
        command: Command,
      ) => {
        try {
          // `-f`, `-c` and `--no-config` are read through `optionValue`: the
          // parent `templates` declares all three, and commander hands it any
          // of them typed after `infer`.
          const format = inferFormat(optionValue(command, "format"));
          const { configPath, noConfig } = configOption(
            optionValue(command, "config"),
          );
          const stdinContent =
            page === STDIN_TOKEN ? await readStdin() : undefined;
          const result = await runTemplatesInfer({
            page,
            format,
            ...(options.as === undefined ? {} : { as: options.as }),
            ...(options.name === undefined ? {} : { name: options.name }),
            ...(options.out === undefined ? {} : { out: options.out }),
            ...(options.force === undefined ? {} : { force: options.force }),
            ...(configPath === undefined ? {} : { configPath }),
            ...(noConfig === undefined ? {} : { noConfig }),
            ...(stdinContent === undefined ? {} : { stdinContent }),
            // The template is the primary output, so with no --out it owns
            // stdout and the config line goes to stderr beside it. With --out
            // stdout is free, and the line still belongs on stderr: a reader
            // piping nothing is not a reason to move a diagnostic.
            onConfigLoaded: reportConfig(false, process.cwd()),
          });

          if (result.written === undefined) {
            process.stdout.write(result.text);
            return;
          }
          // Said on stderr, so `-o` leaves stdout empty for a shell that is
          // watching it, and the template file is the whole output.
          process.stderr.write(
            `Wrote template "${result.name}" to ${result.written}\n`,
          );
        } catch (err) {
          fail(err);
        }
      },
    );

  withConfigOptions(
    program
      .command("tools")
      .description(
        "List the lint jobs, the tool that performs each, and what it reads",
      ),
  )
    .option("-f, --format <format>", "output: pretty | json", "pretty")
    .action(async (options: ToolsCommandOptions, command: Command) => {
      try {
        const format = listFormat(options.format);
        const tools = await runTools(configOption(options.config));
        const color = resolveColor(command.parent ?? command);
        process.stdout.write(`${renderTools(tools, format, { color })}\n`);
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
