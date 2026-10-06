/**
 * `manni check`: every check the repository has set up, and nothing else.
 *
 * It owns no checks. Each one is a domain's own command core, run in process
 * with the family config handed to it, and each report is that domain's own
 * reporter's output. What this adds is the choice of what runs (`in-play.ts`),
 * the scope, and one verdict over all of it.
 *
 * Scope:
 *
 * - `all`: every in-play check over every collection, per-file and set-wide.
 *   Each domain runs bare, exactly as its own CI step would.
 * - `paths`: the per-file checks on the collection members among the paths.
 * - `changed`: the per-file checks on the git working tree's changes, plus
 *   `cite` set-wide. `term` runs set-wide too when a collection document
 *   changed or was removed. `graph` never runs here; only `all` checks it.
 *   A clean tree runs nothing.
 *
 * `cite` is per-file on paths and set-wide otherwise: a source edit can drift
 * any page's citation, so after a session the whole set is what is checked.
 */
import { basename, extname, resolve } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import { ToolError, errorMessage } from "../../shared/errors.js";
import { warn } from "../../shared/warn.js";
import { resolveTargetSet } from "../../meta/internal.js";
import { supportedExtensions } from "../../meta/extractors/index.js";
import type { TurnCheckInput, TurnCheckResult } from "../../tracevals/commands/check.js";
import { changedFiles } from "../core/changed.js";
import { sayOnce } from "../core/said-once.js";
import type { Envelope } from "../core/envelope.js";
import {
  COMMANDS,
  DOMAINS,
  META_DEFAULTS_ONLY,
  NOT_SET_UP,
  collectionsOf,
  labelFrom,
  listMembers,
  loadFamily,
  nothingSetUpError,
  plural,
  type Domain,
  type Family,
} from "../core/in-play.js";
import { withSharedWalks } from "../../meta/core/load-files.js";

export const CHECK_FORMATS = ["pretty", "json", "github"] as const;
export type CheckFormat = (typeof CHECK_FORMATS)[number];

export type Scope =
  | { kind: "all" }
  | { kind: "paths"; paths: string[] }
  | { kind: "changed" };

export interface FamilyCheckOptions {
  /** Where paths resolve and the domains run. Default `process.cwd()`. */
  cwd?: string;
  /** `-c, --config`. */
  configPath?: string;
  scope: Scope;
  /**
   * Leave out a named path that does not exist, rather than failing on it. A
   * hook names a file the edit may have just removed.
   */
  allowMissing?: boolean;
  /** Diagnostics: the outside-every-collection notice, and the domains' own. */
  onNotice?: (message: string) => void;
}

/** A check that ran. `render` is the domain's own reporter. */
export interface RanCheck {
  command: string;
  status: "pass" | "fail";
  render: (format: CheckFormat, color: boolean) => string;
}

/** A check that did not run: not in play, or it could not. */
export interface NotRunCheck {
  command: string;
  status: "skipped" | "error";
  message: string;
}

export type CheckOutcome = RanCheck | NotRunCheck;

export interface FamilyCheckRun {
  status: "pass" | "fail";
  /** The collection members the per-file checks covered, labelled from `cwd`. */
  files: string[];
  checks: CheckOutcome[];
}

type Outcome =
  | { skipped: string }
  | { failed: boolean; render: (format: CheckFormat, color: boolean) => string };

interface Context {
  family: Family;
  cwd: string;
  /** The per-file inputs, or `[]` for a bare run over the collections. */
  inputs: string[];
  onNotice: (message: string) => void;
}

/**
 * Each domain's command core and reporter are imported where it runs: a hook
 * checks one page with four domains, and the other two (the RDF stack among
 * them) are worth not loading.
 */
async function runDomain(domain: Domain, ctx: Context): Promise<Outcome> {
  const { family, cwd, inputs, onNotice } = ctx;
  const configPath = family.configPath;
  switch (domain) {
    case "meta": {
      const [{ runValidate }, { render: renderMeta }] = await Promise.all([
        import("../../meta/commands/validate.js"),
        import("../../meta/reporters/index.js"),
      ]);
      const run = await runValidate({ inputs, configPath, cwd, skipDefaultOnly: true, onNotice });
      if (run.results.length === 0) {
        return { skipped: family.sections.has("meta") ? META_DEFAULTS_ONLY : NOT_SET_UP.meta };
      }
      return {
        failed: run.summary.failed > 0,
        render: (format, color) =>
          renderMeta(format, run.results, run.summary, { color, quiet: true, frame: run.frame, onNotice }),
      };
    }
    case "cite": {
      const [{ runCheck: runCite }, { renderCheckPretty: citePretty }, { renderCheckJson: citeJson }, { renderCheckGithub: citeGithub }] =
        await Promise.all([
          import("../../cite/commands/check.js"),
          import("../../cite/reporters/pretty.js"),
          import("../../cite/reporters/json.js"),
          import("../../cite/reporters/github.js"),
        ]);
      const run = await runCite({ inputs, configPath, cwd, onNotice });
      if (!run.pages.some((p) => p.citations.length > 0 || p.findings.length > 0)) {
        return { skipped: NOT_SET_UP.cite };
      }
      return {
        failed: run.summary.failed > 0,
        render: (format, color) =>
          format === "json"
            ? citeJson(run)
            : format === "github"
              ? citeGithub(run)
              : citePretty(run, { color, quiet: true }),
      };
    }
    case "lint": {
      if (!family.sections.has("lint")) return { skipped: NOT_SET_UP.lint };
      const [{ runLint }, { render: renderLint }] = await Promise.all([
        import("../../lint/commands/lint.js"),
        import("../../lint/reporters/index.js"),
      ]);
      const run = await runLint({ inputs, configPath, cwd, onNotice });
      return {
        failed: run.summary.failed > 0,
        render: (format, color) => renderLint(run, format, { color }),
      };
    }
    case "docevals": {
      const [{ runRun: runDocevals }, { render: renderDocevals }, { DocevalsError }] = await Promise.all([
        import("../../docevals/commands/run.js"),
        import("../../docevals/reporters/index.js"),
        import("../../docevals/types.js"),
      ]);
      let report;
      try {
        report = await runDocevals(inputs, {
          config: configPath,
          cwd,
          deterministicOnly: true,
          generate: false,
          execution: false,
          toolVersion: pkg.version,
        });
      } catch (err) {
        if (err instanceof DocevalsError && err.code === "nothing-resolved") {
          return { skipped: NOT_SET_UP.docevals };
        }
        throw err;
      }
      return {
        failed: report.exitCode !== 0,
        render: (format, color) => renderDocevals(report, format, { color }),
      };
    }
    case "term": {
      const [{ runCheck: runTerm }, { renderFindingsPretty: termPretty }, { renderFindingsJson: termJson }, { renderFindingsGithub: termGithub }] =
        await Promise.all([
          import("../../term/commands/check.js"),
          import("../../term/reporters/pretty.js"),
          import("../../term/reporters/json.js"),
          import("../../term/reporters/github.js"),
        ]);
      const report = await runTerm({ inputs, configPath, cwd, allowEmpty: true, onNotice });
      if (report.terms === 0) return { skipped: NOT_SET_UP.term };
      return {
        failed: report.summary.failed > 0,
        render: (format, color) =>
          format === "json"
            ? termJson(report)
            : format === "github"
              ? termGithub(report)
              : termPretty(report, { color, references: true }),
      };
    }
    case "graph": {
      if (!family.sections.has("graph")) return { skipped: NOT_SET_UP.graph };
      const [{ buildGraph }, { runCheck: runGraph, renderCheck: renderGraph }] = await Promise.all([
        import("../../graph/commands/build.js"),
        import("../../graph/commands/check.js"),
      ]);
      const built = await buildGraph({ config: configPath, cwd });
      for (const warning of built.warnings) onNotice(warning);
      const report = await runGraph({ config: configPath, cwd, turtle: built.turtle });
      return {
        failed: report.exitCode !== 0,
        render: (format) => renderGraph(report, format),
      };
    }
  }
}

async function outcome(domain: Domain, ctx: Context): Promise<CheckOutcome> {
  const command = COMMANDS[domain];
  try {
    const result = await runDomain(domain, ctx);
    if ("skipped" in result) return { command, status: "skipped", message: result.skipped };
    return { command, status: result.failed ? "fail" : "pass", render: result.render };
  } catch (err) {
    return { command, status: "error", message: errorMessage(err) };
  }
}

/** A hook or a git status names files by any extension; a walk keeps the documents. */
function isDocument(label: string): boolean {
  return supportedExtensions().includes(extname(label).toLowerCase());
}

/** Every domain walks the same collections, so the run shares one walk per target set. */
export function runFamilyCheck(opts: FamilyCheckOptions): Promise<FamilyCheckRun> {
  return withSharedWalks(() => checkUnshared(opts));
}

async function checkUnshared(opts: FamilyCheckOptions): Promise<FamilyCheckRun> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const onNotice = opts.onNotice ?? ((): void => undefined);
  const family = await loadFamily(cwd, opts.configPath);
  if (family.collections.length === 0) throw nothingSetUpError();
  const isMember = (label: string): boolean => collectionsOf(family, cwd, label).length > 0;

  let files: string[];
  let domains: Domain[];
  let inputs: string[];
  switch (opts.scope.kind) {
    case "all":
      files = await listMembers(family, cwd);
      inputs = [];
      domains = [...DOMAINS];
      break;
    case "paths": {
      const { files: named } = await resolveTargetSet({
        inputs: opts.scope.paths,
        cwd,
        ...(opts.allowMissing === true ? { allowEmpty: true } : {}),
      });
      const outside = named.filter((label) => !isMember(label));
      if (outside.length > 0) {
        onNotice(`Skipped ${plural(outside.length, "file")} outside every collection: ${outside.join(", ")}`);
      }
      // A collection globbed wide holds assets too; only documents are checked.
      files = named.filter((label) => isMember(label) && isDocument(label));
      inputs = files;
      domains = files.length > 0 ? ["meta", "cite", "lint", "docevals"] : [];
      break;
    }
    case "changed": {
      const changed = await changedFiles(cwd);
      if (!changed.dirty) return { status: "pass", files: [], checks: [] };
      const memberDocuments = (paths: string[]): string[] =>
        paths.map((path) => labelFrom(cwd, path)).filter((l) => isDocument(l) && isMember(l));
      files = memberDocuments(changed.files);
      inputs = files;
      // term reads only collection documents, so a session that changed or
      // removed none of them leaves the glossary as it was. graph never runs
      // here: it is the slowest set-wide check, and its findings span pages
      // rather than the one an agent just wrote, so a bare run (CI) owns it.
      const pageChanged = files.length > 0 || memberDocuments(changed.removed).length > 0;
      domains = [
        ...(files.length > 0 ? (["meta", "lint", "docevals"] as const) : []),
        "cite",
        ...(pageChanged ? (["term"] as const) : []),
      ];
      break;
    }
  }

  const checks: CheckOutcome[] = [];
  for (const domain of domains) {
    // The set-wide checks run bare, over every collection, whatever the scope.
    const setWide = domain === "term" || domain === "graph" || (domain === "cite" && opts.scope.kind !== "paths");
    checks.push(await outcome(domain, { family, cwd, inputs: setWide ? [] : inputs, onNotice }));
  }
  if (opts.scope.kind === "all" && checks.every((c) => c.status === "skipped")) {
    throw nothingSetUpError();
  }
  return { status: checks.some((c) => c.status === "fail") ? "fail" : "pass", files, checks };
}

/** The exit code a run by hand ends with: 2 when a check could not run. */
export function exitCodeFor(run: FamilyCheckRun): 0 | 1 | 2 {
  if (run.checks.some((c) => c.status === "error")) return 2;
  return run.status === "fail" ? 1 : 0;
}

function isRan(check: CheckOutcome): check is RanCheck {
  return check.status === "pass" || check.status === "fail";
}

/** The first line of a message, for a one-line context. */
function firstLine(message: string): string {
  return message.split("\n", 1)[0] ?? "";
}

/** What an agent is handed when a hook blocks: the failing checks' reports, nothing else. */
function renderFailures(run: FamilyCheckRun): string {
  return run.checks
    .filter((c): c is RanCheck => c.status === "fail")
    .map((c) => `${c.command}\n${c.render("pretty", false)}`)
    .join("\n\n");
}

export function renderPretty(run: FamilyCheckRun, color: boolean): string {
  const blocks: string[] = [];
  for (const check of run.checks) {
    if (isRan(check)) blocks.push(`${check.command}\n${check.render("pretty", color)}`);
  }
  const notRun = run.checks.filter((c): c is NotRunCheck => !isRan(c));
  if (notRun.length > 0) {
    const width = Math.max(...notRun.map((c) => c.command.length)) + 3;
    blocks.push(
      notRun
        .map((c) => `${c.status.padEnd(9)}${c.command.padEnd(width)}${firstLine(c.message)}`)
        .join("\n"),
    );
  }
  const count = (status: CheckOutcome["status"]): number =>
    run.checks.filter((c) => c.status === status).length;
  const errors = count("error");
  blocks.push(
    `${plural(run.checks.length, "check")} over ${plural(run.files.length, "file")}: ` +
      `${String(count("fail"))} failed, ${String(count("skipped"))} skipped` +
      (errors > 0 ? `, ${String(errors)} could not run` : ""),
  );
  return blocks.join("\n\n");
}

/** A check's JSON entry: its own report, or why there is none. */
function jsonEntry(c: CheckOutcome): object {
  if (!isRan(c)) return { command: c.command, status: c.status, message: c.message };
  try {
    return { command: c.command, status: c.status, report: JSON.parse(c.render("json", false)) as unknown };
  } catch {
    // One reporter's bad output must not take the other checks' reports with it.
    // `error` on purpose, whatever the run's own status: with no report to
    // embed, a `pass` or `fail` here would be a verdict nobody can inspect.
    // The reference documents `error` for this case too.
    return { command: c.command, status: "error", message: `${c.command} -f json printed output that is not JSON` };
  }
}

export function renderJson(run: FamilyCheckRun): string {
  return JSON.stringify(
    {
      status: run.status,
      files: run.files,
      checks: run.checks.map(jsonEntry),
    },
    null,
    2,
  );
}

export function renderGithub(run: FamilyCheckRun): string {
  return run.checks
    .filter(isRan)
    .map((c) => c.render("github", false))
    .filter((text) => text.length > 0)
    .join("\n");
}

export function render(run: FamilyCheckRun, format: CheckFormat, color: boolean): string {
  return format === "json" ? renderJson(run) : format === "github" ? renderGithub(run) : renderPretty(run, color);
}

/** What a hook command ends with: its exit code, and what it prints where. */
export interface HookReply {
  exitCode: 0 | 2;
  stdout?: string;
  stderr?: string;
}

/** The PostToolUse tools whose edit `check` answers. */
export const EDIT_TOOLS: readonly string[] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

/**
 * The hook protocol's answer to a run. Never exit 2 for a check that could
 * not run: 2 means "block" to Claude Code, and an operational error is not
 * the agent's to fix.
 */
export function hookReply(run: FamilyCheckRun, envelope: Envelope): HookReply {
  const failed = run.status === "fail";
  if (envelope.event === "PostToolUse") {
    const files = run.files.join(", ");
    if (failed) {
      return {
        exitCode: 2,
        stderr: `manni found errors in ${files}. Fix them before you continue.\n\n${renderFailures(run)}\n`,
      };
    }
    const errors = run.checks.filter((c): c is NotRunCheck => c.status === "error");
    if (errors.length === 0) return { exitCode: 0 };
    const additionalContext = errors
      .map((c) => `manni ${c.command} could not check ${files}: ${firstLine(c.message)}`)
      .join("\n");
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } })}\n`,
    };
  }
  if (envelope.event === "Stop") return turnReply(run, undefined, envelope);
  return { exitCode: 0 };
}

/** What tracevals found in the turn a Stop or SubagentStop ended, for the reply. */
export interface TurnVerdict {
  /** Rules broken with a confident verdict: how many, the report, the trace judged. */
  broken?: { rules: number; report: string; trace: string };
  /** A skip not yet said this session. */
  skipMessage?: string;
}

/**
 * The reply to a Stop or a SubagentStop: 0078's file checks first, then the
 * turn. One block carries both reasons; after the repair pass, one message
 * carries both sentences. Always exit 0, as 0078's Stop is.
 */
export function turnReply(
  run: FamilyCheckRun | undefined,
  turn: TurnVerdict | undefined,
  envelope: Envelope,
): HookReply {
  const reasons: string[] = [];
  const messages: string[] = [];
  if (run?.status === "fail") {
    if (envelope.stopHookActive) {
      messages.push("manni still reports errors after one repair pass. Run manni check to see them.");
    } else {
      reasons.push(`manni found errors in the files you changed. Fix them, then finish.\n\n${renderFailures(run)}`);
    }
  }
  if (turn?.broken !== undefined) {
    const { rules, report, trace } = turn.broken;
    if (envelope.stopHookActive) {
      messages.push(
        `tracevals still finds broken rules after one repair pass. Run manni tracevals check ${trace} to see them.`,
      );
    } else {
      reasons.push(
        `This turn broke ${plural(rules, "rule")} from the files that governed it. ` +
          `Fix the work, or say why the rule does not apply here, then finish.\n\n${report}`,
      );
    }
  }
  if (turn?.skipMessage !== undefined) messages.push(turn.skipMessage);
  if (reasons.length === 0 && messages.length === 0) return { exitCode: 0 };
  const reply = {
    ...(reasons.length > 0 ? { decision: "block", reason: reasons.join("\n\n") } : {}),
    ...(messages.length > 0 ? { systemMessage: messages.join(" ") } : {}),
  };
  return { exitCode: 0, stdout: `${JSON.stringify(reply)}\n` };
}

/** Test seams `checkTurn` takes; production builds each from config. */
export type TurnSeams = Partial<Pick<TurnCheckInput, "judge" | "extractor" | "localModels" | "env">>;

/**
 * Judge the turn a Stop or SubagentStop ended, with every gate of proposal
 * 0079. Silent (`undefined`) when tracevals is not in play, the turn is clean
 * or only needs review, a skip was already said this session, or the run
 * could not happen: an operational failure is not the agent's to fix.
 */
export async function runTurnCheck(
  envelope: Envelope,
  cwd: string,
  seams: TurnSeams = {},
): Promise<TurnVerdict | undefined> {
  const subagent = envelope.event === "SubagentStop";
  const judged = subagent ? envelope.agentTranscriptPath : envelope.transcriptPath;
  if (judged === undefined) return undefined;
  const trace = resolve(cwd, judged);
  const sessionId = envelope.sessionId ?? basename(trace, ".jsonl");
  let result: TurnCheckResult;
  let renderTurn: (typeof import("../../tracevals/reporters/conformance.js"))["renderCheck"];
  try {
    // Loaded here, as every domain is, so a run that never judges a turn never
    // loads tracevals.
    const [{ checkTurn }, reporters] = await Promise.all([
      import("../../tracevals/commands/check.js"),
      import("../../tracevals/reporters/conformance.js"),
    ]);
    renderTurn = reporters.renderCheck;
    result = await checkTurn({
      transcriptPath: resolve(cwd, envelope.transcriptPath ?? judged),
      ...(subagent ? { agentTranscriptPath: trace } : {}),
      ...(subagent && envelope.agentId !== undefined ? { agentId: envelope.agentId } : {}),
      ...(subagent && envelope.agentType !== undefined ? { agentType: envelope.agentType } : {}),
      ...(envelope.lastAssistantMessage !== undefined
        ? { lastAssistantMessage: envelope.lastAssistantMessage }
        : {}),
      sessionId,
      cwd,
      inLoop: true,
      ...seams,
    });
  } catch (err) {
    // An operational failure is not the agent's to fix, so it stays silent, as
    // 0078's Stop failures do. Anything else is a bug: say so on stderr, which
    // a hook that exits 0 sends to the debug log, and still never block.
    if (!(err instanceof ToolError)) warn(`the turn check failed unexpectedly: ${errorMessage(err)}`);
    return undefined;
  }
  const { skipped } = result;
  if (skipped?.message !== undefined) {
    return sayOnce(cwd, sessionId, skipped.gate) ? { skipMessage: skipped.message } : undefined;
  }
  if (result.exitCode !== 1 || result.report === undefined) return undefined;
  return {
    broken: {
      rules: result.report.summary.fail,
      report: renderTurn(result.report, { color: false }),
      trace: judged,
    },
  };
}

/** The reply when the run itself could not happen, under a hook. */
export function hookFailure(message: string, envelope: Envelope, file: string | undefined): HookReply {
  if (envelope.event !== "PostToolUse" || file === undefined) return { exitCode: 0 };
  const additionalContext = `manni check could not check ${file}: ${firstLine(message)}`;
  return {
    exitCode: 0,
    stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext } })}\n`,
  };
}
