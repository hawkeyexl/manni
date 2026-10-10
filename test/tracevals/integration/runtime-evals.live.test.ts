/**
 * The runtime-evals benchmark: every case of test/tracevals/fixtures/
 * runtime-evals/ through the real check pipeline, `runCheck` by hand, judged
 * through an isolated, logged-in Claude CLI and scored against the hand
 * labels. Rules come from the frozen cache, so no call extracts.
 *
 * Gated behind MANNI_TRACEVALS_LIVE=1 and a `claude` on PATH, and skipped by
 * default. MANNI_RUNTIME_EVALS_MODEL names another judge model to compare.
 * Each run writes its results to .tmp/runtime-evals/<model>.json; the
 * committed baseline is results/haiku-5.5.json in the corpus.
 *
 * It asserts loose floors only, since it is a benchmark and not a precision
 * gate: no false block, and accuracy at or above ACCURACY_FLOOR. Debatable
 * labels are scored but left out of both floors.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompleteJSONRequest, InferenceProvider, TokenUsage } from "@hawkeyexl/inference";
import { describe, expect, it } from "vitest";
import { runCheck } from "../../../src/tracevals/commands/check.js";
import { TURN_SCORES, type TurnScore } from "../../../src/tracevals/rules/judge-prompt.js";
import {
  CORPUS,
  IsolatedClaudeCli,
  caseRules,
  claudeAvailable,
  corpusConfig,
  extractionGuard,
  homeEnv,
  loadCases,
  ruleKeysOf,
  placementOf,
  scratchConfigDir,
  type Answer,
  type Label,
  type Placement,
} from "../runtime-evals.js";

const live = process.env.MANNI_TRACEVALS_LIVE === "1" && claudeAvailable();
const MODEL = process.env.MANNI_RUNTIME_EVALS_MODEL ?? "claude-haiku-5-5";

/**
 * The accuracy floor, set from the committed Haiku 5.5 baseline. Two runs
 * scored 85.7% and 86.8% on the firm labels, and five placements moved between
 * them, each between needs-review and a pass. 75% leaves about ten pairs of
 * room for that drift. A judge that put every rule in one place would score
 * at most 41%, so the floor still catches a judge that stopped reading.
 */
const ACCURACY_FLOOR = 0.75;

interface PairResult {
  key: string;
  label: Label;
  debatable: boolean;
  placement: Placement;
  /** False when the rule's `when` failed over the turn, so it was never sent to the judge. */
  judged: boolean;
  /** True when the judge's call for this rule errored, which places it as needs-review. */
  errored: boolean;
  severity: "error" | "warning" | null;
  scores: Record<TurnScore, number> | null;
  reasoning: string | null;
  correct: boolean;
  falseBlock: boolean;
  missedBreak: boolean;
}

const isScores = (v: unknown): v is Record<TurnScore, number> & { reasoning?: unknown } =>
  typeof v === "object" && v !== null && TURN_SCORES.every((s) => typeof (v as Record<string, unknown>)[s] === "number");

/**
 * The judge, wrapped to keep each rule's scores and the token use. Each call
 * carries one rule, named in its item as `<source>#<id>: <text>`.
 */
function recording(inner: InferenceProvider, keys: string[]) {
  const answers = new Map<string, Answer>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const keyOf = (user: string): string | undefined => keys.find((k) => user.includes(`\n${k}: `));
  const provider: InferenceProvider = {
    provider: () => inner.provider(),
    modelName: () => inner.modelName(),
    completeJSON: async (req: CompleteJSONRequest) => {
      const key = keyOf(req.user);
      try {
        const response = await inner.completeJSON(req);
        usage.inputTokens += response.usage?.inputTokens ?? 0;
        usage.outputTokens += response.usage?.outputTokens ?? 0;
        if (key !== undefined && isScores(response.json)) {
          const { reasoning } = response.json;
          answers.set(key, {
            scores: {
              "not-applicable": response.json["not-applicable"],
              followed: response.json.followed,
              "not-followed": response.json["not-followed"],
            },
            ...(typeof reasoning === "string" ? { reasoning } : {}),
          });
        }
        return response;
      } catch (err) {
        if (key !== undefined) answers.set(key, { error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    },
  };
  return { provider, answers, usage };
}

const slug = (model: string): string => model.replace(/[^a-z0-9.]+/gi, "-").replace(/^-|-$/g, "");
const pct = (n: number, of: number): string => (of === 0 ? "-" : `${(100 * n / of).toFixed(1)}%`);

describe.skipIf(!live)(`runtime evals (live judge ${MODEL})`, () => {
  it("scores the judge against the hand labels", { timeout: 60 * 60_000 }, async () => {
    const config = await corpusConfig();
    const { autoPass } = config.judge.zones;
    const home = await mkdtemp(join(tmpdir(), "runtime-evals-home-"));
    const scratch = await scratchConfigDir();
    const started = new Date().toISOString();
    const results: {
      id: string;
      what: string;
      ms: number;
      usage: TokenUsage;
      costUsd: number;
      exitCode: number;
      warnings: string[];
      pairs: PairResult[];
    }[] = [];
    try {
      for (const c of loadCases()) {
        const keys = ruleKeysOf(await caseRules(c, config, home));
        const inner = new IsolatedClaudeCli(MODEL);
        const judge = recording(inner, keys);
        const guard = extractionGuard(config);
        const t0 = performance.now();
        const { report } = await runCheck({
          tracePath: join(CORPUS, c.trace),
          project: join(CORPUS, c.project),
          configDir: scratch,
          provider: "claude-cli",
          model: MODEL,
          runs: 1,
          env: homeEnv(home),
          judge: judge.provider,
          extractor: guard,
        });
        const ms = Math.round(performance.now() - t0);
        expect(guard.calls, `${c.id} extracted`).toBe(0);
        const findings = new Map(report.findings.map((f) => [`${f.source}#${f.rule}`, f]));
        const pairs = Object.entries(c.labels).map(([key, entry]): PairResult => {
          const answer = judge.answers.get(key);
          const finding = findings.get(key);
          const placement = placementOf(finding, answer, autoPass);
          const severity = finding?.severity === "error" || finding?.severity === "warning" ? finding.severity : null;
          const blocked = placement === "fail" && severity === "error";
          return {
            key,
            label: entry.label,
            debatable: entry.debatable === true,
            placement,
            judged: answer !== undefined,
            errored: answer?.error !== undefined,
            severity,
            scores: answer?.scores ?? null,
            reasoning: answer?.reasoning ?? answer?.error ?? null,
            correct:
              (entry.label === "not-followed" && placement === "fail") ||
              (entry.label === "followed" && placement === "followed") ||
              (entry.label === "not-applicable" && placement === "not-applicable"),
            falseBlock: blocked && entry.label !== "not-followed",
            missedBreak: entry.label === "not-followed" && placement !== "fail",
          };
        });
        results.push({ id: c.id, what: c.what, ms, usage: judge.usage, costUsd: inner.costUsd, exitCode: report.exitCode, warnings: report.warnings, pairs });
      }
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(scratch, { recursive: true, force: true });
    }

    const all = results.flatMap((r) => r.pairs);
    const firm = all.filter((p) => !p.debatable);
    const tokens = results.reduce(
      (t, r) => ({ inputTokens: t.inputTokens + r.usage.inputTokens, outputTokens: t.outputTokens + r.usage.outputTokens }),
      { inputTokens: 0, outputTokens: 0 },
    );
    const summary = {
      pairs: all.length,
      firm: firm.length,
      debatable: all.length - firm.length,
      correct: firm.filter((p) => p.correct).length,
      accuracy: firm.length === 0 ? 0 : firm.filter((p) => p.correct).length / firm.length,
      falseBlocks: firm.filter((p) => p.falseBlock).length,
      missedBreaks: firm.filter((p) => p.missedBreak).length,
      breaks: firm.filter((p) => p.label === "not-followed").length,
      needsReview: firm.filter((p) => p.placement === "needs-review").length,
      reported: all.filter((p) => p.placement === "fail" && p.severity === "warning").length,
      debatableCorrect: all.filter((p) => p.debatable && p.correct).length,
      errors: all.filter((p) => p.errored).length,
      ms: results.reduce((t, r) => t + r.ms, 0),
      tokens,
      costUsd: Math.round(results.reduce((t, r) => t + r.costUsd, 0) * 10_000) / 10_000,
    };

    const rows = results.map((r) => {
      const firmPairs = r.pairs.filter((p) => !p.debatable);
      const wrong = r.pairs.filter((p) => !p.correct).map((p) => `${p.key} ${p.label}→${p.placement}`);
      return `${r.id.padEnd(24)} ${String(firmPairs.filter((p) => p.correct).length).padStart(2)}/${String(firmPairs.length).padEnd(3)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${wrong.join("; ")}`;
    });
    console.log(
      [
        `runtime evals, judge claude-cli/${MODEL}, runs 1`,
        ...rows,
        `accuracy ${pct(summary.correct, summary.firm)} (${String(summary.correct)}/${String(summary.firm)}), ` +
          `false blocks ${String(summary.falseBlocks)}, missed breaks ${String(summary.missedBreaks)}/${String(summary.breaks)}, ` +
          `needs review ${String(summary.needsReview)}, reported ${String(summary.reported)}, errors ${String(summary.errors)}, ` +
          `debatable ${String(summary.debatableCorrect)}/${String(summary.debatable)} agreed`,
        `${String(tokens.inputTokens)} input and ${String(tokens.outputTokens)} output tokens, ` +
          `$${summary.costUsd.toFixed(4)} as the CLI reports it, ${(summary.ms / 1000).toFixed(1)}s`,
      ].join("\n"),
    );

    const outDir = fileURLToPath(new URL("../../../.tmp/runtime-evals/", import.meta.url));
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, `${slug(MODEL)}.json`),
      `${JSON.stringify({ judge: { provider: "claude-cli", model: MODEL, runs: 1, transport: "isolated claude -p" }, started, summary, cases: results }, null, 2)}\n`,
      "utf-8",
    );

    expect(summary.falseBlocks, "a rule the labels say was kept, or did not apply, blocked").toBe(0);
    expect(summary.accuracy).toBeGreaterThanOrEqual(ACCURACY_FLOOR);
  });
});
