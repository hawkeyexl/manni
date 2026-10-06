/**
 * The two family verbs, `manni check` and `manni status`, mounted on the
 * umbrella with `addCommand`. They are the only verbs it carries: each
 * orchestrates other domains' command cores and owns no checks of its own.
 *
 * Run by hand or in CI they follow the family contract: 0 clean, 1 errors, 2
 * operational, the report on stdout and notices on stderr. Under a Claude
 * Code hook envelope on stdin they speak the hook protocol instead, which
 * changes where output goes and what the exit code means, never what is
 * checked beyond the scope.
 */
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { shouldColor } from "../shared/color.js";
import { errorMessage } from "../shared/errors.js";
import { programName } from "../shared/program-name.js";
import { fail } from "../shared/run.js";
import { notice } from "../shared/warn.js";
import { readEnvelope, type Envelope } from "./core/envelope.js";
import { FamilyError, labelFrom } from "./core/in-play.js";
import {
  CHECK_FORMATS,
  EDIT_TOOLS,
  exitCodeFor,
  hookFailure,
  hookReply,
  render,
  runFamilyCheck,
  runTurnCheck,
  turnReply,
  type CheckFormat,
  type FamilyCheckRun,
  type HookReply,
  type Scope,
} from "./commands/check.js";
import {
  STATUS_FORMATS,
  agentLines,
  exportGeneratedBy,
  renderStatus,
  runStatus,
  type StatusFormat,
} from "./commands/status.js";

interface CheckCliOptions {
  config?: string;
  format: CheckFormat;
  /** `--no-color`: `false` when given. */
  color: boolean;
}

interface StatusCliOptions {
  config?: string;
  format: StatusFormat;
}

function send(reply: HookReply): void {
  if (reply.stdout !== undefined) process.stdout.write(reply.stdout);
  if (reply.stderr !== undefined) process.stderr.write(reply.stderr);
  process.exitCode = reply.exitCode;
}

/**
 * The file checks a hook asks for, or `undefined` when this event runs none.
 * A SubagentStop runs none: its subagent's turn is judged alone.
 */
export function hookScope(envelope: Envelope, cwd: string): { scope: Scope; file?: string } | undefined {
  if (envelope.event === "Stop") return { scope: { kind: "changed" } };
  if (envelope.event !== "PostToolUse") return undefined;
  if (envelope.toolName === undefined || !EDIT_TOOLS.includes(envelope.toolName)) return undefined;
  if (envelope.filePath === undefined) return undefined;
  const file = labelFrom(cwd, resolve(cwd, envelope.filePath));
  return { scope: { kind: "paths", paths: [file] }, file };
}

/** The events that end a turn, which tracevals judges (proposal 0079). */
const TURN_EVENTS: readonly string[] = ["Stop", "SubagentStop"];

async function checkUnderHook(paths: string[], options: CheckCliOptions, envelope: Envelope): Promise<void> {
  const cwd = resolve(envelope.cwd ?? process.cwd());
  // Positional paths win over the envelope's own scope.
  const asked: { scope: Scope; file?: string } | undefined =
    paths.length > 0 ? { scope: { kind: "paths", paths }, file: paths.join(", ") } : hookScope(envelope, cwd);
  const turnEvent = TURN_EVENTS.includes(envelope.event);
  if (asked === undefined && !turnEvent) return;
  let run: FamilyCheckRun | undefined;
  if (asked !== undefined) {
    try {
      run = await runFamilyCheck({
        cwd,
        scope: asked.scope,
        allowMissing: true,
        ...(options.config === undefined ? {} : { configPath: options.config }),
        // stdout and stderr are the hook's channels; a notice is not for the agent.
        onNotice: () => undefined,
      });
    } catch (err) {
      // Nothing set up for the file checks is not the end of a turn's judgement.
      if (!(err instanceof FamilyError && err.quiet) && !turnEvent) {
        send(hookFailure(errorMessage(err), envelope, asked.file));
        return;
      }
    }
  }
  if (!turnEvent) {
    if (run !== undefined) send(hookReply(run, envelope));
    return;
  }
  send(turnReply(run, await runTurnCheck(envelope, cwd), envelope));
}

export function buildCheck(): Command {
  return new Command("check")
    .description("Run every check this repository has set up, and nothing else")
    .argument("[paths...]", "files, directories, or globs; the per-file checks run on the collection members among them")
    .option("-c, --config <path>", "path to a manni config file")
    .addOption(
      new Option("-f, --format <format>", "output (not read under a hook)")
        .choices(CHECK_FORMATS)
        .default("pretty"),
    )
    .option("--no-color", "disable colored output")
    .showHelpAfterError("(add --help for usage)")
    .exitOverride()
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  manni check                       # every in-play check, the CI gate",
        "  manni check docs/limits.md        # per-file checks on one page",
        "  manni check -f github             # in a GitHub workflow",
        "  manni check docs/ -f json         # scripting form",
      ].join("\n"),
    )
    .action(async (paths: string[], options: CheckCliOptions) => {
      const envelope = await readEnvelope();
      if (envelope !== undefined) {
        await checkUnderHook(paths, options, envelope);
        return;
      }
      try {
        const run = await runFamilyCheck({
          scope: paths.length > 0 ? { kind: "paths", paths } : { kind: "all" },
          ...(options.config === undefined ? {} : { configPath: options.config }),
          onNotice: notice,
        });
        for (const check of run.checks) {
          if (check.status === "error") {
            process.stderr.write(`${programName()} ${check.command} could not run: ${check.message}\n`);
          }
        }
        const color = shouldColor({ noColor: !options.color, isTTY: process.stdout.isTTY });
        const text = render(run, options.format, color);
        if (text.length > 0) process.stdout.write(`${text}\n`);
        process.exitCode = exitCodeFor(run);
      } catch (err) {
        fail(err);
      }
    });
}

export function buildStatus(): Command {
  return new Command("status")
    .description("Say what is set up here, and so what manni check runs")
    .option("-c, --config <path>", "path to a manni config file")
    .addOption(
      new Option("-f, --format <format>", "output").choices(STATUS_FORMATS).default("pretty"),
    )
    .showHelpAfterError("(add --help for usage)")
    .exitOverride()
    .action(async (options: StatusCliOptions) => {
      const envelope = await readEnvelope();
      const configOption = options.config === undefined ? {} : { configPath: options.config };
      if (envelope?.event === "SessionStart") {
        try {
          const report = await runStatus({ cwd: resolve(envelope.cwd ?? process.cwd()), ...configOption });
          const lines = report.collections.length > 0 ? `\n\n${agentLines(report)}` : "";
          process.stdout.write(`${renderStatus(report, "pretty")}${lines}\n`);
          exportGeneratedBy(envelope);
        } catch {
          // No config, or one that cannot be read: the session starts without a word.
        }
        return;
      }
      try {
        const report = await runStatus(configOption);
        process.stdout.write(`${renderStatus(report, options.format)}\n`);
      } catch (err) {
        fail(err);
      }
    });
}
