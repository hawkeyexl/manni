/**
 * Judging a finished run (plan §4.6, §4.7): the evals it carries, graded
 * against its trace, its workspace and the docs the reader had.
 *
 * Nothing here grades on its own. Deterministic evals run through tracevals'
 * grader registry with the workspace as the project root, judged evals through
 * tracevals' ensemble judge, and the judge's provider comes from tracevals'
 * own selection. A run is one session governed by one task, so each eval plan
 * carries a synthetic project-rules artifact: its window is the whole session,
 * and its content is the task brief the judge reads as the source.
 */
import { join, relative, sep } from "node:path";
import type { InferenceProvider } from "@hawkeyexl/inference";
import { mapConcurrent } from "../../shared/concurrency.js";
import { errorMessage } from "../../shared/errors.js";
import { LOCAL_PROVIDER } from "../../shared/providers.js";
import { evidenceVerdict } from "../../shared/verdict-lines.js";
import type { ResolvedArtifact } from "../../tracevals/artifacts/types.js";
import { parseConfig } from "../../tracevals/core/config.js";
import type { EvalLocation, EvalPlan } from "../../tracevals/core/plan.js";
import type { EvalEntry } from "../../tracevals/evals/extract.js";
import { graderFor } from "../../tracevals/graders/registry.js";
import { REDO_OR_FIX } from "../../tracevals/graders/util.js";
import {
  constructProvider,
  makeJudgeProvider,
  resolveProviderIdentity,
} from "../../tracevals/judge/provider.js";
import { makeTraceJudge, type JudgedEval } from "../../tracevals/judge/trace-judge.js";
import { TracevalsError } from "../../tracevals/types.js";
import { TestError } from "../errors.js";
import { renderEvidence, taskBrief } from "./evidence.js";
import type {
  JudgeRun,
  JudgeRunOptions,
  RunEvidence,
  SourceLocation,
  TaskEval,
} from "./task-types.js";

export const FOLLOWED_THE_DOCS_ID = "followed-the-docs";
export const FOLLOWED_THE_DOCS =
  "Every step the reader took came from the docs it had, or from what the persona already knows. It did not guess or lean on outside knowledge.";
export const SUCCESS_ID = "success";
export const COMPLETED_ID = "completed";
export const CONSTRAINT_ID = "constraint";

/** One eval as reported, and the plan that grades it. */
interface Slot {
  base: Omit<TaskEval, "outcome">;
  plan: EvalPlan;
}

export const judgeRun: JudgeRun = async (evidence, options) => {
  const { spec } = evidence;
  const seen = renderEvidence(evidence);
  const artifact: ResolvedArtifact = {
    name: spec.journey?.id ?? "task",
    type: "project-rules",
    path: spec.journey === null ? "task" : join(evidence.configDir, spec.journey.file),
    content: taskBrief(evidence),
    origin: "project",
  };
  const providers = await providersFor(options);
  const source = taskSource(evidence);

  const slots: Slot[] = [];
  const judged = (
    id: string,
    assertion: string,
    severity: TaskEval["severity"],
    location: SourceLocation | null,
  ): Slot => ({
    base: { id, grader: "ai", severity, assertion, location },
    plan: {
      artifact,
      evalName: id,
      assertion,
      grader: "ai",
      severity,
      implicit: false,
      location: planLocation(location),
    },
  });

  const journey = spec.journey;
  if (journey?.successCriteria !== undefined) {
    const { text, location } = journey.successCriteria;
    slots.push(judged(SUCCESS_ID, text, "error", location));
  }
  for (const { entry, location } of journey?.evals ?? []) {
    slots.push({
      base: {
        id: entry.id,
        grader: entry.grader,
        severity: entry.severity,
        assertion: entry.assertion,
        location,
      },
      plan: planFor(entry, artifact, location),
    });
  }
  // A write-in task, or a journey that says nothing about done, is judged on
  // the task alone. Nothing is derived: evals drawn from the docs asked for
  // the docs' own extras (a screenshot the sample took) and failed runs the
  // trace showed were done.
  if (slots.length === 0) {
    slots.push(judged(COMPLETED_ID, `The reader completed the task: ${spec.task}`, "error", source));
  }
  slots.push(judged(FOLLOWED_THE_DOCS_ID, FOLLOWED_THE_DOCS, "warning", source));
  for (const c of spec.persona?.constraints ?? []) {
    slots.push(judged(CONSTRAINT_ID, c.text, "warning", c.location));
  }

  const outcomes: (Pick<TaskEval, "outcome" | "message" | "consensus"> | undefined)[] = [];
  const toJudge: { i: number; plan: EvalPlan }[] = [];
  for (const [i, slot] of slots.entries()) {
    if (slot.plan.skipped === true) {
      outcomes[i] = { outcome: "skipped", message: slot.plan.skipReason };
    } else if (slot.plan.grader === "ai") {
      toJudge.push({ i, plan: slot.plan });
    } else {
      outcomes[i] = await gradeDeterministic(slot.plan, evidence);
    }
  }

  if (toJudge.length > 0) {
    const judge = makeTraceJudge({
      provider: providers.judge,
      ...(providers.providerFor === undefined ? {} : { providerFor: providers.providerFor }),
      noCache: true,
    });
    // One eval per call, several calls at once: each is an ensemble of
    // model calls, and judged one after another a run's seven evals took
    // twelve minutes on claude-cli.
    const verdicts = await mapConcurrent(toJudge, providers.concurrency, async (j) =>
      judge([j.plan], () => seen.text, { trace: evidence.trace, projectRoot: evidence.workspaceDir }),
    );
    verdicts.forEach(([v], n) => {
      const i = toJudge[n]?.i;
      if (i !== undefined && v !== undefined) outcomes[i] = fromVerdict(v);
    });
  }

  return {
    evals: slots.map((slot, i) => ({
      ...slot.base,
      ...(outcomes[i] ?? { outcome: "error", message: "the judge returned no verdict for this eval" }),
    })),
    docs: seen.docs,
  };
};

/** Judged evals in flight at once, except on a local model. */
const JUDGE_CONCURRENCY = 4;

interface Providers {
  judge: InferenceProvider;
  /** One local model context at a time: four exhausted memory (docevals ADR 01039). */
  concurrency: number;
  providerFor?: (choice: { provider?: string; model?: string; origin?: string }) => Promise<InferenceProvider>;
}

/**
 * The judge. Selection is tracevals'
 * own (`--provider`/`--model`, then `providers:`, then `auto`); its errors
 * leave as `TestError`s, so the CLI exits 2 with the message unchanged.
 */
async function providersFor(options: JudgeRunOptions): Promise<Providers> {
  if (options.judgeProvider !== undefined) {
    return { judge: options.judgeProvider, concurrency: 1 };
  }
  try {
    const config = parseConfig({}, { providers: options.providers });
    const flags = {
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
    };
    const identity = await resolveProviderIdentity(config, flags);
    return {
      judge: constructProvider(config, identity),
      providerFor: (choice) => makeJudgeProvider(config, flags, choice),
      concurrency: identity.provider === LOCAL_PROVIDER ? 1 : JUDGE_CONCURRENCY,
    };
  } catch (err) {
    if (err instanceof TracevalsError) throw new TestError(err.message);
    throw err;
  }
}

/**
 * Where `completed` and `followed-the-docs` are annotated: the journey's
 * `title:` line, the start page's first line, or nowhere for a URL.
 */
function taskSource(evidence: RunEvidence): SourceLocation | null {
  const { journey, start } = evidence.spec;
  if (journey !== null) return journey.titleLocation;
  if (start.kind === "url") return null;
  return {
    file: relative(evidence.configDir, start.abs).split(sep).join("/"),
    line: 1,
  };
}

function planLocation(location: SourceLocation | null): EvalLocation {
  return location ?? { file: "task" };
}

/** A golden eval as tracevals' graders and judge read it. */
function planFor(entry: EvalEntry, artifact: ResolvedArtifact, location: SourceLocation): EvalPlan {
  return {
    artifact,
    evalName: entry.id,
    assertion: entry.assertion,
    grader: entry.grader,
    severity: entry.severity,
    implicit: false,
    location: planLocation(location),
    options: entry.options,
    evidence: entry.evidence,
    examples: entry.examples,
    provider: entry.provider,
    model: entry.model,
    runs: entry.runs,
    target: entry.target,
    command: entry.command,
    successExitCodes: entry.successExitCodes,
    timeoutMs: entry.timeoutMs,
    generatedAssertionHash: entry.generatedAssertionHash,
    ...(entry.skip === true ? { skipped: true, skipReason: "eval skipped via its own skip: true" } : {}),
  };
}

/**
 * A deterministic eval, graded in the workspace: `command` runs there and a
 * `{ source: file }` target reads it. Any finding fails the eval; whether
 * that fails the run is the eval's severity, which the caller reads.
 */
async function gradeDeterministic(
  plan: EvalPlan,
  evidence: RunEvidence,
): Promise<Pick<TaskEval, "outcome" | "message">> {
  const grader = graderFor(plan.grader);
  if (grader === undefined) {
    return { outcome: "error", message: `no grader "${plan.grader}"` };
  }
  try {
    const result = await grader.grade({
      trace: evidence.trace,
      plan,
      projectRoot: evidence.workspaceDir,
    });
    if (result.error !== undefined) return { outcome: "error", message: result.error };
    if (result.skipped !== undefined) return { outcome: "skipped", message: result.skipped };
    if (result.findings.length === 0) return { outcome: "pass" };
    return {
      outcome: "fail",
      // tracevals' advice names an artifact; a run is graded against a task.
      message: result.findings.map((f) => f.message.replace(` ${REDO_OR_FIX}`, "")).join(" "),
    };
  } catch (err) {
    return { outcome: "error", message: `${plan.grader}: ${errorMessage(err)}` };
  }
}

function fromVerdict(v: JudgedEval): Pick<TaskEval, "outcome" | "message" | "consensus"> {
  const reasoning = v.consensus === undefined ? undefined : evidenceVerdict(v.consensus)?.reasoning;
  return {
    outcome: v.outcome,
    message: v.error ?? v.skipReason ?? reasoning,
    ...(v.consensus === undefined
      ? {}
      : {
          consensus: {
            votes: { ...v.consensus.votes },
            meanConfidence: v.consensus.meanConfidence,
          },
        }),
  };
}
