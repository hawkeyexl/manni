/**
 * The runtime-evals benchmark: every case of test/tracevals/fixtures/
 * runtime-evals/ through the real check pipeline, `runCheck` by hand, and
 * scored against the hand labels. Rules come from the frozen cache, so no call
 * extracts.
 *
 * MANNI_RUNTIME_EVALS_PROVIDER picks the judge. `claude-cli`, the default,
 * judges through an isolated, logged-in Claude CLI. `llama-cpp` judges through
 * manni's own llama-cpp provider, built as `runCheck` builds it, so the calls
 * take the local model's native shared-prefix path. MANNI_RUNTIME_EVALS_MODEL
 * names another model; the defaults are claude-haiku-5-5 and qwen3.5-4b.
 *
 * Gated behind MANNI_TRACEVALS_LIVE=1, and for claude-cli a `claude` on PATH,
 * and skipped by default. Each run writes its results to
 * .tmp/runtime-evals/<model>.json; the committed baselines are in the
 * corpus's results/.
 *
 * It asserts loose floors only, since it is a benchmark and not a precision
 * gate. FLOORS keys them by model. Debatable labels are scored but left out
 * of every floor.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canDecide,
  disposeLlamaModels,
  validatorFor,
  type CompleteJSONRequest,
  type InferenceProvider,
  type SharedJSONRequest,
  type SharedJSONResponse,
  type TokenUsage,
} from "@hawkeyexl/inference";
import { describe, expect, it, vi } from "vitest";
import { runCheck } from "../../../src/tracevals/commands/check.js";
import { constructProvider } from "../../../src/tracevals/judge/provider.js";
import { hostSetting } from "../../../src/tracevals/rules/host.js";
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

const PROVIDER = process.env.MANNI_RUNTIME_EVALS_PROVIDER ?? "claude-cli";
const LOCAL = PROVIDER === "llama-cpp";
const live = process.env.MANNI_TRACEVALS_LIVE === "1" && (LOCAL || claudeAvailable());
const MODEL = process.env.MANNI_RUNTIME_EVALS_MODEL ?? (LOCAL ? "qwen3.5-4b" : "claude-haiku-5-5");

interface Floor {
  /** The least accuracy on the firm labels. */
  accuracy: number;
  /** The most false blocks on the firm labels. */
  falseBlocks: number;
}

/**
 * Haiku 5.5's floor, which a model with none of its own takes. Two runs scored
 * 85.7% and 86.8% on the firm labels, and five placements moved between them,
 * each between needs-review and a pass. 75% leaves about ten pairs of room for
 * that drift. A judge that put every rule in one place would score at most
 * 41%, so the floor still catches a judge that stopped reading.
 */
const HAIKU_FLOOR: Floor = { accuracy: 0.75, falseBlocks: 0 };

/**
 * Each model's floor, set from its own committed baseline. The corpus README
 * explains each. Qwen 3.5 4B scored 85.7% with 6 false blocks in two runs on
 * Vulkan, placement for placement. Another backend can round a score across
 * the bar, so its floor leaves about five pairs of accuracy and two false
 * blocks of room.
 */
const FLOORS: Record<string, Floor | undefined> = {
  "claude-haiku-5-5": HAIKU_FLOOR,
  "qwen3.5-4b": { accuracy: 0.8, falseBlocks: 8 },
};

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
  /** The judge's time for this rule; a shared-prefix call's time is split over its rules. */
  ms: number | null;
  correct: boolean;
  falseBlock: boolean;
  missedBreak: boolean;
}

const isScores = (v: unknown): v is Record<TurnScore, number> & { reasoning?: unknown } =>
  typeof v === "object" && v !== null && TURN_SCORES.every((s) => typeof (v as Record<string, unknown>)[s] === "number");

type SharedProvider = InferenceProvider & {
  completeJSONShared(req: SharedJSONRequest): Promise<SharedJSONResponse>;
};

const hasSharedPath = (p: InferenceProvider): p is SharedProvider =>
  typeof (p as Partial<SharedProvider>).completeJSONShared === "function";

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** One reply as the recording keeps it, checked against the schema as the library checks it. */
function answerOf(json: unknown, schema: Record<string, unknown>): Answer {
  const validate = validatorFor(schema);
  if (!validate(json) || !isScores(json)) {
    return { error: `the reply does not match the schema: ${JSON.stringify(validate.errors?.[0] ?? {})}` };
  }
  return {
    scores: { "not-applicable": json["not-applicable"], followed: json.followed, "not-followed": json["not-followed"] },
    ...(typeof json.reasoning === "string" ? { reasoning: json.reasoning } : {}),
  };
}

/**
 * The judge, wrapped to keep each rule's scores, reasoning and time, and the
 * token use. Each rule's item names it as `<source>#<id>: <text>`. A provider
 * with a native shared-prefix path keeps it, as does the limit a local model
 * reports, so the pipeline plans and calls as it would unwrapped.
 */
function recording(inner: InferenceProvider, keys: string[]) {
  const answers = new Map<string, Answer>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const keyOf = (text: string): string | undefined => keys.find((k) => text.includes(`\n${k}: `));
  const add = (u: TokenUsage | undefined): void => {
    usage.inputTokens += u?.inputTokens ?? 0;
    usage.outputTokens += u?.outputTokens ?? 0;
  };
  const provider: InferenceProvider = {
    provider: () => inner.provider(),
    modelName: () => inner.modelName(),
    completeJSON: async (req: CompleteJSONRequest) => {
      const key = keyOf(req.user);
      const t0 = performance.now();
      const keep = (a: Answer): void => {
        if (key !== undefined) answers.set(key, { ...a, ms: Math.round(performance.now() - t0) });
      };
      try {
        const response = await inner.completeJSON(req);
        add(response.usage);
        keep(answerOf(response.json, req.schema));
        return response;
      } catch (err) {
        keep({ error: messageOf(err) });
        throw err;
      }
    },
  };
  if (hasSharedPath(inner)) {
    const completeJSONShared = async (req: SharedJSONRequest): Promise<SharedJSONResponse> => {
      const itemKeys = req.items.map(keyOf);
      const t0 = performance.now();
      const keep = (i: number, a: Answer): void => {
        const key = itemKeys[i];
        if (key !== undefined) answers.set(key, { ...a, ms: Math.round((performance.now() - t0) / req.items.length) });
      };
      try {
        const response = await inner.completeJSONShared(req);
        add(response.usage);
        response.answers.forEach((a, i) => {
          keep(i, "error" in a ? { error: a.error } : answerOf(a.json, req.schema));
        });
        return response;
      } catch (err) {
        req.items.forEach((_, i) => {
          keep(i, { error: messageOf(err) });
        });
        throw err;
      }
    };
    Object.assign(provider, { completeJSONShared });
  }
  if (canDecide(inner)) {
    Object.assign(provider, { decide: inner.decide.bind(inner), stateLimit: inner.stateLimit.bind(inner) });
  }
  return { provider, answers, usage };
}

const slug = (model: string): string => model.replace(/[^a-z0-9.]+/gi, "-").replace(/^-|-$/g, "");
const pct = (n: number, of: number): string => (of === 0 ? "-" : `${(100 * n / of).toFixed(1)}%`);

describe.skipIf(!live)(`runtime evals (live judge ${PROVIDER}/${MODEL})`, () => {
  it("scores the judge against the hand labels", { timeout: 60 * 60_000 }, async () => {
    expect(["claude-cli", "llama-cpp"], "MANNI_RUNTIME_EVALS_PROVIDER").toContain(PROVIDER);
    const config = await corpusConfig();
    const { autoPass } = config.judge.zones;
    const home = await mkdtemp(join(tmpdir(), "runtime-evals-home-"));
    const scratch = await scratchConfigDir();
    const started = new Date().toISOString();
    // One local provider for the whole run, so the model loads once. It is
    // built as runCheck builds a judge by hand: through a running model host
    // when there is one, else in this process.
    const local = LOCAL
      ? constructProvider(config, { provider: "llama-cpp", model: MODEL }, { host: hostSetting(false, undefined, undefined) })
      : undefined;
    // A GPU backend that crashes falls back with a console warning, which the results keep.
    const backendWarnings: string[] = [];
    const realWarn = console.warn.bind(console);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      const line = args.map(String).join(" ");
      if (line.includes("llama.cpp")) backendWarnings.push(line);
      realWarn(...args);
    });
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
        // Constructing the CLI judge costs nothing, and a local run never calls it.
        const cli = new IsolatedClaudeCli(MODEL);
        const judge = recording(local ?? cli, keys);
        const guard = extractionGuard(config);
        const t0 = performance.now();
        const { report } = await runCheck({
          tracePath: join(CORPUS, c.trace),
          project: join(CORPUS, c.project),
          configDir: scratch,
          provider: PROVIDER,
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
            ms: answer?.ms ?? null,
            correct:
              (entry.label === "not-followed" && placement === "fail") ||
              (entry.label === "followed" && placement === "followed") ||
              (entry.label === "not-applicable" && placement === "not-applicable"),
            falseBlock: blocked && entry.label !== "not-followed",
            missedBreak: entry.label === "not-followed" && placement !== "fail",
          };
        });
        results.push({
          id: c.id,
          what: c.what,
          ms,
          usage: judge.usage,
          costUsd: cli.costUsd,
          exitCode: report.exitCode,
          warnings: report.warnings,
          pairs,
        });
      }
    } finally {
      warnSpy.mockRestore();
      if (LOCAL) await disposeLlamaModels();
      await rm(home, { recursive: true, force: true });
      await rm(scratch, { recursive: true, force: true });
    }

    const all = results.flatMap((r) => r.pairs);
    const firm = all.filter((p) => !p.debatable);
    const tokens = results.reduce(
      (t, r) => ({ inputTokens: t.inputTokens + r.usage.inputTokens, outputTokens: t.outputTokens + r.usage.outputTokens }),
      { inputTokens: 0, outputTokens: 0 },
    );
    const ms = results.reduce((t, r) => t + r.ms, 0);
    const judged = all.filter((p) => p.judged).length;
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
      judged,
      ms,
      /** Wall time over the rules sent to the judge. */
      secondsPerRule: judged === 0 ? 0 : Math.round(ms / judged) / 1000,
      tokens,
      /** Null for a local model, which costs nothing per call. */
      costUsd: LOCAL ? null : Math.round(results.reduce((t, r) => t + r.costUsd, 0) * 10_000) / 10_000,
    };

    const rows = results.map((r) => {
      const firmPairs = r.pairs.filter((p) => !p.debatable);
      const wrong = r.pairs.filter((p) => !p.debatable && !p.correct).map((p) => `${p.key} ${p.label}→${p.placement}`);
      return `${r.id.padEnd(24)} ${String(firmPairs.filter((p) => p.correct).length).padStart(2)}/${String(firmPairs.length).padEnd(3)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${wrong.join("; ")}`;
    });
    console.log(
      [
        `runtime evals, judge ${PROVIDER}/${MODEL}, runs 1`,
        ...rows,
        `accuracy ${pct(summary.correct, summary.firm)} (${String(summary.correct)}/${String(summary.firm)}), ` +
          `false blocks ${String(summary.falseBlocks)}, missed breaks ${String(summary.missedBreaks)}/${String(summary.breaks)}, ` +
          `needs review ${String(summary.needsReview)}, reported ${String(summary.reported)}, errors ${String(summary.errors)}, ` +
          `debatable ${String(summary.debatableCorrect)}/${String(summary.debatable)} agreed`,
        `${String(tokens.inputTokens)} input and ${String(tokens.outputTokens)} output tokens, ` +
          (summary.costUsd === null ? "" : `$${summary.costUsd.toFixed(4)} as the CLI reports it, `) +
          `${(ms / 1000).toFixed(1)}s, ${summary.secondsPerRule.toFixed(2)}s per judged rule`,
        ...(backendWarnings.length > 0 ? [`backend: ${backendWarnings.join(" | ")}`] : []),
      ].join("\n"),
    );

    const judgeInfo = LOCAL
      ? {
          provider: PROVIDER,
          model: MODEL,
          runs: 1,
          transport: "manni's llama-cpp provider, host connect",
          gpu: process.env.NODE_LLAMA_CPP_GPU ?? "auto",
          backendWarnings,
        }
      : { provider: PROVIDER, model: MODEL, runs: 1, transport: "isolated claude -p" };
    const outDir = fileURLToPath(new URL("../../../.tmp/runtime-evals/", import.meta.url));
    await mkdir(outDir, { recursive: true });
    await writeFile(
      join(outDir, `${slug(MODEL)}.json`),
      `${JSON.stringify({ judge: judgeInfo, started, summary, cases: results }, null, 2)}\n`,
      "utf-8",
    );

    const floor = FLOORS[MODEL] ?? HAIKU_FLOOR;
    expect(summary.falseBlocks, "a rule the labels say was kept, or did not apply, blocked").toBeLessThanOrEqual(
      floor.falseBlocks,
    );
    expect(summary.accuracy).toBeGreaterThanOrEqual(floor.accuracy);
  });
});
