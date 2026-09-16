/**
 * Orchestration: parse trace → resolve artifacts → plan evals → deterministic
 * graders → AI judge → aggregate. The judge is injectable so the engine
 * tests fully offline.
 */
import { parseTraceFile } from "../trace/claude.js";
import { resolveArtifacts } from "../artifacts/resolve.js";
import { findManifest, type FoundManifest } from "../capture/manifest.js";
import { TracevalsError } from "../types.js";
import type { CoverageEntry } from "../artifacts/types.js";
import type { ManifestReport } from "../capture/types.js";
import { planEvals, type EvalPlan } from "./plan.js";
import { MAX_ARTIFACT_CHARS, artifactWasTruncated } from "../judge/prompt.js";
import { graderFor, listGraderKinds } from "../graders/registry.js";
import { windowFor } from "../graders/util.js";
import { renderTrace } from "../judge/render.js";
import type { TraceJudge } from "../judge/trace-judge.js";
import type { TracevalsConfig } from "./config.js";
import type { EvalResult, RunReport, RunSummary } from "../types.js";

export interface EngineOptions {
  tracePath: string;
  /** Artifact-lookup override; when set it is also the parent-walk ceiling. */
  projectDir?: string;
  env?: Record<string, string | undefined>;
  config: TracevalsConfig;
  /** Injected judge; required unless deterministicOnly. */
  judge?: TraceJudge;
  deterministicOnly?: boolean;
  /**
   * An explicitly named session manifest (ADR 01024). Without it the engine
   * looks in the conventional places and degrades silently when there is none;
   * with it, a manifest that cannot be used is an error rather than a shrug.
   */
  manifest?: string;
  /**
   * Warnings raised before the engine ran — grader-plugin loading is the one
   * source today. They belong in the report because they change how a verdict
   * should be read, and they happened first, so they lead the list.
   */
  warnings?: string[];
}

export async function runEvals(options: EngineOptions): Promise<RunReport> {
  const start = Date.now();
  const { config } = options;

  const trace = await parseTraceFile(options.tracePath);

  // Read-only, and optional. A manifest sharpens staleness for the artifacts it
  // recorded (ADR 01024); an absent one leaves the mtime heuristic exactly as
  // ADR 01021 shipped it, and every hash check reports `skipped` with a reason.
  const refusals: { path: string; reason: string }[] = [];
  const found = await findManifest({
    tracePath: options.tracePath,
    ...(trace.sessionId !== undefined ? { sessionId: trace.sessionId } : {}),
    projectDir: options.projectDir ?? trace.cwd,
    captureDir: config.capture.dir,
    ...(options.manifest !== undefined ? { explicit: options.manifest } : {}),
    onRefused: (path, reason) => refusals.push({ path, reason }),
  });
  if (found === null && options.manifest !== undefined) {
    // An explicitly named manifest that is not there is a mistake, not a
    // degradation: the caller asked for exactness and did not get it.
    throw new TracevalsError(
      `no usable session manifest at ${options.manifest} — ${
        refusals[0]?.reason ??
        "it is missing, unreadable, or was recorded for a different session"
      }`,
    );
  }
  // A manifest that was found and then refused is a different situation from
  // no manifest at all, and an unexplained fallback to the mtime guess gives a
  // reader no way to tell them apart. Name the file, and say why.
  const manifestWarnings =
    found === null
      ? refusals.map(
          (r) => `ignoring the session manifest at ${r.path} — ${r.reason}`,
        )
      : [];

  const resolved = await resolveArtifacts(trace, {
    ...(options.projectDir !== undefined
      ? { projectDir: options.projectDir, projectRoot: options.projectDir }
      : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    reportUnusedArtifacts: config.reportUnusedArtifacts,
    ...(found !== null ? { manifest: found.manifest } : {}),
  });
  const plans = await planEvals(resolved.artifacts);

  const results: EvalResult[] = [];
  const aiPlans: EvalPlan[] = [];

  for (const plan of plans) {
    const base = {
      evalName: plan.evalName,
      artifact: plan.artifact.path,
      artifactName: plan.artifact.name,
      artifactType: plan.artifact.type,
      grader: plan.grader,
      implicit: plan.implicit,
    };

    if (plan.error !== undefined) {
      results.push({ ...base, outcome: "error", error: plan.error, durationMs: 0 });
      continue;
    }
    if (plan.skipped) {
      results.push({
        ...base,
        outcome: "skipped",
        skipReason: plan.skipReason ?? "eval skipped",
        durationMs: 0,
      });
      continue;
    }
    // An artifact that governed no turn in this trace grades nothing. Saying
    // so is the only honest outcome: a judge handed an empty window would
    // answer about the parent session's work, and a `human` reviewer would be
    // queued to review nothing (ADR 01015). Deterministic graders make the
    // same call for themselves, since only they know whether they are windowed.
    if (plan.grader === "ai" || plan.grader === "human") {
      const window = windowFor(trace, plan);
      if (window.empty) {
        results.push({
          ...base,
          outcome: "skipped",
          skipReason: window.reason ?? "the artifact governed no turns",
          durationMs: 0,
        });
        continue;
      }
    }
    if (plan.grader === "ai") {
      aiPlans.push(plan);
      continue;
    }
    // `human` is judged per session: every trace is new, so unlike the page
    // side there is no verdict to cache and nothing to defer to a later run.
    // It reports in deterministic-only runs too — a review queue is not an
    // inference call.
    if (plan.grader === "human") {
      results.push({
        ...base,
        outcome: "needs-review",
        skipReason: "awaiting human review",
        durationMs: 0,
      });
      continue;
    }

    // The one grader that executes something. ADR 01011 keeps it on by
    // default; ADR 01019 gives the person taking that risk a lever. A disabled
    // check is `skipped` with a reason, never `pass`: an unrun check has not
    // been satisfied.
    if (plan.grader === "command" && !config.graders.command.enabled) {
      results.push({
        ...base,
        outcome: "skipped",
        skipReason:
          "command execution is disabled (--no-commands / graders.command.enabled: false)",
        durationMs: 0,
      });
      continue;
    }

    const grader = graderFor(plan.grader);
    if (!grader) {
      // The grader vocabulary is an open enum: any kebab name validates, and
      // the registry is the authority that rejects it. This is where a stale
      // `llm` — the pre-1.0 spelling of `ai` — surfaces.
      results.push({
        ...base,
        outcome: "error",
        error: `unknown grader kind "${plan.grader}"; the grader registry knows ${listGraderKinds().sort().join(", ")}, "ai", and "human"`,
        durationMs: 0,
      });
      continue;
    }
    const graded = Date.now();
    // A grader that throws must fail its own eval, not the whole run: one
    // malformed eval should never cost the report every other verdict.
    let result;
    try {
      result = await grader.grade({
        trace,
        plan,
        ...(options.projectDir !== undefined
          ? { projectRoot: options.projectDir }
          : {}),
      });
    } catch (err) {
      results.push({
        ...base,
        outcome: "error",
        error: `${plan.grader}: ${err instanceof Error ? err.message : String(err)}`,
        durationMs: Date.now() - graded,
      });
      continue;
    }
    if (result.error !== undefined) {
      results.push({
        ...base,
        outcome: "error",
        error: result.error,
        durationMs: Date.now() - graded,
      });
      continue;
    }
    if (result.skipped !== undefined) {
      results.push({
        ...base,
        outcome: "skipped",
        skipReason: result.skipped,
        durationMs: Date.now() - graded,
      });
      continue;
    }
    // Deterministic evals fail only on error-severity findings; warning and
    // info findings report but pass.
    const failing = result.findings.some((f) => f.severity === "error");
    results.push({
      ...base,
      outcome: failing ? "fail" : "pass",
      findings: result.findings,
      durationMs: Date.now() - graded,
    });
  }

  if (aiPlans.length > 0) {
    if (options.deterministicOnly || options.judge === undefined) {
      const skipReason = options.deterministicOnly
        ? "ai evals skipped (deterministic-only run)"
        : "ai evals skipped (no judge provided)";
      for (const plan of aiPlans) {
        results.push({
          evalName: plan.evalName,
          artifact: plan.artifact.path,
          artifactName: plan.artifact.name,
          artifactType: plan.artifact.type,
          grader: plan.grader,
          implicit: plan.implicit,
          outcome: "skipped",
          skipReason,
          durationMs: 0,
        });
      }
    } else {
      // `judge.redact` rides along with the render caps: the digest is the one
      // thing that leaves the machine, so its size limits and its redaction
      // list are decided in the same place (ADR 01020).
      const judged = await options.judge(
        aiPlans,
        (plan) =>
          renderTrace(
            trace,
            { ...config.render, redact: config.judge.redact },
            plan,
          ),
        {
          trace,
          ...(options.projectDir !== undefined
            ? { projectRoot: options.projectDir }
            : {}),
        },
      );
      judged.forEach((j, i) => {
        const plan = aiPlans[i];
        results.push({
          ...(j.selfPreference ? { selfPreference: j.selfPreference } : {}),
          evalName: j.evalName,
          artifact: j.artifact,
          artifactName: j.artifactName,
          artifactType: plan?.artifact.type ?? "skill",
          grader: j.grader,
          implicit: j.implicit,
          outcome: j.outcome,
          ...(j.consensus !== undefined ? { consensus: j.consensus } : {}),
          ...(j.skipReason !== undefined ? { skipReason: j.skipReason } : {}),
          ...(j.error !== undefined ? { error: j.error } : {}),
          costUsd: j.costUsd,
          durationMs: j.durationMs,
        });
      });
    }
  }

  // Weight rides on the result so the summary can read it without threading
  // the plan list through, and so `--format json` consumers can see why a rate
  // moved. Counts stay unweighted: "1 failed" answers how many evals failed,
  // the rate answers how much that mattered, and weighting both would make
  // each answer the other's question.
  const weightOf = new Map<string, number>();
  for (const plan of plans) {
    weightOf.set(weightKey(plan.artifact.path, plan.evalName), plan.weight ?? 1);
  }
  for (const r of results) {
    r.weight = weightOf.get(weightKey(r.artifact, r.evalName)) ?? 1;
  }
  const gradedRows = results.filter(
    (r) => r.outcome === "pass" || r.outcome === "fail" || r.outcome === "error",
  );
  const gradedWeight = gradedRows.reduce((n, r) => n + (r.weight ?? 1), 0);

  const summary: RunSummary = {
    total: results.length,
    pass: results.filter((r) => r.outcome === "pass").length,
    fail: results.filter((r) => r.outcome === "fail").length,
    error: results.filter((r) => r.outcome === "error").length,
    needsReview: results.filter((r) => r.outcome === "needs-review").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    passRate:
      gradedWeight > 0
        ? gradedRows
            .filter((r) => r.outcome === "pass")
            .reduce((n, r) => n + (r.weight ?? 1), 0) / gradedWeight
        : 1,
  };
  const failing =
    summary.fail > 0 ||
    summary.error > 0 ||
    (config.failOnNeedsReview && summary.needsReview > 0);

  return {
    trace: {
      file: trace.file,
      source: trace.source,
      ...(trace.sessionId !== undefined ? { sessionId: trace.sessionId } : {}),
      cwd: trace.cwd,
      ...(trace.model !== undefined ? { model: trace.model } : {}),
      turnCount: trace.turnCount,
    },
    warnings: [
      ...(options.warnings ?? []),
      ...trace.warnings,
      ...manifestWarnings,
      ...resolved.warnings,
      ...vanityMetricWarnings(plans),
      ...truncatedArtifactWarnings(plans),
    ],
    coverage: resolved.coverage,
    // An observation about the session's configuration, never a verdict: it is
    // deliberately not part of `summary` and never moves `exitCode`.
    availability: resolved.availability,
    ...(found !== null
      ? { manifest: summariseManifest(found, resolved.coverage) }
      : {}),
    evalResults: results,
    summary,
    exitCode: failing ? 1 : 0,
    costUsd: results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    durationMs: Date.now() - start,
  };
}


/**
 * Key for the plan-to-result weight lookup.
 *
 * `U+0000` is written as an escape and never as a literal character. A raw NUL
 * in the source makes git classify this file as **binary**, and a binary file
 * does not merge: git reports the conflict, writes "ours" to the working tree
 * with no markers, and renders every diff as `Binary files differ`. This file
 * carried one for exactly one merge, which silently dropped the other side.
 *
 * The separator itself is defensive rather than load-bearing — an artifact
 * path ends in a filename, so the two halves cannot currently be forged into
 * a colliding key. A separator that cannot appear in either half keeps that
 * true if artifact naming ever loosens.
 */
function weightKey(artifact: string, evalName: string): string {
  return `${artifact}\u0000${evalName}`;
}

/**
 * Artifacts whose only check is that their skill fired.
 *
 * `claude plugin eval` treats the trigger check as display-only: it reports
 * whether the plugin fired but excludes it from the score in both arms, and
 * its authoring interview refuses to let it stand as a case's only grader.
 * The reasoning transfers exactly — "the skill fired" is not "the session
 * adhered to the skill", and a suite whose only criterion is `skill-invoked`
 * reports coverage while asserting nothing about behavior.
 *
 * A warning rather than an error: it is a statement about how much the suite
 * is worth, not about whether this run is valid.
 */
function vanityMetricWarnings(plans: EvalPlan[]): string[] {
  const byArtifact = new Map<string, EvalPlan[]>();
  for (const plan of plans) {
    if (plan.implicit) continue;
    const list = byArtifact.get(plan.artifact.path) ?? [];
    list.push(plan);
    byArtifact.set(plan.artifact.path, list);
  }
  const warnings: string[] = [];
  for (const [path, group] of byArtifact) {
    if (group.length > 0 && group.every((p) => p.grader === "skill-invoked")) {
      warnings.push(
        `${path}: every eval here is skill-invoked, which checks that the skill fired, ` +
          `not that the session followed it. Add at least one eval about what the ` +
          `session actually did.`,
      );
    }
  }
  return warnings;
}


/**
 * Artifacts the judge only saw part of.
 *
 * The prompt already tells the judge it is reading an excerpt; nothing told
 * the person reading the report. A verdict about adherence to a 20,000-word
 * skill, formed from its first 8,000 characters, is not wrong so much as
 * unlabelled — and an unlabelled partial verdict is the kind that gets
 * trusted.
 */
function truncatedArtifactWarnings(plans: EvalPlan[]): string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const plan of plans) {
    if (plan.grader !== "ai") continue;
    const path = plan.artifact.path;
    if (seen.has(path)) continue;
    if (!artifactWasTruncated(plan.artifact.content)) continue;
    seen.add(path);
    warnings.push(
      `${path}: only the first ${String(MAX_ARTIFACT_CHARS)} characters were shown to the judge ` +
        `(the artifact is ${String(plan.artifact.content.length)}). Verdicts about instructions ` +
        `beyond that point rest on text the judge never read.`,
    );
  }
  return warnings;
}

/**
 * What the manifest was able to say, counted over the coverage rows it was
 * compared against. Three numbers rather than two, because "the manifest had
 * nothing to say about this artifact" is not a shade of "unchanged" — those
 * rows still rest on the mtime guess and a reader has to be able to see how
 * many.
 */
function summariseManifest(
  found: FoundManifest,
  coverage: CoverageEntry[],
): ManifestReport {
  const checked = coverage.filter((c) => c.contentCheck !== undefined);
  return {
    path: found.path,
    sessionId: found.manifest.sessionId,
    capturedAt: found.manifest.capturedAt,
    ...(found.manifest.git !== undefined
      ? { gitSha: found.manifest.git.sha }
      : {}),
    matched: checked.filter((c) => c.contentCheck?.status === "match").length,
    changed: checked.filter((c) => c.contentCheck?.status === "mismatch").length,
    unrecorded: checked.filter((c) => c.contentCheck?.status === "skipped")
      .length,
  };
}
