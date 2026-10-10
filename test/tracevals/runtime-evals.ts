/**
 * What the runtime-evals offline test, freeze and live benchmark share: the
 * corpus, its cases and labels, each case's rules as the frozen cache holds
 * them, and an isolated Claude CLI to extract and judge with. The corpus is
 * test/tracevals/fixtures/runtime-evals/, and its README says what it covers.
 */
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractJson,
  validatorFor,
  type CompleteJSONRequest,
  type CompleteJSONResponse,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import { conformanceOf } from "../../src/tracevals/commands/conformance.js";
import { discoverConfig, type TracevalsConfig } from "../../src/tracevals/core/config.js";
import { RulesCache, rulesCacheKey } from "../../src/tracevals/rules/cache.js";
import { promptFor, type Rule } from "../../src/tracevals/rules/extract.js";
import { ruleKey, type TurnScore } from "../../src/tracevals/rules/judge-prompt.js";
import { resolveTurnSources, type RuleSource } from "../../src/tracevals/rules/sources.js";
import { lastTurn } from "../../src/tracevals/rules/turn.js";
import { parseTraceFile } from "../../src/tracevals/trace/claude.js";
import type { Trace } from "../../src/tracevals/trace/types.js";

export const CORPUS = fileURLToPath(new URL("fixtures/runtime-evals", import.meta.url));

export type Label = "followed" | "not-followed" | "not-applicable";

export interface LabelEntry {
  label: Label;
  why: string;
  debatable?: boolean;
}

export interface Case {
  id: string;
  trace: string;
  project: string;
  what: string;
  /** `"<source displayPath>#<rule id>"` to its label. */
  labels: Record<string, LabelEntry>;
}

/** What the freeze records beside the cache. */
export interface Frozen {
  extraction: { provider: string; model: string };
  rulesPromptVersion: number;
  requirementsPromptVersion: number;
}

export function loadCases(): Case[] {
  const parsed = JSON.parse(readFileSync(join(CORPUS, "cases.json"), "utf-8")) as { cases: Case[] };
  return parsed.cases;
}

export function loadFrozen(): Frozen {
  return JSON.parse(readFileSync(join(CORPUS, "cache", "frozen.json"), "utf-8")) as Frozen;
}

export async function corpusConfig(): Promise<TracevalsConfig> {
  return (await discoverConfig(CORPUS)).config;
}

/** An empty home, so no user's own CLAUDE.md or output style is read. */
export function homeEnv(home: string): Record<string, string> {
  return { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, ".claude") };
}

/** The extraction identity the corpus config names, which the cache keys carry. */
export function extractionIdentity(config: TracevalsConfig): { provider: string; model: string } {
  if (config.provider === null || config.model === null) {
    throw new Error("the runtime-evals config must name tracevals.provider and tracevals.model");
  }
  return { provider: config.provider, model: config.model };
}

export interface FrozenSource {
  source: RuleSource;
  key: string;
  /** Undefined when the frozen cache has no entry for this source. */
  rules: Rule[] | undefined;
}

export interface CaseRules {
  trace: Trace;
  sources: FrozenSource[];
}

/** A case's in-scope sources, resolved as `check` resolves them, and their frozen rules. */
export async function caseRules(c: Case, config: TracevalsConfig, home: string): Promise<CaseRules> {
  const trace = await parseTraceFile(join(CORPUS, c.trace));
  const project = join(CORPUS, c.project);
  const { include, exclude, plans } = conformanceOf(config);
  const { sources } = await resolveTurnSources(trace, lastTurn(trace), {
    projectDir: project,
    projectRoot: project,
    env: homeEnv(home),
    include,
    exclude,
    plans,
    redact: config.judge.redact,
  });
  const id = extractionIdentity(config);
  const cache = new RulesCache(join(CORPUS, config.judge.cacheDir, "rules"));
  return {
    trace,
    sources: sources.map((source) => {
      const key = rulesCacheKey({
        provider: id.provider,
        model: id.model,
        prompt: promptFor(source.format),
        temperature: config.judge.temperature,
        sha256: source.sha256,
      });
      return { source, key, rules: source.declaredRules ?? cache.get(key) };
    }),
  };
}

/** Every rule key a case's frozen sources yield. */
export function ruleKeysOf(rules: CaseRules): string[] {
  return rules.sources.flatMap(({ source, rules: found }) =>
    (found ?? []).map((r) => ruleKey(source.displayPath, r.id)),
  );
}

/** Where the pipeline put one rule. */
export type Placement = "fail" | "followed" | "not-applicable" | "needs-review";

/** What the recording judge kept of one rule's call. */
export interface Answer {
  scores?: Record<TurnScore, number>;
  reasoning?: string;
  error?: string;
  /** The call's time; a shared-prefix call's time is split evenly over its rules. */
  ms?: number;
}

/**
 * One rule's placement. A finding is the pipeline's own. A rule with no
 * finding and no call never reached the judge, because its `when` failed. An
 * errored call needs review, since manni never passes an errored item. Any
 * other rule passed, as not applicable when that score cleared the bar.
 */
export function placementOf(
  finding: { outcome: "fail" | "needs-review" } | undefined,
  answer: Answer | undefined,
  autoPass: number,
): Placement {
  if (finding !== undefined) return finding.outcome;
  if (answer === undefined) return "not-applicable";
  if (answer.scores === undefined) return "needs-review";
  return answer.scores["not-applicable"] / 100 >= autoPass ? "not-applicable" : "followed";
}

/**
 * An extraction model that refuses every call, under the identity the config
 * names, so a run that misses the frozen cache fails instead of extracting.
 */
export function extractionGuard(config: TracevalsConfig): InferenceProvider & { calls: number } {
  const id = extractionIdentity(config);
  const guard = {
    calls: 0,
    provider: () => id.provider,
    modelName: () => id.model,
    completeJSON: (): Promise<never> => {
      guard.calls += 1;
      return Promise.reject(new Error("the runtime-evals corpus missed its frozen rules cache"));
    },
  };
  return guard;
}

/**
 * A copy of the config and the frozen cache in a temporary directory, so the
 * verdict cache a run writes stays out of the committed tree. The traces and
 * project trees are only read, so they stay where they are.
 */
export async function scratchConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "runtime-evals-"));
  await cp(join(CORPUS, "manni.config.yaml"), join(dir, "manni.config.yaml"));
  await cp(join(CORPUS, "cache"), join(dir, "cache"), { recursive: true });
  return dir;
}

// -- An isolated Claude CLI ------------------------------------------

/** Flags that leave out Claude Code's own prompt, tools, settings, MCP servers and hooks. */
const ISOLATED = [
  "--output-format", "json",
  "--tools", "",
  "--setting-sources", "",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--disable-slash-commands",
];

/** Whether a `claude` that runs is on PATH. */
export function claudeAvailable(): boolean {
  const probe = spawnSync("claude", ["--version"], { encoding: "utf-8", timeout: 30_000 });
  return probe.status === 0;
}

interface RunOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runClaude(args: string[], input: string, cwd: string, timeoutMs: number): Promise<RunOutput> {
  return new Promise((settle, reject) => {
    const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));
    child.on("error", reject);
    child.on("close", (code) => {
      settle({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

interface CliWrapper {
  result?: unknown;
  is_error?: unknown;
  total_cost_usd?: unknown;
  usage?: Record<string, unknown>;
}

const tokensOf = (usage: Record<string, unknown> | undefined, ...names: string[]): number =>
  names.reduce((sum, n) => {
    const v = usage?.[n];
    return sum + (typeof v === "number" ? v : 0);
  }, 0);

/**
 * A test-only judge and extractor over the logged-in Claude CLI, isolated from
 * the machine it runs on. Each call runs in a new empty directory, with the
 * request's system text as the whole system prompt and no tools, settings,
 * MCP servers or hooks, so neither this repository's CLAUDE.md nor Claude
 * Code's default prompt reaches the model. The library's own `claude-cli`
 * provider appends to that prompt in the process cwd, which is why this exists.
 *
 * It reports as `claude-cli` and the model it was given, so its rules-cache
 * keys match a config that names the same pair.
 */
export class IsolatedClaudeCli implements InferenceProvider {
  calls = 0;
  /** What the CLI reported each call cost, summed. */
  costUsd = 0;

  constructor(
    private readonly model: string,
    private readonly timeoutMs = 300_000,
  ) {}

  provider(): string {
    return "claude-cli";
  }

  modelName(): string {
    return this.model;
  }

  async completeJSON(req: CompleteJSONRequest): Promise<CompleteJSONResponse> {
    this.calls += 1;
    const user = [
      req.user,
      "",
      "Respond with ONLY a JSON object conforming to this JSON Schema, with no prose and no markdown fences:",
      JSON.stringify(req.schema),
    ].join("\n");
    const cwd = await mkdtemp(join(tmpdir(), "runtime-evals-cli-"));
    let out: RunOutput;
    try {
      out = await runClaude(
        ["-p", "--model", this.model, "--system-prompt", req.system, ...ISOLATED],
        user,
        cwd,
        this.timeoutMs,
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
    // The CLI warns on stderr about a model id it does not list; stdout is the wrapper.
    const start = out.stdout.indexOf("{");
    if (out.code !== 0 || start < 0) {
      // A timeout kill leaves no exit code.
      const how = out.code === null ? `timed out after ${String(this.timeoutMs / 1000)}s` : `exited ${String(out.code)}`;
      throw new Error(`claude ${how}: ${(out.stderr.trim() || out.stdout.trim()).slice(-300)}`);
    }
    const wrapper = JSON.parse(out.stdout.slice(start)) as CliWrapper;
    if (typeof wrapper.total_cost_usd === "number") this.costUsd += wrapper.total_cost_usd;
    if (wrapper.is_error === true || typeof wrapper.result !== "string") {
      throw new Error(`claude returned no result: ${JSON.stringify(wrapper.result ?? null).slice(0, 300)}`);
    }
    const json = extractJson(wrapper.result);
    const validate = validatorFor(req.schema);
    if (!validate(json)) {
      throw new Error(`the reply does not match the schema: ${JSON.stringify(validate.errors?.[0] ?? {})}`);
    }
    return {
      json,
      usage: {
        inputTokens: tokensOf(wrapper.usage, "input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"),
        outputTokens: tokensOf(wrapper.usage, "output_tokens"),
      },
    };
  }
}
