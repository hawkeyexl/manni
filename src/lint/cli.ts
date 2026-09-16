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
 *      input. A MooseLintError is always this, never a lint failure.
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
import { fail } from "../shared/run.js";
import { notice } from "../shared/warn.js";
import { STDIN_TOKEN } from "../meta/internal.js";
import { MooseLintError } from "./types.js";
import { runLint } from "./commands/lint.js";
import { runTemplates } from "./commands/templates.js";
import { runTools } from "./commands/tools.js";
import { LINT_JOBS, TOOLS_BY_JOB, loadConfig, rebaseConfig } from "./core/config.js";
import {
  render,
  renderTemplates,
  renderTools,
  type ListFormat,
  type ReportFormat,
} from "./reporters/index.js";
import { shouldColor } from "./reporters/color.js";

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

/** What commander parses for `tools`. */
interface ToolsCommandOptions {
  config?: string | boolean;
  format: string;
}

// `explain` is reachable through `--explain`, not `-f`: it reports on
// configuration rather than on documents, and offering it as a format would
// invite `-f explain` alongside a lint that then never happens.
const REPORT_FORMATS = new Set<string>(["pretty", "json", "github", "sarif"]);
const LIST_FORMATS = new Set<string>(["pretty", "json"]);

/** The heading the tool's own options print under, after the shared ones. */
const TOOL_OPTIONS_GROUP = "Tool options:";

function resolveColor(program: Command): boolean {
  // commander maps --no-color to opts.color === false.
  const noColor = program.opts().color === false;
  return shouldColor({ noColor, isTTY: process.stdout.isTTY });
}

function reportFormat(value: unknown): ReportFormat {
  const format = String(value);
  if (!REPORT_FORMATS.has(format)) {
    throw new MooseLintError(
      `Unknown --format "${format}". Use pretty, json, github, or sarif.`,
    );
  }
  return format as ReportFormat;
}

function listFormat(value: unknown): ListFormat {
  const format = String(value);
  if (!LIST_FORMATS.has(format)) {
    throw new MooseLintError(
      `Unknown --format "${format}". Use pretty or json.`,
    );
  }
  return format as ListFormat;
}

/**
 * `--tool <name>`: which tool performs a job. Refused by name rather than
 * ignored, because falling through to manni's engine would lint with something
 * other than what was asked for and say nothing.
 */
function assertTool(job: "structure", value: string | undefined): void {
  const tools = TOOLS_BY_JOB[job];
  if (value === undefined || (tools as readonly string[]).includes(value)) return;
  throw new MooseLintError(
    `Unknown --tool "${value}" for ${job}. Use ${tools.join(", ")}.`,
  );
}

/** The options every job verb takes, in one place so the two cannot drift. */
function withInputOptions(command: Command): Command {
  return command
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
      "output: pretty | json | github | sarif",
      "pretty",
    )
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
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
    const text = render(run, explain ? "explain" : format, { color });
    if (text.length > 0) process.stdout.write(`${text}\n`);
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
    .option("--tool <name>", "tool that performs the job: manni")
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
          assertTool("structure", options.tool);
          await lint(paths, options, command, { tool: options });
        } catch (err) {
          fail(err);
        }
      },
    );

  program
    .command("templates")
    .description("List the templates that can be applied, and the types they serve")
    .option(
      "--templates <path>",
      "also list the templates in this file; repeatable",
      collect,
      [],
    )
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
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

  program
    .command("tools")
    .description("List the lint jobs, the tool that performs each, and what it reads")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
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
