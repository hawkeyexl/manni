/**
 * The lint program. Named `lint` because that is where it is mounted
 * (`manni lint …`); `src/cli.ts` adds it to the umbrella and runs it. Thin
 * commander wrapper over the command cores. Follows clig.dev: primary output to
 * stdout, diagnostics to stderr, color only on a TTY (and never under
 * NO_COLOR/--no-color), meaningful exit codes.
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
import { fail } from "../shared/run.js";
import { MooseLintError } from "./types.js";
import { runLint } from "./commands/lint.js";
import { runTemplates } from "./commands/templates.js";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { loadConfig, type LintConfig } from "./core/config.js";
import { refRelativeTo } from "./core/template-registry.js";
import { runFormats } from "./commands/formats.js";
import {
  render,
  renderFormats,
  renderTemplates,
  type ListFormat,
  type ReportFormat,
} from "./reporters/index.js";
import { shouldColor } from "./reporters/color.js";

/** What commander parses for the default `lint` command. */
interface LintCommandOptions {
  template?: string;
  templates?: string[];
  config?: string;
  explain?: boolean;
  as?: string;
  exclude?: string[];
  format: string;
}

/** What commander parses for `templates`. */
interface TemplatesCommandOptions {
  templates?: string[];
  config?: string;
  format: string;
}

/** What commander parses for `formats`. */
interface FormatsCommandOptions {
  format: string;
}

// `explain` is reachable through `--explain`, not `-f`: it reports on
// configuration rather than on documents, and offering it as a format would
// invite `-f explain` alongside a lint that then never happens.
const REPORT_FORMATS = new Set<string>(["pretty", "json", "github", "sarif"]);
const LIST_FORMATS = new Set<string>(["pretty", "json"]);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

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
 * Re-base everything a config declares against the config file's own directory.
 *
 * `loadConfig` returns the file's `path` precisely so this can happen, and
 * discarding it made the same config mean different things depending on where
 * the tool was invoked from. Running from a subdirectory turned `templates:`
 * into "file not found" and `paths:` into "nothing to lint" - and turned
 * `overrides:` into nothing at all, silently: the glob stopped matching, every
 * page fell through to its own `type`, and the run exited 0 having applied none
 * of the repo's policy.
 *
 * Refs go through `refRelativeTo`, which leaves built-in ids, URLs, and
 * absolute paths alone. Globs become absolute, which is what `runLint` matches
 * them against.
 */
function rebaseConfig(
  found: { config: LintConfig; path: string } | null,
): LintConfig {
  if (!found) return {};
  const dir = dirname(resolvePath(found.path));
  const config = found.config;

  const ref = (value: string): string => refRelativeTo(found.path, value);
  // Every non-absolute glob is relative to the config, `**/*.md` included.
  // Exempting a leading `**` left the original bug half-open: from a
  // subdirectory that pattern expanded against the working directory, so a run
  // checked a subset of the configured docset and still exited 0.
  const glob = (value: string): string =>
    isAbsolute(value) ? value : resolvePath(dir, value).replace(/\\/g, "/");

  return {
    ...config,
    ...(config.paths ? { paths: config.paths.map(glob) } : {}),
    ...(config.exclude ? { exclude: config.exclude.map(glob) } : {}),
    ...(config.templates ? { templates: config.templates.map(ref) } : {}),
    ...(config.template ? { template: ref(config.template) } : {}),
    ...(config.types
      ? {
          types: Object.fromEntries(
            Object.entries(config.types).map(([type, value]) => [
              type,
              ref(value),
            ]),
          ),
        }
      : {}),
    ...(config.overrides
      ? {
          overrides: config.overrides.map((o) => ({
            files: glob(o.files),
            template: ref(o.template),
          })),
        }
      : {}),
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

  program
    .command("lint", { isDefault: true })
    .description(
      "Lint the given files/dirs/globs, routing each page by its `type` frontmatter",
    )
    .argument(
      "[paths...]",
      "files, directories, or globs to lint (use - for stdin)",
    )
    .option(
      "-t, --template <ref>",
      "apply this template to every file, overriding type routing",
    )
    .option(
      "--templates <path...>",
      "template files to route by: their `types:` win over built-ins; repeatable",
    )
    .option("-c, --config <path>", "path to manni.config.yaml")
    .option(
      "--explain",
      "print how each file's template was chosen, and lint nothing (always exits 0, unrouted pages included)",
    )
    .option("--as <format>", "force an input format (e.g. markdown, mdx)")
    .option(
      "--exclude <glob...>",
      "globs to exclude from directory/glob expansion; repeatable",
    )
    .option(
      "-f, --format <format>",
      "output: pretty | json | github | sarif",
      "pretty",
    )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni lint docs/                               # route each page by its `type`",
        "  manni lint docs/ --templates ./templates.yaml  # add your own templates",
        "  manni lint                                     # targets from manni.config.yaml",
        "  manni lint docs/ --explain                     # show why each page routed where",
        "  manni lint page.md -t tgdp:how-to:1.6          # force one template",
        '  manni lint "**/*.md" -f github                 # CI annotations',
        "  manni lint docs/ --exclude '**/drafts/**'",
        "  cat page.md | manni lint - -t tgdp:how-to:1.6 --as markdown",
      ].join("\n"),
    )
    .action(async (paths: string[], options: LintCommandOptions, command: Command) => {
      try {
        const format = reportFormat(options.format);
        const stdinContent = paths.includes("-")
          ? await readStdin()
          : undefined;

        const explain = options.explain === true;
        // Config is read here rather than inside the command core, so that
        // `runLint` stays a pure function of the options it is handed and a
        // library caller is never surprised by a file on disk.
        const found = await loadConfig(options.config);
        const config = rebaseConfig(found);

        const run = await runLint({
          // Positional paths win; `paths:` is the fallback that lets CI run a
          // bare `manni lint`.
          inputs: paths.length > 0 ? paths : (config.paths ?? []),
          template: options.template,
          templates: options.templates ?? config.templates,
          as: options.as,
          // Excludes accumulate rather than replace: a flag narrows a run
          // further, it does not discard the repo's standing exclusions.
          exclude: [...(config.exclude ?? []), ...(options.exclude ?? [])],
          types: config.types,
          overrides: config.overrides,
          // `template:` in config is the default for a page that declares no
          // type - the bottom of the chain, not the top. `--template` is the top.
          defaultTemplate: config.template,
          explain,
          stdinContent,
        });

        const color = resolveColor(command.parent ?? command);
        const text = render(run, explain ? "explain" : format, { color });
        if (text.length > 0) process.stdout.write(`${text}\n`);
        // `--explain` answers a question about configuration, so its exit code
        // reports whether it could answer it - not whether the docs are clean.
        //
        // That covers routing failures too: a page whose `type` matches no
        // template is a answered question, not an unanswered one, so it exits
        // 0 like everything else here. Automation must not read this code as
        // "everything routed" - the ordinary run is what reports that, with
        // exit 1. Said in `--help` and the README, because the distinction is
        // invisible from the exit code alone.
        process.exitCode = explain ? 0 : run.summary.failed > 0 ? 1 : 0;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("templates")
    .description("List the templates that can be applied, and the types they serve")
    .option("--templates <path...>", "also list the templates in these files")
    .option("-c, --config <path>", "path to manni.config.yaml")
    .option("-f, --format <format>", "output: pretty | json", "pretty")
    .action(async (options: TemplatesCommandOptions, command: Command) => {
      try {
        const format = listFormat(options.format);
        // The listing answers "what could route a page?", so it has to see the
        // same template files a lint would.
        const found = await loadConfig(options.config);
        const info = await runTemplates({
          // Rebased for the same reason the lint path is: this command answers
          // "what could route a page?", so it must resolve the config's
          // template paths exactly as a lint would.
          templates: options.templates ?? rebaseConfig(found).templates,
        });
        const color = resolveColor(command.parent ?? command);
        process.stdout.write(`${renderTemplates(info, format, { color })}\n`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("formats")
    .description("List the registered input formats, implemented or planned")
    .option("-f, --format <format>", "output: pretty | json", "pretty")
    .action((options: FormatsCommandOptions, command: Command) => {
      try {
        const format = listFormat(options.format);
        const color = resolveColor(command.parent ?? command);
        process.stdout.write(
          `${renderFormats(runFormats(), format, { color })}\n`,
        );
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
