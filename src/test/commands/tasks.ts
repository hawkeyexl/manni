/**
 * `manni test tasks`: a synthetic user attempts a task from a page, a URL or
 * a journey, and its trace and workspace are judged against the docs.
 *
 * A run is one start, one task and one persona (plan §4.2). Every run is
 * assembled and validated before the first starts, so a bad id or a missing
 * page stops the command before Claude Code spends a turn. Runs go one after
 * another. Each gets a fresh temp directory, its stream is saved under
 * `.manni/test/tasks/<run-id>/` as it arrives, and the judge reads the rest.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { InferenceProvider } from "@hawkeyexl/inference";
import { findConfigFile, readConfigFile, type ConfigFile } from "../../shared/config-file.js";
import { errorMessage, ToolError } from "../../shared/errors.js";
import { claudeCliMcpConfigPath, DEFAULT_CLAUDE_CLI_MAX_TURNS } from "../../shared/tools.js";
import { notice, warn } from "../../shared/warn.js";
import { notFoundMessage, STDIN_TOKEN } from "../../meta/internal.js";
import { parseTraceFile } from "../../tracevals/trace/claude.js";
import {
  claudeCodeArgs,
  claudeCodeEnv,
  classifyRun,
  lineSplitter,
  mcpServerNames,
  progressLine,
  realClaudeCodeSpawn,
  toolUses,
  type ClaudeCodeSpawn,
} from "../core/claude-code.js";
import { judgeRun } from "../core/judge-run.js";
import { rolePrompt, taskBriefFor } from "../core/prompts.js";
import { loadTaskRecords } from "../core/task-records.js";
import type {
  JudgeRun,
  SourceLocation,
  TaskEval,
  TaskJourney,
  TaskPersona,
  TaskSpec,
  TaskStart,
  WorkspaceChanges,
} from "../core/task-types.js";
import { prepareRun, workspaceChanges } from "../core/workspace.js";
import { TestError } from "../errors.js";

export type { TaskEval } from "../core/task-types.js";

export interface RunTasksOptions {
  /** Page paths and `http(s)://` URLs: where the synthetic user starts. */
  targets?: string[];
  /** `--task <text>`. */
  task?: string;
  /** `--journey <id>`, repeatable. */
  journeys?: string[];
  /** `--persona <id>`, repeatable. */
  personas?: string[];
  /** `--workspace <dir>`: the seed, overriding a journey's. */
  workspace?: string;
  /** `-c, --config`. */
  configPath?: string;
  cwd?: string;
  /** `--provider`, the judge's. */
  provider?: string;
  /** `--model`, the judge's. */
  model?: string;
  /** Keep each run's temp directory and name it on stderr. */
  keep?: boolean;
  /** An empty golden set is a pass. */
  allowEmpty?: boolean;
  /** Stream each action to stderr. */
  progress?: boolean;
  /** Test seam: how Claude Code is started. */
  spawn?: ClaudeCodeSpawn;
  /** Test seam: the judge. */
  judge?: JudgeRun;
  /** Test seam: the judge's provider, handed to the judge. */
  judgeProvider?: InferenceProvider;
  /** Test seam: the clock run ids are stamped from. */
  now?: () => Date;
}

export interface TaskRun {
  /** `<UTC timestamp>-<journey id or "task">-<persona id or "newcomer">`. */
  id: string;
  journey: string | null;
  /** The `--task` text, or the journey's title. */
  task: string;
  persona: string | null;
  /** The start: a path as given, or the URL. */
  start: string;
  /** The seed as given, or null for an empty workspace. */
  workspace: string | null;
  /** The kept workspace's absolute path under `--keep`. */
  kept: string | null;
  /** The saved stream, relative to the working directory. */
  trace: string;
  turns: number;
  durationMs: number;
  stoppedAtLimit: boolean;
  /** The turn limit the run had. */
  maxTurns: number;
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
  docs: string[];
  changes: WorkspaceChanges;
  /** The synthetic user's last message. */
  account: string;
  evals: TaskEval[];
  outcome: "pass" | "fail";
}

export interface TasksReport {
  runs: TaskRun[];
  summary: { runs: number; passed: number; failed: number; warnings: number };
  exitCode: 0 | 1;
}

const NOTHING_TO_RUN =
  "nothing to run: no journey declares evals:. Pass --task with a page or URL, or --journey <id>.";

const isUrl = (target: string): boolean => /^https?:\/\//i.test(target);

const toPosix = (path: string): string => path.split(sep).join("/");

/** A sibling's `ToolError` reported as this domain's. */
async function asTestError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ToolError && !(err instanceof TestError)) throw new TestError(err.message);
    throw err;
  }
}

const toError = (message: string): Error => new TestError(message);

async function loadConfig(cwd: string, configPath: string | undefined): Promise<ConfigFile | null> {
  const opts = { section: "test", legacyNames: [], toError };
  const file =
    configPath === undefined ? await findConfigFile(cwd, opts) : await readConfigFile(configPath, cwd, opts);
  if (file !== null && file.wrapped && file.value !== null) {
    throw new TestError(
      `${file.source}: test has no keys. Doc Detective's settings live under tools.doc-detective, and Claude Code's under tools.claude-cli.`,
    );
  }
  return file;
}

/** `20261023T140211Z`. */
function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

export function labelOf(spec: Pick<TaskSpec, "journey" | "persona">): string {
  return `${spec.journey?.id ?? "task"} as ${spec.persona?.id ?? "newcomer"}`;
}

/** The run passes when no `error` eval failed, errored or needs review. */
function runOutcome(evals: TaskEval[]): "pass" | "fail" {
  return evals.some((e) => e.severity === "error" && (e.outcome === "fail" || e.outcome === "error" || e.outcome === "needs-review"))
    ? "fail"
    : "pass";
}

export async function runTasks(opts: RunTasksOptions = {}): Promise<TasksReport> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const targets = opts.targets ?? [];
  const journeyIds = opts.journeys ?? [];
  const personaIds = opts.personas ?? [];
  const task = opts.task;

  // Usage first: none of these needs a file read.
  if (targets.includes(STDIN_TOKEN)) {
    throw new TestError("manni test tasks reads no stdin. Pass a page path or URL.");
  }
  if (task !== undefined && journeyIds.length > 0) {
    throw new TestError("--task and --journey both name the task. Pass one.");
  }
  if (task !== undefined && targets.length === 0) {
    throw new TestError("--task needs a page or URL to start from.");
  }
  if (task === undefined && journeyIds.length === 0 && targets.length > 0) {
    throw new TestError('a start page needs a task. Pass --task "<what the reader wants>" or --journey <id>.');
  }
  const missing = targets.filter((t) => !isUrl(t) && !existsSync(resolve(cwd, t))).map((t) => t.replace(/\\/g, "/"));
  if (missing.length > 0) throw new TestError(notFoundMessage(missing));
  let workspaceOverride: { abs: string; display: string } | undefined;
  if (opts.workspace !== undefined) {
    const abs = resolve(cwd, opts.workspace);
    if (!existsSync(abs)) throw new TestError(`--workspace "${opts.workspace}" does not exist.`);
    workspaceOverride = { abs, display: opts.workspace.replace(/\\/g, "/") };
  }

  const file = await loadConfig(cwd, opts.configPath);
  const configDir = file?.dir ?? cwd;
  const claude = file?.tools["claude-cli"] ?? {};
  const mcpConfig = file === null ? undefined : claudeCliMcpConfigPath(file.tools, file.dir);
  let mcpServers: string[] = [];
  if (file !== null && mcpConfig !== undefined) {
    const label = `${file.source}: tools.claude-cli.mcpConfig "${claude.mcpConfig ?? ""}"`;
    if (!existsSync(mcpConfig)) throw new TestError(`${label} does not exist.`);
    mcpServers = mcpServerNames(mcpConfig, label);
  }
  const maxTurns = claude.maxTurns ?? DEFAULT_CLAUDE_CLI_MAX_TURNS;

  const records = loadTaskRecords(file, cwd);
  const pathStart = (abs: string): TaskStart => ({ kind: "path", display: toPosix(relative(cwd, abs)) || ".", abs });
  const targetStarts: TaskStart[] = targets.map((t) =>
    isUrl(t) ? { kind: "url", url: t } : { kind: "path", display: t.replace(/\\/g, "/"), abs: resolve(cwd, t) },
  );
  const explicitPersonas: TaskPersona[] = [];
  for (const id of personaIds) explicitPersonas.push(await records.persona(id));

  // Each task with the journey it came from (none for `--task`).
  let journeys: TaskJourney[] = [];
  if (task === undefined) {
    if (journeyIds.length > 0) {
      for (const id of journeyIds) journeys.push(await records.journey(id));
    } else {
      journeys = await records.golden();
      if (journeys.length === 0) {
        if (opts.allowEmpty === true) return { runs: [], summary: { runs: 0, passed: 0, failed: 0, warnings: 0 }, exitCode: 0 };
        throw new TestError(NOTHING_TO_RUN);
      }
    }
  }

  const specs: TaskSpec[] = [];
  if (task !== undefined) {
    const personas = explicitPersonas.length > 0 ? explicitPersonas : [null];
    for (const start of targetStarts) {
      for (const persona of personas) {
        specs.push({
          task,
          journey: null,
          persona,
          start,
          workspaceSeed: workspaceOverride?.abs ?? null,
          workspaceDisplay: workspaceOverride?.display ?? null,
        });
      }
    }
  }
  for (const journey of journeys) {
    let starts = targetStarts;
    if (starts.length === 0) {
      const entry = journey.entryPoint;
      if (entry === undefined) {
        throw new TestError(
          `journey "${journey.id}" has no entry-point:. Add one to ${journey.file}, or pass the page to start from.`,
        );
      }
      if (isUrl(entry.value)) {
        starts = [{ kind: "url", url: entry.value }];
      } else {
        starts = [pathStart(recordedPath("entry-point", entry, configDir))];
      }
    }
    let seed = workspaceOverride ?? null;
    if (seed === null && journey.workspace !== undefined) {
      const abs = recordedPath("workspace", journey.workspace, configDir);
      seed = { abs, display: toPosix(relative(cwd, abs)) || "." };
    }
    let personas: (TaskPersona | null)[] = explicitPersonas;
    if (personas.length === 0) {
      personas = [];
      for (const id of journey.personas) personas.push(await records.persona(id, journey));
      if (personas.length === 0) personas = [null];
    }
    for (const start of starts) {
      for (const persona of personas) {
        specs.push({
          task: journey.title,
          journey,
          persona,
          start,
          workspaceSeed: seed?.abs ?? null,
          workspaceDisplay: seed?.display ?? null,
        });
      }
    }
  }

  const runs: TaskRun[] = [];
  for (const spec of specs) {
    runs.push(
      await asTestError(() =>
        runOne(spec, {
          cwd,
          file,
          configDir,
          maxTurns,
          ...(claude.model === undefined ? {} : { model: claude.model }),
          ...(mcpConfig === undefined ? {} : { mcpConfig }),
          mcpServers,
          opts,
        }),
      ),
    );
  }
  const passed = runs.filter((r) => r.outcome === "pass").length;
  const warnings = runs
    .flatMap((r) => r.evals)
    .filter((e) => e.severity === "warning" && e.outcome !== "pass" && e.outcome !== "skipped").length;
  return {
    runs,
    summary: { runs: runs.length, passed, failed: runs.length - passed, warnings },
    exitCode: passed === runs.length ? 0 : 1,
  };
}

interface RunContext {
  cwd: string;
  file: ConfigFile | null;
  configDir: string;
  maxTurns: number;
  model?: string;
  mcpConfig?: string;
  mcpServers: string[];
  opts: RunTasksOptions;
}

/** A path a journey names, resolved; one that is not there is a broken record. */
function recordedPath(
  key: string,
  path: { value: string; location: SourceLocation },
  configDir: string,
): string {
  const abs = resolve(configDir, path.value);
  if (!existsSync(abs)) {
    throw new TestError(`${path.location.file}:${String(path.location.line)}: ${key} "${path.value}" does not exist.`);
  }
  return abs;
}

/**
 * Claim a run directory and return its id. Creating a directory either
 * succeeds or fails with `EEXIST`, so two runs started in the same second, in
 * this process or another, never share one; the later takes `-2`, `-3`, ….
 */
async function claimRunDir(dir: string, base: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${String(n)}`;
    try {
      await mkdir(join(dir, id));
      return id;
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "EEXIST")) throw err;
    }
  }
}

async function runOne(spec: TaskSpec, ctx: RunContext): Promise<TaskRun> {
  const { opts } = ctx;
  const label = labelOf(spec);
  const who = spec.persona?.id ?? "newcomer";
  const tasksDir = join(ctx.configDir, ".manni", "test", "tasks");
  const id = await claimRunDir(tasksDir, `${stamp((opts.now ?? (() => new Date()))())}-${spec.journey?.id ?? "task"}-${who}`);
  const runDir = join(tasksDir, id);
  const tracePath = join(runDir, "trace.jsonl");
  await writeFile(tracePath, "");

  const dirs = await prepareRun(spec.start, spec.workspaceSeed, ctx.file);
  try {
    const role = rolePrompt(spec.persona);
    const roleFile = join(dirs.root, "role.md");
    const startFromWorkspace =
      dirs.startCopy === null ? null : toPosix(relative(dirs.workspaceDir, dirs.startCopy));
    const brief = taskBriefFor(spec, startFromWorkspace);
    await writeFile(roleFile, role);
    await writeFile(join(runDir, "role.md"), role);
    await writeFile(join(runDir, "brief.md"), brief);

    if (opts.progress === true) {
      const where =
        spec.workspaceDisplay === null ? "in an empty directory" : `in a fresh copy of ${spec.workspaceDisplay}`;
      process.stderr.write(`${label}: starting ${where}\n`);
    }
    const lines = lineSplitter((line) => {
      if (opts.progress !== true || line === "") return;
      for (const use of toolUses(line)) {
        process.stderr.write(`${progressLine(who, use.name, use.input, dirs.workspaceDir)}\n`);
      }
    });
    // Appends are chained so the file keeps the stream's order.
    let writing = Promise.resolve();
    const result = await (opts.spawn ?? realClaudeCodeSpawn)(
      claudeCodeArgs({
        roleFile,
        maxTurns: ctx.maxTurns,
        ...(ctx.model === undefined ? {} : { model: ctx.model }),
        ...(ctx.mcpConfig === undefined ? {} : { mcpConfig: ctx.mcpConfig }),
        mcpServers: ctx.mcpServers,
        docsDir: dirs.docsDir,
      }),
      {
        cwd: dirs.workspaceDir,
        stdin: brief,
        env: claudeCodeEnv(dirs.globalDir),
        onStdout: (chunk) => {
          writing = writing.then(() => appendFile(tracePath, chunk));
          lines.push(chunk);
        },
      },
    );
    lines.end();
    await writing;
    const outcome = classifyRun(result, label);

    const trace = await parseTraceFile(tracePath);
    const changes = await workspaceChanges(spec.workspaceSeed, dirs.workspaceDir);
    const account = trace.assistantTexts.at(-1) ?? "";
    const judged = await (opts.judge ?? judgeRun)(
      {
        spec,
        trace,
        tracePath,
        workspaceDir: dirs.workspaceDir,
        docsDir: dirs.docsDir,
        startCopy: dirs.startCopy,
        account,
        changes,
        configDir: ctx.configDir,
      },
      {
        ...(opts.provider === undefined ? {} : { provider: opts.provider }),
        ...(opts.model === undefined ? {} : { model: opts.model }),
        providers: ctx.file?.providers ?? {},
        ...(opts.judgeProvider === undefined ? {} : { judgeProvider: opts.judgeProvider }),
      },
    );
    let kept: string | null = null;
    if (opts.keep === true) {
      kept = dirs.workspaceDir;
      notice(`kept ${label}'s workspace: ${kept}`);
    }
    const usage = trace.usage;
    return {
      id,
      journey: spec.journey?.id ?? null,
      task: spec.task,
      persona: spec.persona?.id ?? null,
      start: spec.start.kind === "url" ? spec.start.url : spec.start.display,
      workspace: spec.workspaceDisplay,
      kept,
      trace: toPosix(relative(ctx.cwd, tracePath)),
      turns: trace.turnCount,
      durationMs: outcome.durationMs,
      stoppedAtLimit: outcome.stoppedAtLimit,
      maxTurns: ctx.maxTurns,
      usage: {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        ...(usage?.totalCostUsd === undefined ? {} : { costUsd: usage.totalCostUsd }),
      },
      docs: judged.docs,
      changes,
      account,
      evals: judged.evals,
      outcome: runOutcome(judged.evals),
    };
  } finally {
    if (opts.keep !== true) await removeRunDir(dirs.root, label);
  }
}

/**
 * Remove a run's temp directory, or say why not. A process the synthetic
 * user started, such as a browser, can outlive Claude Code and hold a file
 * open, and on Windows that fails the removal. The run is over by then, so
 * its report still prints and its exit code stands.
 */
async function removeRunDir(root: string, label: string): Promise<void> {
  try {
    // Retries cover a process that is still exiting.
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  } catch (err) {
    warn(
      `could not remove ${root} after ${label}: ${errorMessage(err)}. ` +
        "A process the synthetic user started may still hold it; remove it by hand.",
    );
  }
}
