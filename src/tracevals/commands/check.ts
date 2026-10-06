/**
 * `manni tracevals check <trace>`: judge the last turn of one session against
 * the rules that governed it (proposal 0079). `checkTurn` is the same
 * judgement inside a Stop or SubagentStop hook, with the hook's model and
 * every gate of "When tracevals stays out of the way".
 *
 * Both are read-only over the trace and the sources. What they write is the
 * rules cache and the verdict cache, under `judge.cacheDir`. The hook also
 * writes the session ledger, which `check` by hand only reads.
 */
import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { InferenceProvider, ProviderName } from "@hawkeyexl/inference";
import { discoverConfig, type TracevalsConfig } from "../core/config.js";
import {
  constructProvider,
  resolveSelectionIdentity,
  selectHookProvider,
  selectProvider,
  type ProviderSelection,
} from "../judge/provider.js";
import { renderCheck } from "../reporters/conformance.js";
import type { SummaryFormat } from "../reporters/index.js";
import { hostSetting, queued, QUEUE_WAIT_MS } from "../rules/host.js";
import {
  applicableRules,
  judgeTurn,
  TurnCache,
  type TurnFinding,
  type TurnJudgement,
  type TurnRule,
} from "../rules/judge.js";
import { ruleKey } from "../rules/judge-prompt.js";
import {
  ledgerPath,
  readLedger,
  recordTurn,
  writeLedger,
  type LedgerOutcome,
} from "../rules/ledger.js";
import { warn } from "../../shared/warn.js";
import { libraryLocalModels, type LocalModels } from "../rules/local.js";
import { mockTurnJudge } from "../rules/mock.js";
import { resolveTurnSources, type RuleSource } from "../rules/sources.js";
import { lastTurn, subagentTurn, type TurnSlice } from "../rules/turn.js";
import { parseTraceFile } from "../trace/claude.js";
import type { Trace } from "../trace/types.js";
import { TracevalsError } from "../types.js";
import {
  assertDownloaded,
  conformanceOf,
  extraction,
  firstLine,
  isNetworkProvider,
  JUDGE_ENV,
  localGate,
  markJudgeProcess,
  offlineRefusal,
  rulesCacheFor,
  type GateSkip,
  type Identity,
  type LocalGate,
} from "./conformance.js";

/** Why a judgement stopped short, as the report's `skipped` names it. */
export type CheckSkip = "empty-turn" | "no-sources" | "not-applicable";

/** Every gate a hook can stop at, in the proposal's order. */
export type HookGate =
  | "not-in-play"
  | "judge-session"
  | CheckSkip
  | LocalGate
  | "busy";

export interface CheckSourceEntry {
  path: string;
  format: RuleSource["format"];
  skill?: string;
  trigger: string;
  rules: number;
  origin: "declared" | "extracted";
}

export interface CheckReport {
  trace: string;
  sessionId: string;
  /** The subagent a SubagentStop judged, or null for the main session. */
  agentId: string | null;
  turn: { from: number; to: number };
  /** Null when the run stopped before a judge was asked. */
  judge: { provider: string; model: string; mode: TurnJudgement["mode"]; runs: number } | null;
  /** Null when no source needed the extraction model. */
  extraction: { provider: string; model: string } | null;
  sources: CheckSourceEntry[];
  /** Only `fail` and `needs-review`. */
  findings: TurnFinding[];
  summary: { sources: number; rules: number; notApplicable: number; fail: number; needsReview: number };
  skipped: CheckSkip | null;
  warnings: string[];
  exitCode: number;
}

/** Test seams; production builds every one of these from config. */
interface Seams {
  /** The judge, in place of the selected provider. */
  judge?: InferenceProvider;
  /** The extraction model, in place of the out-of-loop provider. */
  extractor?: InferenceProvider;
  localModels?: LocalModels;
}

interface Params extends Seams {
  config: TracevalsConfig;
  configDir: string;
  trace: Trace;
  turn: TurnSlice;
  sessionId: string;
  agentId: string | null;
  agentType?: string;
  projectDir: string;
  projectRoot?: string;
  env?: Record<string, string | undefined>;
  judgeSelection: ProviderSelection;
  runs: number;
  inLoop: boolean;
  noCache: boolean;
  offline: boolean;
  lastAssistantMessage?: string;
}

type Outcome =
  | { kind: "report"; report: CheckReport; judgement?: TurnJudgement }
  | { kind: "gate"; skip: GateSkip<HookGate> };

const idOf = (p: InferenceProvider): Identity => ({
  provider: p.provider() as ProviderName,
  model: p.modelName(),
});

const LEDGER_OUTCOME: Record<TurnJudgement["verdicts"][number]["outcome"], LedgerOutcome> = {
  fail: "broken",
  followed: "followed",
  "needs-review": "needs-review",
  "not-applicable": "not-applicable",
};

/** The pipeline both modes run: sources, extraction, the judge. */
async function conform(p: Params): Promise<Outcome> {
  const { config, turn } = p;
  const conformance = conformanceOf(config);
  const local = p.localModels ?? libraryLocalModels(config.providers);
  const report: CheckReport = {
    trace: p.trace.file,
    sessionId: p.sessionId,
    agentId: p.agentId,
    turn: { from: turn.from, to: turn.to },
    judge: null,
    extraction: null,
    sources: [],
    findings: [],
    summary: { sources: 0, rules: 0, notApplicable: 0, fail: 0, needsReview: 0 },
    skipped: null,
    warnings: [...p.trace.warnings],
    exitCode: 0,
  };
  const stop = (skipped: CheckSkip): Outcome => {
    report.skipped = skipped;
    return { kind: "report", report };
  };

  // Gate 3.
  if (turn.window.empty) return stop("empty-turn");

  // Gate 4.
  const resolved = await resolveTurnSources(p.trace, turn, {
    projectDir: p.projectDir,
    ...(p.projectRoot !== undefined ? { projectRoot: p.projectRoot } : {}),
    ...(p.env !== undefined ? { env: p.env } : {}),
    include: conformance.include,
    exclude: conformance.exclude,
    ...(p.agentType !== undefined ? { agentType: p.agentType } : {}),
  });
  report.warnings.push(...resolved.warnings);
  const { sources } = resolved;
  report.summary.sources = sources.length;
  if (sources.length === 0) return stop("no-sources");

  const judgeId = p.judge !== undefined ? idOf(p.judge) : await resolveSelectionIdentity(config, p.judgeSelection);
  const judgeIsLocal = judgeId.provider === "llama-cpp";

  // Gate 5, for the judge. Extraction's own model is asked below, only when a
  // source needs it.
  if (p.inLoop && judgeIsLocal) {
    const skip = await localGate(local, judgeId.model, ["downloading"]);
    if (skip !== undefined) return { kind: "gate", skip };
  }

  // Extraction, between gates 4 and 6, with the out-of-loop model always.
  const host = hostSetting(p.inLoop, p.sessionId, config.providers["llama-cpp"]?.keepAlive);
  const ex = await extraction(config, rulesCacheFor(config, p.configDir, p.noCache), p.extractor, host);
  if (sources.some((s) => ex.needs(s))) {
    report.extraction = { provider: ex.identity.provider, model: ex.identity.model };
    if (p.offline && isNetworkProvider(ex.identity.provider)) {
      throw offlineRefusal("extraction", ex.identity);
    }
    if (ex.identity.provider === "llama-cpp") {
      if (p.inLoop) {
        const skip = await localGate(local, ex.identity.model, ["downloading", "not-downloaded", "memory"]);
        if (skip !== undefined) return { kind: "gate", skip };
      } else {
        await assertDownloaded(local, ex.identity.model);
      }
    }
  }
  const rules: TurnRule[] = [];
  for (const source of sources) {
    const { rules: found, origin } = await ex.rulesOf(source);
    report.sources.push({
      path: source.displayPath,
      format: source.format,
      ...(source.skill !== undefined ? { skill: source.skill } : {}),
      trigger: source.trigger,
      rules: found.length,
      origin,
    });
    for (const rule of found) rules.push({ source, rule });
  }
  report.summary.rules = rules.length;

  // Gate 6.
  const { applicable } = applicableRules(rules, turn.window);
  if (applicable.length === 0) {
    report.summary.notApplicable = rules.length;
    return stop("not-applicable");
  }

  if (p.offline && isNetworkProvider(judgeId.provider)) {
    throw offlineRefusal("the judge", judgeId);
  }
  // Gates 7 and 8, model on disk and memory. The verdict cache is gate 9, and
  // it lives inside judgeTurn: reading it needs the provider's state limit,
  // and a local provider loads its model to report one, so these come first.
  if (judgeIsLocal) {
    if (p.inLoop) {
      const skip = await localGate(local, judgeId.model, ["not-downloaded", "memory"]);
      if (skip !== undefined) return { kind: "gate", skip };
    } else {
      await assertDownloaded(local, judgeId.model);
    }
  }

  markJudgeProcess();
  const provider =
    p.judge ??
    (judgeId.provider === "mock"
      ? mockTurnJudge(judgeId.model)
      : constructProvider(config, judgeId, { host }));
  // The session ledger: read in both modes, written only by the hook.
  const ledgerFile = ledgerPath(p.projectDir, p.sessionId, p.agentId);
  const ledger = await readLedger(ledgerFile);
  let ran:Awaited<ReturnType<typeof queued<TurnJudgement>>>;
  try {
    ran = await queued(judgeId.model, () =>
      judgeTurn({
        trace: p.trace,
        turn,
        rules,
        provider,
        runs: p.runs,
        temperature: config.judge.temperature,
        zones: config.judge.zones,
        render: {
          maxBlockChars: config.render.maxBlockChars,
          maxTotalChars: config.render.maxTotalChars,
          redact: config.judge.redact,
        },
        ...(p.lastAssistantMessage !== undefined
          ? { lastAssistantMessage: p.lastAssistantMessage }
          : {}),
        ledger,
        cache: new TurnCache(resolve(p.configDir, config.judge.cacheDir, "turns"), !p.noCache),
      }),
    );
  } catch (err) {
    if (err instanceof TracevalsError) throw err;
    throw new TracevalsError(`could not judge the last turn: ${firstLine(err)}`);
  }
  if (ran.busy) {
    return {
      kind: "gate",
      skip: {
        gate: "busy",
        message: `tracevals skipped this turn: ${judgeId.model} was busy with other judgements for ${String(QUEUE_WAIT_MS / 60_000)} minutes.`,
      },
    };
  }
  const judgement = ran.value;
  if (p.inLoop) {
    const results = judgement.verdicts.map((v) => ({
      key: ruleKey(v.source, v.rule),
      text: v.text,
      outcome: LEDGER_OUTCOME[v.outcome],
      note: v.reasoning ?? "",
    }));
    try {
      await writeLedger(ledgerFile, recordTurn(ledger, turn.from, results));
    } catch (err) {
      warn(`could not write the session ledger ${ledgerFile}: ${firstLine(err)}`);
    }
  }
  report.judge = {
    provider: judgeId.provider,
    model: judgeId.model,
    mode: judgement.mode,
    runs: judgement.runs,
  };
  report.findings = judgement.findings;
  report.summary.notApplicable = judgement.notApplicable;
  report.summary.fail = judgement.findings.filter((f) => f.outcome === "fail").length;
  report.summary.needsReview = judgement.findings.length - report.summary.fail;
  report.warnings.push(...judgement.warnings);
  report.exitCode = report.summary.fail > 0 ? 1 : 0;
  return { kind: "report", report, judgement };
}

async function readTrace(path: string): Promise<Trace> {
  try {
    return await parseTraceFile(path);
  } catch (err) {
    throw new TracevalsError(`cannot read trace ${path}: ${firstLine(err)}`);
  }
}

// ── By hand ──────────────────────────────────────────────────────

export interface CheckOptions extends Seams {
  tracePath: string;
  /** Project root for resolving sources; default the trace's recorded cwd. */
  project?: string;
  provider?: string;
  model?: string;
  local?: boolean;
  /** Overrides `judge.ensembleRuns`. */
  runs?: number;
  noCache?: boolean;
  offline?: boolean;
  format?: SummaryFormat;
  output?: string;
  color?: boolean;
  /** Directory holding manni.config.yaml; defaults to cwd. */
  configDir?: string;
  config?: string;
  noConfig?: boolean;
  env?: Record<string, string | undefined>;
}

export interface CheckResult {
  report: CheckReport;
  rendered: string;
}

export async function runCheck(options: CheckOptions): Promise<CheckResult> {
  const { config, dir: configDir } = await discoverConfig(options.configDir ?? process.cwd(), {
    ...(options.config === undefined ? {} : { configPath: options.config }),
    ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
  });
  const judgeSelection = selectProvider(config, {
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.local !== undefined ? { local: options.local } : {}),
  });
  const trace = await readTrace(options.tracePath);
  const outcome = await conform({
    config,
    configDir,
    trace,
    turn: lastTurn(trace),
    sessionId: trace.sessionId ?? basename(trace.file).replace(/\.jsonl$/, ""),
    agentId: null,
    projectDir: options.project ?? trace.cwd,
    ...(options.project !== undefined ? { projectRoot: options.project } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    judgeSelection,
    runs: options.runs ?? config.judge.ensembleRuns,
    inLoop: false,
    noCache: options.noCache === true,
    offline: options.offline === true,
    ...seamsOf(options),
  });
  // By hand only the report's own skips exist; the other gates act under a hook.
  if (outcome.kind === "gate") throw new TracevalsError(outcome.skip.message);
  const { report } = outcome;
  const rendered =
    options.format === "json"
      ? JSON.stringify(report, null, 2)
      : renderCheck(report, { color: options.color === true });
  if (options.output !== undefined) await writeFile(options.output, rendered, "utf-8");
  return { report, rendered };
}

function seamsOf(s: Seams): Seams {
  return {
    ...(s.judge !== undefined ? { judge: s.judge } : {}),
    ...(s.extractor !== undefined ? { extractor: s.extractor } : {}),
    ...(s.localModels !== undefined ? { localModels: s.localModels } : {}),
  };
}

// ── Inside a hook ────────────────────────────────────────────────

/** What a Stop or SubagentStop envelope carries, as the family hook passes it. */
export interface TurnCheckInput extends Seams {
  transcriptPath: string;
  /** SubagentStop: the subagent's own transcript, judged alone. */
  agentTranscriptPath?: string;
  agentId?: string;
  /** SubagentStop: the subagent type, whose definition governs the run. */
  agentType?: string;
  /** Appended when the transcript lags the Stop. */
  lastAssistantMessage?: string;
  sessionId: string;
  cwd: string;
  inLoop: true;
  /** Defaults to `process.env`; gate 2 and the source walk read it. */
  env?: Record<string, string | undefined>;
}

export interface TurnCheckResult {
  /** The gate that ended the run. A message is set where the proposal says one. */
  skipped?: { gate: HookGate; message?: string };
  judgement?: TurnJudgement;
  /** Only `fail` and `needs-review`; empty when skipped. */
  findings: TurnFinding[];
  /** Absent for gates 1, 2, 5, 8, 9 and a busy host. */
  report?: CheckReport;
  /** 1 when a rule was broken with a confident verdict. */
  exitCode: 0 | 1;
}

/**
 * Gates 1 to 9 for one turn, then the judgement. The skip messages are said
 * once per session by the caller, which knows the session. An operational
 * failure throws a `TracevalsError`.
 */
export async function checkTurn(input: TurnCheckInput): Promise<TurnCheckResult> {
  const { config, dir: configDir } = await discoverConfig(input.cwd);
  // Gate 1. The transcript is not parsed.
  if (config.conformance === null) {
    return { skipped: { gate: "not-in-play" }, findings: [], exitCode: 0 };
  }
  // Gate 2: a judge's own session.
  const env = input.env ?? process.env;
  if ((env[JUDGE_ENV] ?? "") !== "") {
    return { skipped: { gate: "judge-session" }, findings: [], exitCode: 0 };
  }
  const subagent = input.agentTranscriptPath !== undefined;
  const trace = await readTrace(input.agentTranscriptPath ?? input.transcriptPath);
  const outcome = await conform({
    config,
    configDir,
    trace,
    turn: subagent ? subagentTurn(trace) : lastTurn(trace),
    sessionId: input.sessionId,
    agentId: input.agentId ?? null,
    ...(input.agentType !== undefined ? { agentType: input.agentType } : {}),
    projectDir: input.cwd,
    ...(input.env !== undefined ? { env: input.env } : {}),
    judgeSelection: selectHookProvider(config),
    runs: config.conformance.hook.runs,
    inLoop: true,
    noCache: false,
    offline: false,
    ...(input.lastAssistantMessage !== undefined
      ? { lastAssistantMessage: input.lastAssistantMessage }
      : {}),
    ...seamsOf(input),
  });
  if (outcome.kind === "gate") {
    return { skipped: outcome.skip, findings: [], exitCode: 0 };
  }
  const { report, judgement } = outcome;
  if (report.skipped !== null) {
    return { skipped: { gate: report.skipped }, findings: [], report, exitCode: 0 };
  }
  return {
    ...(judgement !== undefined ? { judgement } : {}),
    findings: report.findings,
    report,
    exitCode: report.exitCode === 1 ? 1 : 0,
  };
}
