/**
 * The `cite` domain's commander program. Mounted by `src/cli.ts` under
 * `manni cite`; no entry point of its own. Grammar per proposal 0034: verbs are
 * `check`, `add`, `update`; there is no default subcommand.
 *
 * Follows clig.dev as meta's does: primary output to stdout, diagnostics to
 * stderr, colour only on a TTY and never under `NO_COLOR`/`--no-color`, exit
 * `0` clean, `1` an error-severity finding, `2` operational/usage.
 */
import { Command, Option } from "commander";
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
import { terminalConfirm } from "../shared/prompt.js";
import { STDIN_LINES_MARKER, fail } from "../shared/run.js";
import { notice } from "../shared/warn.js";
import {
  COMMON_FORMAT_LIST,
  OMITTED_WHEN_CLEAN,
  REPORT_FORMAT_LIST,
  STDIN_TOKEN,
  isMachineFormat,
} from "../meta/internal.js";
import { REPORT_FORMATS, isReportFormat, render } from "../meta/index.js";
import { runAdd } from "./commands/add.js";
import { runCheck } from "./commands/check.js";
import { runUpdate } from "./commands/update.js";
import { CiteError } from "./errors.js";
import { spellSource } from "./core/range.js";
import { shortCommit, shortPin, shortSrc } from "./core/spell.js";
import { renderCheckGithub } from "./reporters/github.js";
import { renderCheckJson, renderUpdateJson } from "./reporters/json.js";
import { renderCheckPretty, renderUpdatePretty } from "./reporters/pretty.js";
import type { AddResult, PageLines } from "./types.js";

/** JUnit `classname` for the citation tool's findings. */
const JUNIT_CLASSNAME = "manni.cite";

const UPDATE_FORMATS = ["pretty", "json"] as const;
type UpdateFormat = (typeof UPDATE_FORMATS)[number];

/**
 * Whether `command`'s output gets colour: this domain's `--no-color` and
 * `NO_COLOR` turn it off, and otherwise only a TTY turns it on
 * (`shouldColor`). `isTTY` is passed uncoerced: Node leaves it undefined off
 * a terminal, never false, and `shouldColor` reads a missing one as "not a
 * terminal".
 */
export function colorFor(
  command: Command,
  isTTY: boolean | undefined,
  env?: NodeJS.ProcessEnv,
): boolean {
  // commander maps --no-color to opts.color === false, on the command that
  // declares it.
  const noColor = colorOwner(command).opts().color === false;
  return shouldColor({ noColor, isTTY, env });
}

/**
 * The nearest command, this one or an ancestor, that declares `--no-color`:
 * the `cite` program, wherever it is mounted. Not the root: under the
 * umbrella that is `manni`, which has no `--no-color` of its own.
 */
function colorOwner(command: Command): Command {
  for (let c: Command | null = command; c !== null; c = c.parent) {
    if (c.options.some((o) => o.long === "--no-color")) return c;
  }
  return command;
}

function isUpdateFormat(value: string): value is UpdateFormat {
  return (UPDATE_FORMATS as readonly string[]).includes(value);
}

/**
 * Commander hands an `.action()` callback an untyped bag of option values, so
 * each subcommand declares the shape it actually reads. The `--no-<thing>`
 * flags are `boolean` and never `undefined`: commander supplies `true` when
 * the flag is absent, which is its default and not a choice, so only the
 * explicit `false` travels to the core (`explicitFalse`).
 */
interface InputCliOptions {
  /** `--collection <name>`, repeatable; commander's default value is `[]`. */
  collection: string[];
  /** `--ext <list>`; the command splits it. */
  ext?: string;
  /** `--exclude <glob>`, repeatable; commander's default value is `[]`. */
  exclude: string[];
  /** `--as <format>`: force an extractor. */
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
  /** `--root <dir>`: where `src:` paths resolve from. */
  root?: string;
}

interface CheckCliOptions extends InputCliOptions {
  /** `-f, --format <format>`. Always a string: the declaration has a default. */
  format: string;
  quiet?: boolean;
  /**
   * `--baseline [path]` / `--no-baseline`, the same three-state split as
   * `config`: absent leaves the config in charge, a string names a file, `true`
   * is a bare `--baseline` (the default path), `false` is `--no-baseline`.
   */
  baseline?: string | boolean;
  /** `--write-baseline [path]`; `true` for the bare flag. */
  writeBaseline?: string | boolean;
  /** `--no-check-sources`. */
  checkSources: boolean;
  showDiff?: boolean;
  reveal?: boolean;
}

interface AddCliOptions {
  id?: string;
  marker?: boolean;
  quote?: boolean;
  /** `--encrypt`. */
  encrypt?: boolean;
  /** `--no-commit-sha`. */
  commitSha: boolean;
  dryRun?: boolean;
  as?: string;
  root?: string;
  config?: string | boolean;
}

interface UpdateCliOptions extends InputCliOptions {
  /** `--no-check-sources`: declared so the refusal names the flag rather than commander rejecting it. */
  checkSources: boolean;
  accept?: boolean;
  /** `--only <id>`, repeatable; commander's default value is `[]`. */
  only: string[];
  dryRun?: boolean;
  format: string;
}

/**
 * Split `docs/limits.md:9` or `docs/limits.md:14-18` into the page and the
 * claim's lines. Only a trailing `:L` or `:L1-L2` is read as lines, so a path
 * that carries a colon keeps it, and `-:9` still reads the page from stdin.
 */
export function splitPageArgument(arg: string): { page: string; lines?: PageLines } {
  // `-:9` reaches commander as an operand only after the bin rewrites its
  // leading `-`; both spellings name stdin and the same lines.
  const text = arg.startsWith(STDIN_LINES_MARKER)
    ? `${STDIN_TOKEN}${arg.slice(STDIN_LINES_MARKER.length)}`
    : arg;
  const m = /:([1-9][0-9]*)(?:-([1-9][0-9]*))?$/.exec(text);
  const head = m === null ? text : text.slice(0, m.index);
  if (m === null || head === "") return { page: arg };
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  if (end < start) {
    throw new CiteError(`Invalid range "${arg}": end line ${end} is before start line ${start}.`);
  }
  return { page: head, lines: { start, end } };
}

/** `line 9`, or `lines 14-18` for a range. */
function spellAt(lines: PageLines, noun = "line"): string {
  return lines.start === lines.end
    ? `${noun} ${String(lines.start)}`
    : `${noun}s ${String(lines.start)}-${String(lines.end)}`;
}

/**
 * What `add` says on success. One sentence composed from the result: what was
 * added, where it went, and what each end is pinned to. Lines are the page's
 * own, after the write. The source is spelled as it was written to the page,
 * abbreviated when it is a ciphertext.
 */
export function addMessage(result: AddResult): string {
  const { citation, claimLines } = result;
  const claim = citation.claim;
  const name = citation.id ?? (claim === undefined ? "a bare pin" : "an entry");
  const src = shortSrc(spellSource(citation.source));
  const commit = citation.source["commit-sha"];
  const pin = `${src}, ${shortPin(citation.source.integrity)}, ${commit === undefined ? "no commit" : shortCommit(commit)}`;
  const head = `${result.file}: added ${name} to frontmatter`;

  if (result.markerLine !== undefined) {
    const at =
      claimLines === undefined ? "" : `, claim pinned at line ${String(claimLines.start)}`;
    return `${head}; marker at line ${String(result.markerLine)}${at}`;
  }
  if (claim === undefined || claimLines === undefined) {
    return `${head} (source ${pin})`;
  }
  if (citation.quote === true) {
    return `${head} (claim ${spellAt(claimLines, "line")}, a block that reproduces ${src})`;
  }
  return `${head} (claim at ${spellAt(claimLines)}, ${shortPin(claim.integrity)}; source ${pin})`;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("cite")
    .description(
      "Track citations from doc claims to source lines and check them for drift.",
    )
    .version(pkg.version, "-V, --version")
    .option("--no-color", "disable colored output")
    // A pointer, not the whole help screen: the message that precedes it
    // already names the offending flag.
    .showHelpAfterError("(add --help for usage)")
    // MUST come before the `.command()` calls below. `copyInheritedSettings`
    // copies `_exitCallback` by value at subcommand-creation time, so an
    // `exitOverride()` installed afterwards leaves every subcommand still
    // calling `process.exit(1)`.
    .exitOverride();

  program
    .command("check")
    .description("Check every citation in the given pages against its source")
    .argument(
      "[paths...]",
      "files, directories, or globs to check (use - for stdin)",
    )
    .option(
      "--collection <name>",
      "configured collection to run over; repeatable",
      collect,
      [],
    )
    .option("--ext <list>", "comma-separated extensions for directory walks")
    .option("--exclude <glob>", "glob to exclude; repeatable", collect, [])
    .option("--as <format>", "force an input format for every input")
    .option(
      "-f, --format <format>",
      `output: ${REPORT_FORMATS.join(" | ")}`,
      "pretty",
    )
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
    .option("-q, --quiet", "in pretty output, hide current citations and clean files")
    .option("--allow-empty", "treat zero matched files as success")
    .option("--no-gitignore", "check files .gitignore covers")
    // No `defaultValue` and no `.preset()`, for the reasons meta's validate
    // gives: a bare flag must stay distinguishable from a typed path.
    .addOption(
      new Option(
        "--baseline [path]",
        "compare against a baseline; fail only on findings not in it",
      ),
    )
    .addOption(
      new Option(
        "--write-baseline [path]",
        "record current findings as the baseline, then exit 0",
      ),
    )
    .option("--no-baseline", "ignore a baseline configured by `baseline:`")
    .option("--no-check-sources", "page-side rules only; every source status is skipped")
    .option(
      "--root <dir>",
      "directory src: paths resolve from (default: cite.root from config, else the git root, else the current directory)",
    )
    .option("--show-diff", "in pretty output, print the diff and commit subjects for changed")
    .option("--reveal", "in pretty output, print the decrypted path beside an encrypted source")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni cite check docs/                          # walk a directory",
        "  manni cite check --collection guides             # one configured collection",
        '  manni cite check "docs/**/*.md" -f github        # CI annotations',
        "  manni cite check --show-diff docs/limits.md      # see what changed",
        "  manni cite check --baseline                      # fail only on new findings",
        "  cat page.md | manni cite check - --as markdown",
      ].join("\n"),
    )
    .action(async (paths: string[], options: CheckCliOptions, command: Command) => {
      try {
        const format = options.format;
        if (!isReportFormat(format)) {
          throw new CiteError(
            `Unknown --format "${format}". Use ${REPORT_FORMAT_LIST}.`,
          );
        }
        const exts = options.ext ? splitList(options.ext) : undefined;
        const stdinContent = paths.includes(STDIN_TOKEN) ? await readStdin() : undefined;
        const cwd = process.cwd();

        const run = await runCheck({
          inputs: paths,
          collection: options.collection,
          exts,
          exclude: options.exclude,
          as: options.as,
          ...configOption(options.config),
          onConfigLoaded: reportConfig(!isMachineFormat(format), cwd),
          stdinContent,
          // `undefined` rather than `false` when absent, so config still wins.
          allowEmpty: options.allowEmpty ? true : undefined,
          respectGitignore: explicitFalse(options.gitignore),
          onNotice: notice,
          baseline: options.baseline,
          writeBaseline: options.writeBaseline,
          checkSources: explicitFalse(options.checkSources),
          // Only so the run can say git is not there to give diffs; the diffs
          // themselves are the pretty reporter's.
          showDiff: options.showDiff ? true : undefined,
          root: options.root,
        });

        let text: string;
        switch (format) {
          case "pretty":
            text = renderCheckPretty(run, {
              color: colorFor(command, process.stdout.isTTY),
              quiet: Boolean(options.quiet),
              showDiff: Boolean(options.showDiff),
              reveal: Boolean(options.reveal),
            });
            break;
          case "json":
            text = renderCheckJson(run);
            break;
          case "github":
            text = renderCheckGithub(run);
            break;
          default:
            // sarif and junit ride meta's renderers over the adapted results:
            // same rule ids, same fingerprints, same envelope.
            text = render(format, run.results, run.summary, {
              frame: run.frame,
              classname: JUNIT_CLASSNAME,
              onNotice: notice,
            });
        }
        // Only `github` may say nothing on a clean run; every other format
        // owes its envelope even when empty.
        if (text.length > 0 || !OMITTED_WHEN_CLEAN.has(format)) {
          process.stdout.write(`${text}\n`);
        }
        // `failed` counts files with an unbaselined error-severity finding;
        // warnings never move it.
        process.exitCode = run.summary.failed > 0 ? 1 : 0;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("add")
    .description("Mint a citation for a source range and write it to a page")
    .argument(
      "<page>",
      "the page to cite from, with the claim's lines: page:L or page:L1-L2 (use - for stdin, with --as)",
    )
    .argument(
      "<src>",
      "path, path:L or path:L1-L2 relative to --root, or an encrypted ~source with the same line forms",
    )
    .option("--id <id>", "kebab-case id, unique on the page; required with --marker")
    .option("--marker", "write a cite <id> marker above the page lines and pin the text it anchors")
    .option("--quote", "the page lines are a fenced block that reproduces the source")
    .option(
      "--encrypt",
      "write source.file encrypted, with an hmac-sha256- pin; with no key, offer to create one (an available key encrypts without the flag)",
    )
    .option("--no-commit-sha", "do not record HEAD")
    .option("--dry-run", "print the diff; write nothing")
    .option("--as <format>", "force the page format")
    .option("--root <dir>", "directory source paths resolve from (as check)")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni cite add docs/limits.md:9 lib/limits.ts:2 --id fetch-timeout",
        "  manni cite add docs/limits.md:30 lib/limits.ts:8-12 --id timeouts --marker",
        "  manni cite add docs/limits.md:14-18 lib/limits.ts:1-3 --quote",
        "  manni cite add docs/limits.md lib/limits.ts --dry-run",
        "  cat page.md | manni cite add -:9 lib/limits.ts:2 --as markdown > out.md",
      ].join("\n"),
    )
    .action(async (pageArgument: string, src: string, options: AddCliOptions) => {
      try {
        const { page, lines } = splitPageArgument(pageArgument);
        const usingStdin = page === STDIN_TOKEN;
        const stdinContent = usingStdin ? await readStdin() : undefined;
        const dryRun = Boolean(options.dryRun);
        const cwd = process.cwd();

        const result = await runAdd({
          page,
          pageLines: lines,
          src,
          id: options.id,
          marker: options.marker ? true : undefined,
          quote: options.quote ? true : undefined,
          // `undefined` when absent, so the key decides: an available one
          // encrypts without the flag.
          encrypt: options.encrypt ? true : undefined,
          commitSha: explicitFalse(options.commitSha),
          dryRun,
          as: options.as,
          ...configOption(options.config),
          // With `-` the page owns stdout; so does the diff under --dry-run.
          onConfigLoaded: reportConfig(!usingStdin && !dryRun, cwd),
          stdinContent,
          root: options.root,
          onNotice: notice,
          // Only on a terminal: off one, a missing key is a refusal, not a
          // question nobody can answer. With `-` stdin is the page, so no
          // question is put either.
          confirm: terminalConfirm(),
        });

        const message = addMessage(result);
        if (usingStdin) {
          // The rewritten page owns stdout; everything else is a diagnostic.
          process.stdout.write(result.content);
          if (dryRun && result.diff.length > 0) process.stderr.write(`${result.diff}\n`);
          process.stderr.write(`${message}\n`);
        } else if (dryRun) {
          if (result.diff.length > 0) process.stdout.write(`${result.diff}\n`);
          process.stderr.write(`${message}\n`);
        } else {
          process.stdout.write(`${message}\n`);
        }
        process.exitCode = 0;
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("update")
    .description("Rewrite moved citations in place; with --accept, re-mint changed ones")
    .argument(
      "[paths...]",
      "files, directories, or globs to update (use - for stdin)",
    )
    .option(
      "--collection <name>",
      "configured collection to run over; repeatable",
      collect,
      [],
    )
    .option("--ext <list>", "comma-separated extensions for directory walks")
    .option("--exclude <glob>", "glob to exclude; repeatable", collect, [])
    .option("--as <format>", "force an input format for every input")
    .option("-c, --config <path>", "path to a manni config file")
    .option("--no-config", "ignore any discovered config file")
    .option("--allow-empty", "treat zero matched files as success")
    .option("--no-gitignore", "update files .gitignore covers")
    .option("--no-check-sources", "refused: update needs the sources")
    .option("--root <dir>", "directory src: paths resolve from (as check)")
    .option("--accept", "re-mint changed and never-true entries at HEAD; prints old and new pins")
    .option("--only <id>", "limit to entries with this id; repeatable", collect, [])
    .option("--dry-run", "print the diffs; write nothing")
    .option(
      "-f, --format <format>",
      `output: ${UPDATE_FORMATS.join(" | ")}`,
      "pretty",
    )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni cite update docs/                          # rewrite moved entries",
        "  manni cite update --accept --only fetch-timeout docs/limits.md",
        "  manni cite update --dry-run docs/               # see the diffs first",
      ].join("\n"),
    )
    .action(async (paths: string[], options: UpdateCliOptions, command: Command) => {
      try {
        const format = options.format;
        if (!isUpdateFormat(format)) {
          throw new CiteError(
            `Unknown --format "${format}". Use ${COMMON_FORMAT_LIST}.`,
          );
        }
        if (!options.checkSources) {
          throw new CiteError(
            "update needs the sources: drop --no-check-sources (or `checkSources: false`).",
          );
        }
        const exts = options.ext ? splitList(options.ext) : undefined;
        const usingStdin = paths.includes(STDIN_TOKEN);
        const stdinContent = usingStdin ? await readStdin() : undefined;
        const dryRun = Boolean(options.dryRun);
        // With `-` the rewritten page owns stdout, as it does for `add -`; a
        // dry run prints the diffs instead, so the report keeps stdout.
        const pageToStdout = usingStdin && !dryRun;
        const cwd = process.cwd();

        const run = await runUpdate({
          inputs: paths,
          collection: options.collection,
          exts,
          exclude: options.exclude,
          as: options.as,
          ...configOption(options.config),
          onConfigLoaded: reportConfig(format === "pretty" && !pageToStdout, cwd),
          stdinContent,
          allowEmpty: options.allowEmpty ? true : undefined,
          respectGitignore: explicitFalse(options.gitignore),
          onNotice: notice,
          root: options.root,
          accept: options.accept ? true : undefined,
          only: options.only.length > 0 ? options.only : undefined,
          dryRun,
        });

        const text =
          format === "json"
            ? renderUpdateJson(run)
            : renderUpdatePretty(run, {
                color: colorFor(command, process.stdout.isTTY),
                // The diffs are the point of a dry run; a real run prints
                // what it rewrote and leaves the file to say the rest.
                showDiff: dryRun,
              });
        const stdinPage = pageToStdout ? run.pages.find((page) => page.content !== undefined) : undefined;
        if (stdinPage?.content !== undefined) {
          process.stdout.write(stdinPage.content);
          process.stderr.write(`${text}\n`);
        } else {
          process.stdout.write(`${text}\n`);
        }
        // Exit 1 when something was skipped with an error-severity finding:
        // work left undone, `fill`'s precedent.
        process.exitCode = run.exitCode;
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
