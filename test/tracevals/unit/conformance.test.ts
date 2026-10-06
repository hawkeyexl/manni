/**
 * `check`, `prepare` and `release`, through their command cores (proposal
 * 0079). Every run works on a copy of the conformance fixture project, so the
 * rules and verdict caches they write never reach the committed tree, and the
 * user-level sources come from an empty home.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MockProvider,
  type CompleteJSONRequest,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import { checkTurn, runCheck, type CheckOptions } from "../../../src/tracevals/commands/check.js";
import { JUDGE_ENV } from "../../../src/tracevals/commands/conformance.js";
import { runPrepare } from "../../../src/tracevals/commands/prepare.js";
import { runRelease } from "../../../src/tracevals/commands/release.js";
import { renderRelease } from "../../../src/tracevals/reporters/conformance.js";
import type { HostApi } from "../../../src/tracevals/rules/host.js";
import type { LocalModels } from "../../../src/tracevals/rules/local.js";
import { mockTurnJudge, mockTurnScores } from "../../../src/tracevals/rules/mock.js";
import { ledgerPath, recordTurn, writeLedger, type Ledger } from "../../../src/tracevals/rules/ledger.js";
import { JEV_OUT_OF_LOOP } from "../../../src/tracevals/judge/provider.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "conformance");
const TRACES = join(FIXTURE, "traces");
const trace = (name: string): string => join(TRACES, `${name}.jsonl`);

let dir: string;
let project: string;
let env: Record<string, string>;
const savedJudgeEnv = process.env[JUDGE_ENV];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "conformance-"));
  project = join(dir, "project");
  await cp(join(FIXTURE, "project"), project, { recursive: true });
  const home = join(dir, "home");
  env = { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, USERPROFILE: home };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  if (savedJudgeEnv === undefined) delete process.env[JUDGE_ENV];
  else process.env[JUDGE_ENV] = savedJudgeEnv;
  delete process.env["TYPESAFE_API_KEY"];
  resetWarnings();
});

const check = (name: string, extra: Partial<CheckOptions> = {}) =>
  runCheck({ tracePath: trace(name), project, configDir: project, env, ...extra });

const hook = (name: string, extra: Partial<Parameters<typeof checkTurn>[0]> = {}) =>
  checkTurn({
    transcriptPath: trace(name),
    sessionId: "3b265d00-0000-4000-8000-000000000001",
    cwd: project,
    inLoop: true,
    env,
    ...extra,
  });

async function config(yaml: string): Promise<void> {
  await writeFile(join(project, "manni.config.yaml"), yaml);
}

/** A provider that can only generate, answering each call from its request. */
function generative(
  answer: (req: CompleteJSONRequest) => unknown,
): InferenceProvider & { requests: CompleteJSONRequest[] } {
  const requests: CompleteJSONRequest[] = [];
  return {
    requests,
    provider: () => "mock",
    modelName: () => "mock-model",
    completeJSON: (req) => {
      requests.push(req);
      return Promise.resolve({ json: answer(req) });
    },
  };
}

/** A local judge, without a runtime: mock scores under llama-cpp's name. */
function llama(): InferenceProvider {
  return mockTurnJudge("qwen3.5-4b", "llama-cpp");
}

/** No model host running, and nothing a test can start. */
const noHost: HostApi = {
  lease: () => Promise.resolve(null),
  status: () => Promise.resolve(null),
  release: () => Promise.resolve({ released: [], unloaded: [], hostStopped: false }),
};

function localModels(overrides: Partial<LocalModels> = {}): LocalModels & { ensured: string[] } {
  const ensured: string[] = [];
  return {
    ensured,
    runtimePresent: () => Promise.resolve(true),
    state: () => Promise.resolve("ready"),
    fits: () => Promise.resolve({ fits: true, needBytes: 1, freeBytes: 2 }),
    ensure: (model) => {
      ensured.push(model);
      return Promise.resolve({ state: "downloaded", bytes: 3_124_000_000 });
    },
    ...overrides,
  };
}

describe("check by hand", () => {
  it("fails a confident violation and reports what needs review", async () => {
    const { report, rendered } = await check("breaks");
    expect(report.exitCode).toBe(1);
    expect(report.skipped).toBeNull();
    expect(report.sessionId).toBe("3b265d00-0000-4000-8000-000000000001");
    expect(report.agentId).toBeNull();
    expect(report.judge).toEqual({ provider: "mock", model: "mock-model", mode: "generative", runs: 3 });
    expect(report.extraction).toEqual({ provider: "mock", model: "mock-model" });
    const byPath = Object.fromEntries(report.sources.map((s) => [s.path, s]));
    expect(byPath["CLAUDE.md"]).toMatchObject({ format: "claude-md", trigger: "always", rules: 2, origin: "declared" });
    expect(byPath[".cursor/rules/web.mdc"]).toMatchObject({
      format: "cursor-rule",
      trigger: "globs matched src/web/App.tsx",
      origin: "extracted",
    });
    expect(byPath[".claude/skills/demo/references/style.md"]).toMatchObject({ format: "skill", skill: "demo" });
    expect(byPath[".cursor/rules/stale.mdc"]).toBeUndefined();
    const outcomes = report.findings.map((f) => `${f.source}#${f.rule}:${f.outcome}`);
    expect(outcomes).toContain("CLAUDE.md#no-force-push:fail");
    expect(outcomes).toContain("CLAUDE.md#run-npm-ci-first:needs-review");
    expect(outcomes).toContain(".cursor/rules/web.mdc#never-use-innerhtml-in-components:fail");
    expect(report.summary).toMatchObject({ fail: 2, needsReview: 1, sources: report.sources.length });
    expect(rendered).toContain(
      "CLAUDE.md\n  ? run-npm-ci-first  Run `npm ci` before `npm test` in a fresh worktree.\n      not-followed 0, followed 0, not-applicable 0. The turn does not show `npm ci`. (0.00)\n  ✖ no-force-push  Never run `git push --force`.",
    );
    expect(rendered.split("\n").at(-1)).toBe(
      `Last turn of 3b265d00: ${String(report.summary.rules)} rules from ${String(report.sources.length)} files. 2 broken, 1 needs review.`,
    );
  });

  it("passes a turn that followed every rule", async () => {
    const { report, rendered } = await check("follows");
    expect(report.exitCode).toBe(0);
    expect(report.findings).toEqual([]);
    expect(rendered).toMatch(/^Last turn of 3b265d00: \d+ rules from \d+ files\. None broken\.$/);
  });

  it("skips a turn no rule applies to, counting every rule not applicable", async () => {
    const { report, rendered } = await check("untouched", {
      config: join(project, "narrow.config.yaml"),
    });
    expect(report.skipped).toBe("not-applicable");
    expect(report.summary).toMatchObject({ sources: 1, rules: 2, notApplicable: 2, fail: 0 });
    expect(report.judge).toBeNull();
    expect(report.exitCode).toBe(0);
    expect(rendered).toBe("Last turn of 3b265d00: 2 rules from 1 file, none apply to this turn.");
  });

  it("skips an empty turn and a turn no source governed", async () => {
    const empty = await check("empty-turn");
    expect(empty.report.skipped).toBe("empty-turn");
    const bare = join(dir, "bare");
    await mkdir(bare);
    const none = await check("follows", { project: bare });
    expect(none.report.skipped).toBe("no-sources");
    expect(none.rendered).toBe("Last turn of 3b265d00: no rule sources governed it.");
  });

  it("extracts a file once per version, and again under --no-cache", async () => {
    await check("breaks");
    const replay = new MockProvider([{ error: "should not be asked" }]);
    const again = await check("breaks", { extractor: replay });
    expect(replay.requests).toHaveLength(0);
    expect(again.report.extraction).toBeNull();
    const fresh = new MockProvider([{ json: { rules: [] } }]);
    await check("breaks", { extractor: fresh, noCache: true });
    expect(fresh.requests.length).toBeGreaterThan(0);
  });

  it("lets flags choose the judge and never the extraction model", async () => {
    const { report } = await check("breaks", { provider: "mock", model: "other-model", runs: 5 });
    expect(report.judge).toMatchObject({ provider: "mock", model: "other-model", runs: 5 });
    expect(report.extraction).toEqual({ provider: "mock", model: "mock-model" });
  });

  it("accepts jev as the judge by hand, and names its missing key", async () => {
    delete process.env["TYPESAFE_API_KEY"];
    await expect(check("breaks", { provider: "jev" })).rejects.toThrow(
      "jev needs an API key in TYPESAFE_API_KEY",
    );
  });

  it("refuses jev as the extraction model", async () => {
    await config("tracevals:\n  provider: jev\n  conformance: {}\n");
    await expect(check("breaks", { provider: "mock" })).rejects.toThrow(JEV_OUT_OF_LOOP);
  });

  it("scores each rule in every run with a provider that cannot decide", async () => {
    const judge = generative((req) =>
      req.user.includes("CLAUDE.md#no-force-push:")
        ? { reasoning: "Pushed with --force.", "not-applicable": 0, followed: 5, "not-followed": 95 }
        : { reasoning: "Fine.", "not-applicable": 0, followed: 100, "not-followed": 0 },
    );
    const { report } = await check("breaks", { judge, runs: 3 });
    expect(report.judge).toMatchObject({ mode: "generative", runs: 3 });
    const pushCalls = judge.requests.filter((r) => r.user.includes("CLAUDE.md#no-force-push:"));
    expect(pushCalls).toHaveLength(3);
    expect(report.findings).toEqual([
      {
        source: "CLAUDE.md",
        rule: "no-force-push",
        text: "Never run `git push --force`.",
        outcome: "fail",
        observed: "not-followed 95, followed 5, not-applicable 0. Pushed with --force.",
        confidence: 0.95,
        reasoning: "Pushed with --force.",
      },
    ]);
  });

  it("refuses a local judge that is not on disk, and downloads nothing", async () => {
    const local = localModels({ state: () => Promise.resolve("missing") });
    await expect(check("breaks", { judge: llama(), localModels: local })).rejects.toThrow(
      "qwen3.5-4b is not downloaded; run manni tracevals prepare",
    );
    expect(local.ensured).toEqual([]);
  });

  it("refuses a network judge under --offline", async () => {
    await expect(check("breaks", { provider: "anthropic", offline: true })).rejects.toThrow(
      "--offline runs no network provider, and the judge uses anthropic",
    );
  });

  it("names a trace it cannot read", async () => {
    await expect(runCheck({ tracePath: join(dir, "nope.jsonl"), env })).rejects.toThrow(
      /^cannot read trace .*nope\.jsonl: ENOENT/,
    );
  });

  it("marks this process as the judge's before building a provider", async () => {
    delete process.env[JUDGE_ENV];
    await check("breaks");
    expect(process.env[JUDGE_ENV]).toBe("1");
  });
});

describe("checkTurn, inside a hook", () => {
  it("stays silent when conformance is not set up (gate 1)", async () => {
    await config("tracevals:\n  provider: mock\n");
    expect(await hook("breaks")).toEqual({ skipped: { gate: "not-in-play" }, findings: [], exitCode: 0 });
  });

  it("stays silent in a judge's own session (gate 2)", async () => {
    const result = await hook("breaks", { env: { ...env, [JUDGE_ENV]: "1" } });
    expect(result).toEqual({ skipped: { gate: "judge-session" }, findings: [], exitCode: 0 });
  });

  it("skips an empty turn, no sources, and no applicable rule (gates 3, 4, 6)", async () => {
    expect((await hook("empty-turn")).skipped).toEqual({ gate: "empty-turn" });
    const bare = join(dir, "bare");
    await mkdir(bare);
    await writeFile(join(bare, "manni.config.yaml"), "tracevals:\n  provider: mock\n  conformance: {}\n");
    expect((await hook("follows", { cwd: bare })).skipped).toEqual({ gate: "no-sources" });
    await config(
      "tracevals:\n  provider: mock\n  conformance:\n    exclude: [AGENTS.md, .cursor/rules/stale.mdc]\n",
    );
    const none = await hook("untouched");
    expect(none.skipped).toEqual({ gate: "not-applicable" });
    expect(none.report?.summary.notApplicable).toBe(2);
  });

  it("judges with the hook's model and extracts with the out-of-loop one", async () => {
    await config(
      "tracevals:\n  provider: mock\n  conformance:\n    exclude: [.cursor/rules/stale.mdc]\n    hook: { model: hook-model, runs: 2 }\n",
    );
    const result = await hook("breaks");
    expect(result.exitCode).toBe(1);
    expect(result.report?.judge).toMatchObject({ provider: "mock", model: "hook-model" });
    expect(result.report?.extraction).toEqual({ provider: "mock", model: "mock-model" });
    expect(result.findings.some((f) => f.rule === "no-force-push" && f.outcome === "fail")).toBe(true);
    expect(result.judgement?.cached).toBe(false);
  });

  it("reuses the verdict for the same turn, rules and model (gate 7)", async () => {
    await hook("breaks");
    const again = await hook("breaks");
    expect(again.judgement?.cached).toBe(true);
    expect(again.exitCode).toBe(1);
  });

  it("skips while the local model downloads (gate 5)", async () => {
    const result = await hook("breaks", {
      judge: llama(),
      localModels: localModels({ state: () => Promise.resolve("downloading") }),
    });
    expect(result).toEqual({
      skipped: { gate: "downloading", message: "tracevals skipped this turn: qwen3.5-4b is still downloading." },
      findings: [],
      exitCode: 0,
    });
  });

  it("skips a local model or runtime not on disk, downloading nothing (gate 8)", async () => {
    const message =
      "tracevals skipped this turn: qwen3.5-4b is not downloaded yet. Run manni tracevals prepare to fetch it.";
    const missing = localModels({ state: () => Promise.resolve("missing") });
    expect((await hook("breaks", { judge: llama(), localModels: missing })).skipped).toEqual({
      gate: "not-downloaded",
      message,
    });
    const noRuntime = localModels({ runtimePresent: () => Promise.resolve(false) });
    expect((await hook("breaks", { judge: llama(), localModels: noRuntime })).skipped).toEqual({
      gate: "not-downloaded",
      message,
    });
    expect([...missing.ensured, ...noRuntime.ensured]).toEqual([]);
  });

  it("skips when the model does not fit, in whole gigabytes (gate 9)", async () => {
    const GiB = 1024 ** 3;
    const tight = localModels({
      fits: () => Promise.resolve({ fits: false, needBytes: 10.2 * GiB, freeBytes: 6.4 * GiB }),
    });
    expect((await hook("breaks", { judge: llama(), localModels: tight, hostApi: noHost })).skipped).toEqual({
      gate: "memory",
      message: "tracevals skipped this turn: qwen3.5-4b needs about 10 GB and 6 GB is free.",
    });
  });

  describe("the memory gate is skipped when it cannot matter", () => {
    const boom = localModels({ fits: () => Promise.reject(new Error("fits must not be called")) });
    const counted = (): { local: LocalModels; fits: ReturnType<typeof vi.fn> } => {
      const fits = vi.fn(() => Promise.resolve({ fits: true, needBytes: 1, freeBytes: 2 }));
      return { local: localModels({ fits }), fits };
    };
    const holding: HostApi = {
      ...noHost,
      status: () =>
        Promise.resolve({
          pid: 1,
          models: [{ model: "qwen3.5-4b", sessions: 1, idleMs: 0, queued: 0 }],
        } as Awaited<ReturnType<HostApi["status"]>>),
    };

    it("never probes memory for a turn whose every verdict is cached", async () => {
      const first = await hook("breaks", { judge: llama(), localModels: localModels(), hostApi: noHost });
      expect(first.judgement?.cached).toBe(false);
      const again = await hook("breaks", { judge: llama(), localModels: boom, hostApi: noHost });
      expect(again.skipped).toBeUndefined();
      expect(again.judgement?.cached).toBe(true);
      expect(again.exitCode).toBe(1);
    });

    it("keeps a remembered state limit, so a cached turn never asks the provider", async () => {
      let asked = 0;
      const limited = (): InferenceProvider =>
        Object.assign(llama(), {
          stateLimit: () => {
            asked += 1;
            return Promise.resolve(8192);
          },
          decide: () => Promise.reject(new Error("generative path only")),
        });
      await hook("breaks", { judge: limited(), localModels: localModels(), hostApi: noHost });
      expect(asked).toBe(1);
      const again = await hook("breaks", { judge: limited(), localModels: boom, hostApi: noHost });
      expect(again.judgement?.cached).toBe(true);
      expect(asked).toBe(1);
    });

    it("probes memory when a verdict is missing, as before", async () => {
      const first = counted();
      await hook("breaks", { judge: llama(), localModels: first.local, hostApi: noHost });
      expect(first.fits).toHaveBeenCalledTimes(1);
      // A different model has nothing cached, so it is probed again.
      const other = counted();
      await hook("breaks", {
        judge: mockTurnJudge("other-model", "llama-cpp"),
        localModels: other.local,
        hostApi: noHost,
      });
      expect(other.fits).toHaveBeenCalledTimes(1);
    });

    it("never probes memory when the host already holds the model", async () => {
      const result = await hook("breaks", { judge: llama(), localModels: boom, hostApi: holding });
      expect(result.skipped).toBeUndefined();
      expect(result.judgement?.cached).toBe(false);
    });

    it("probes memory when the host holds a different model", async () => {
      const probe = counted();
      const other: HostApi = {
        ...noHost,
        status: () =>
          Promise.resolve({
            pid: 1,
            models: [{ model: "something-else", sessions: 1, idleMs: 0, queued: 0 }],
          } as Awaited<ReturnType<HostApi["status"]>>),
      };
      await hook("breaks", { judge: llama(), localModels: probe.local, hostApi: other });
      expect(probe.fits).toHaveBeenCalledTimes(1);
    });

    it("keeps the memory message, whatever the cache holds", async () => {
      const GiB = 1024 ** 3;
      const tight = localModels({
        fits: () => Promise.resolve({ fits: false, needBytes: 10.2 * GiB, freeBytes: 6.4 * GiB }),
      });
      const result = await hook("breaks", { judge: llama(), localModels: tight, hostApi: noHost });
      expect(result.skipped?.message).toBe(
        "tracevals skipped this turn: qwen3.5-4b needs about 10 GB and 6 GB is free.",
      );
    });
  });

  it("judges a local model that is ready, scoring each rule", async () => {
    const result = await hook("breaks", { judge: llama(), localModels: localModels(), hostApi: noHost });
    expect(result.report?.judge).toMatchObject({ provider: "llama-cpp", mode: "generative", runs: 1 });
    expect(result.exitCode).toBe(1);
  });

  it("judges a subagent's own transcript, naming the agent", async () => {
    const result = await hook("follows", {
      agentTranscriptPath: trace("breaks"),
      agentId: "a1b2",
    });
    expect(result.report?.agentId).toBe("a1b2");
    expect(result.report?.trace).toBe(trace("breaks"));
  });
});

describe("the session ledger", () => {
  const SESSION = "3b265d00-0000-4000-8000-000000000001";
  const PUSH = "CLAUDE.md#no-force-push";
  const PUSH_TEXT = "Never run `git push --force`.";
  const read = async (agent: string | null = null): Promise<Ledger> =>
    JSON.parse(await readFile(ledgerPath(project, SESSION, agent), "utf-8")) as Ledger;
  const followedBy = (model: string): InferenceProvider => ({
    ...generative(() => ({ reasoning: "Fixed.", "not-applicable": 0, followed: 100, "not-followed": 0 })),
    modelName: () => model,
  });

  it("records each judged rule after a hook, and the repair pass replaces the turn", async () => {
    const first = await hook("breaks");
    const from = first.report?.turn.from ?? -1;
    const ledger = await read();
    expect(ledger.rules[PUSH]?.entries).toEqual([
      { turn: from, outcome: "broken", note: "The turn shows `git push --force`." },
    ]);
    expect(Object.keys(ledger.rules)).toHaveLength(first.judgement?.judged ?? -1);
    await hook("breaks", { judge: followedBy("repair-model") });
    expect((await read()).rules[PUSH]?.entries).toEqual([{ turn: from, outcome: "followed", note: "Fixed." }]);
  });

  it("records the facts of a judged turn, and the repair pass replaces them", async () => {
    const first = await hook("breaks");
    const from = first.report?.turn.from ?? -1;
    const [facts] = (await read()).turns;
    expect(facts).toMatchObject({ turn: from, inScope: true });
    expect(facts?.sources).toContain("CLAUDE.md");
    expect(facts?.commands).toContainEqual(expect.stringContaining("git push --force"));
    await hook("breaks", { judge: followedBy("repair-model") });
    expect((await read()).turns.map((t) => t.turn)).toEqual([from]);
  });

  it("records a turn that ends at gates 3, 4 and 6, with no judge call", async () => {
    const judge = generative(() => {
      throw new Error("the judge must not be asked");
    });
    expect((await hook("empty-turn", { judge })).skipped).toEqual({ gate: "empty-turn" });
    expect((await read()).turns).toEqual([
      expect.objectContaining({ inScope: false, sources: [], commands: [], wrote: [] }),
    ]);

    const bare = join(dir, "bare");
    await mkdir(bare);
    await writeFile(join(bare, "manni.config.yaml"), "tracevals:\n  provider: mock\n  conformance: {}\n");
    expect((await hook("follows", { cwd: bare, judge })).skipped).toEqual({ gate: "no-sources" });
    const [none] = (JSON.parse(await readFile(ledgerPath(bare, SESSION, null), "utf-8")) as Ledger).turns;
    expect(none).toMatchObject({ inScope: false, sources: [] });
    expect(none?.commands.length).toBeGreaterThan(0);

    await config("tracevals:\n  provider: mock\n  conformance:\n    exclude: [AGENTS.md, .cursor/rules/stale.mdc]\n");
    expect((await hook("untouched", { judge })).skipped).toEqual({ gate: "not-applicable" });
    const ledger = await read();
    expect(ledger.turns).toContainEqual(
      expect.objectContaining({ inScope: true, sources: expect.arrayContaining(["CLAUDE.md"]) as unknown }),
    );
    expect(ledger.rules).toEqual({});
    expect(judge.requests).toHaveLength(0);
  });

  it("keeps a subagent's ledger apart from the session's", async () => {
    await hook("follows", { agentTranscriptPath: trace("breaks"), agentId: "a1b2" });
    const agent = await read("a1b2");
    expect(agent.rules[PUSH]?.entries[0]?.outcome).toBe("broken");
    expect(agent.turns).toHaveLength(1);
    await expect(read()).rejects.toThrow(/ENOENT/);
  });

  it("shares earlier turns' facts with the judge by hand, ignoring this turn and later", async () => {
    const { report: probe } = await check("breaks");
    const from = probe.turn.from;
    const at = (turn: number, commands: string[]) => ({
      turn, inScope: true, sources: ["CLAUDE.md"], commands, wrote: [], read: [], skills: [], agents: [],
    });
    const earlier: Ledger = { version: 1, turns: [at(0, ["npm ci"]), at(from, ["npm run this-turn"])], rules: {} };
    await writeLedger(ledgerPath(project, SESSION, null), earlier);
    const judge = generative(() => ({ reasoning: "Fine.", "not-applicable": 0, followed: 100, "not-followed": 0 }));
    await check("breaks", { judge, noCache: true });
    expect(judge.requests.length).toBeGreaterThan(0);
    for (const r of judge.requests) {
      expect(r.user.startsWith("# Earlier in this session\n\n- turn 0: ran npm ci\n\n# The turn\n\n")).toBe(true);
      expect(r.user).not.toContain("this-turn");
    }
    expect(await read()).toEqual(earlier);
  });

  it("sums the session up by hand, in pretty and JSON", async () => {
    let ledger: Ledger = {
      version: 1,
      turns: [0, 1, 2].map((turn) => ({
        turn, inScope: true, sources: ["CLAUDE.md"], commands: [], wrote: [], read: [], skills: [], agents: [],
      })),
      rules: {},
    };
    ledger = recordTurn(ledger, 0, [{ key: PUSH, text: PUSH_TEXT, outcome: "broken", note: "" }]);
    ledger = recordTurn(ledger, 1, [{ key: PUSH, text: PUSH_TEXT, outcome: "followed", note: "" }]);
    ledger = recordTurn(ledger, 1, [{ key: "CLAUDE.md#run-npm-ci-first", text: "x", outcome: "followed", note: "" }]);
    ledger = recordTurn(ledger, 2, [{ key: "AGENTS.md#one-change", text: "y", outcome: "not-applicable", note: "" }]);
    await writeLedger(ledgerPath(project, SESSION, null), ledger);
    const { report, rendered } = await check("follows");
    expect(report.session).toEqual({
      turns: 3,
      rules: [
        expect.objectContaining({ source: "CLAUDE.md", rule: "no-force-push", broken: 1, repaired: 1, followed: 1, notInScope: 0 }),
        expect.objectContaining({ source: "CLAUDE.md", rule: "run-npm-ci-first", followed: 1 }),
        expect.objectContaining({ source: "AGENTS.md", rule: "one-change", notApplicable: 1, notInScope: 3 }),
      ],
    });
    expect(rendered).toContain(
      "Session so far\n  CLAUDE.md#no-force-push  broken 1, repaired 1, followed 1\n  2 rules held every turn they applied to.\n",
    );
    const json = await check("follows", { format: "json" });
    expect((JSON.parse(json.rendered) as { session: unknown }).session).toEqual(report.session);
  });

  it("reports no session when there is no ledger, and leaves it out of the hook's report", async () => {
    const { report, rendered } = await check("follows", { format: "json" });
    expect(report.session).toBeNull();
    expect(rendered).toContain('"session": null');
    await hook("breaks");
    const second = await hook("breaks");
    expect(second.report?.session).toBeNull();
  });

  it("shows a rule's earlier turns to the judge by hand, and never writes the ledger", async () => {
    const earlier = recordTurn({ version: 1, turns: [], rules: {} }, 0, [
      { key: PUSH, text: PUSH_TEXT, outcome: "broken", note: "Forced a push." },
    ]);
    await writeLedger(ledgerPath(project, SESSION, null), earlier);
    const judge = generative(() => ({ reasoning: "Fine.", "not-applicable": 0, followed: 100, "not-followed": 0 }));
    const { report } = await check("breaks", { judge });
    expect(report.turn.from).toBeGreaterThan(0);
    const push = judge.requests.find((r) => r.user.includes(`# The rule\n\n${PUSH}:`));
    expect(push?.user).toContain(`${PUSH_TEXT}\n\n# This rule earlier in this session\n\n- turn 0: broken. Forced a push.\n\nFirst say`);
    expect(await read()).toEqual(earlier);
  });

  it("writes nothing by hand when there is no ledger", async () => {
    await check("breaks");
    await expect(read()).rejects.toThrow(/ENOENT/);
  });

  it("warns when it cannot write the ledger, and still judges", async () => {
    // A directory where the file goes: it reads as no history and cannot be replaced.
    await mkdir(ledgerPath(project, SESSION, null), { recursive: true });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const result = await hook("breaks");
      expect(result.exitCode).toBe(1);
      expect(stderr.mock.calls.map((c) => String(c[0]))).toContainEqual(
        expect.stringMatching(/could not write the session ledger .*\.ledger\.json: /),
      );
    } finally {
      stderr.mockRestore();
    }
  });
});

describe("prepare", () => {
  it("says so when conformance is not set up", async () => {
    await config("tracevals:\n  provider: mock\n");
    const result = await runPrepare({ stdin: "", project, env });
    expect(result.stdout).toBe("tracevals conformance is not set up; nothing to prepare.");
    expect(result.exitCode).toBe(0);
  });

  it("extracts every always source once, then finds them cached", async () => {
    const first = await runPrepare({ stdin: "", project, env });
    expect(first.report.extraction).toEqual({
      provider: "mock",
      model: "mock-model",
      extracted: 1,
      cached: 0,
      rules: 2,
    });
    expect(first.stdout).toBe("Extracted 2 rules from 1 file that applies to every session.");
    const second = await runPrepare({ stdin: "", project, env });
    expect(second.report.extraction).toMatchObject({ extracted: 0, cached: 1 });
    expect(second.stdout).toBe("1 file that applies to every session is cached. Nothing to extract.");
    const forced = await runPrepare({ stdin: "", project, env, noCache: true });
    expect(forced.report.extraction).toMatchObject({ extracted: 1, cached: 0 });
  });

  it("warms the cache check reads", async () => {
    await runPrepare({ stdin: "", project, env });
    const replay = new MockProvider([{ error: "should not be asked" }]);
    await check("follows", { extractor: replay, config: join(project, "manni.config.yaml") });
    // AGENTS.md was prepared; the turn's other sources were declared.
    expect(replay.requests).toHaveLength(0);
  });

  it("lists hosted models, and fetches a local one once", async () => {
    const local = localModels();
    await config(
      "tracevals:\n  provider: mock\n  conformance:\n    hook: { provider: llama-cpp, model: qwen3.5-4b }\n",
    );
    const result = await runPrepare({ stdin: "", project, env, localModels: local, format: "json" });
    expect(result.report.models).toEqual([
      { role: "hook", provider: "llama-cpp", model: "qwen3.5-4b", state: "downloaded", bytes: 3_124_000_000 },
      { role: "extraction", provider: "mock", model: "mock-model", state: "hosted", bytes: null },
    ]);
    expect(JSON.parse(result.stdout)).toEqual(result.report);
    expect(local.ensured).toEqual(["qwen3.5-4b"]);
    const pretty = await runPrepare({ stdin: "", project, env, localModels: local });
    expect(pretty.stdout.split("\n")[0]).toBe("qwen3.5-4b (llama-cpp) downloaded, 2.91 GB.");
  });

  it("names a model it could not download", async () => {
    await config("tracevals:\n  provider: mock\n  conformance:\n    hook: { provider: llama-cpp, model: qwen3.5-4b }\n");
    const local = localModels({ ensure: () => Promise.reject(new Error("disk full\nmore")) });
    await expect(runPrepare({ stdin: "", project, env, localModels: local })).rejects.toThrow(
      "could not download qwen3.5-4b: disk full",
    );
  });

  it("names a file it could not extract", async () => {
    const extractor = new MockProvider([{ error: "boom" }]);
    await expect(runPrepare({ stdin: "", project, env, extractor })).rejects.toThrow(
      /^could not extract rules from AGENTS\.md: /,
    );
  });

  it("skips hosted extraction under --offline", async () => {
    await config("tracevals:\n  provider: anthropic\n  conformance: {}\n");
    const result = await runPrepare({ stdin: "", project, env, offline: true, format: "json" });
    expect(result.report.extraction).toBeNull();
    expect(result.report.models.every((m) => m.state === "hosted")).toBe(true);
  });

  it("refuses jev as the extraction model", async () => {
    await config("tracevals:\n  provider: jev\n  conformance: {}\n");
    await expect(runPrepare({ stdin: "", project, env })).rejects.toThrow(JEV_OUT_OF_LOOP);
  });

  it("writes nothing to stdout under a hook envelope", async () => {
    const stdin = JSON.stringify({ session_id: "s1", cwd: project, hook_event_name: "SessionStart" });
    const result = await runPrepare({ stdin, env });
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Extracted 2 rules");
  });
});

describe("release", () => {
  it("says no host is running, with --all", async () => {
    const result = await runRelease({ stdin: "", all: true, hostApi: noHost });
    expect(result.stdout).toBe("No model host is running.");
    expect(result.report).toEqual({ released: [], unloaded: [], hostStopped: false, exitCode: 0 });
    const json = await runRelease({ stdin: "", all: true, format: "json", hostApi: noHost });
    expect(JSON.parse(json.stdout)).toEqual(result.report);
  });

  it("releases the envelope's session, writing nothing to stdout", async () => {
    const stdin = JSON.stringify({ session_id: "s1", hook_event_name: "SessionEnd" });
    const result = await runRelease({ stdin, hostApi: noHost });
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("needs a session or --all", async () => {
    await expect(runRelease({ stdin: "" })).rejects.toThrow(
      "release needs a session from a SessionEnd hook, or --all",
    );
  });

  it("says what a running host gave up", () => {
    expect(
      renderRelease({ released: ["a", "b"], unloaded: ["qwen3.5-4b"], hostStopped: true, exitCode: 0 }),
    ).toBe("Unloaded qwen3.5-4b and stopped the model host. 2 sessions held it.");
  });
});

describe("mockTurnScores", () => {
  const ask = (rule: string, turn: string) =>
    mockTurnScores(`# The turn\n\n${turn}\n\n# The rule\n\nCLAUDE.md#x: ${rule}\n\nScore it.`);
  const scores = (reasoning: string, followed: number, notFollowed: number) => ({
    reasoning,
    "not-applicable": 0,
    followed,
    "not-followed": notFollowed,
  });

  it("reads a prohibition's code span from the turn only", () => {
    expect(ask("Never run `git push --force`.", "git push --force origin")).toEqual(
      scores("The turn shows `git push --force`.", 0, 100),
    );
    expect(ask("Never run `git push --force`.", "git push origin")).toEqual(
      scores("The turn does not show `git push --force`.", 100, 0),
    );
  });

  it("scores any other rule followed when its span shows, and nothing when it does not", () => {
    expect(ask("Run `npm ci` first.", "npm ci && npm test")).toEqual(scores("The turn shows `npm ci`.", 100, 0));
    expect(ask("Run `npm ci` first.", "npm test")).toEqual(scores("The turn does not show `npm ci`.", 0, 0));
    expect(ask("Keep commits small.", "anything")).toEqual(scores("The rule names nothing to look for.", 100, 0));
  });
});
