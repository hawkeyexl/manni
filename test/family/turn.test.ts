/**
 * tracevals under `manni check`'s Stop and SubagentStop hooks (proposal
 * 0079): the turn judged against the rules that governed it, merged into
 * 0078's reply, and each skip said once per session.
 *
 * The turns are tracevals' own conformance fixtures, judged by the mock
 * provider, in a temp copy of their project.
 */
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MockProvider,
  type CompleteJSONRequest,
  type DecideRequest,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hookScope } from "../../src/family/cli.js";
import {
  runTurnCheck,
  turnReply,
  type FamilyCheckRun,
} from "../../src/family/commands/check.js";
import { parseEnvelope, type Envelope } from "../../src/family/core/envelope.js";
import { sayOnce, saidPath } from "../../src/family/core/said-once.js";
import type { LocalModels } from "../../src/tracevals/rules/local.js";
import { mockTurnDecisions } from "../../src/tracevals/rules/mock.js";
import { envelope } from "./helpers.js";

const CONFORMANCE = join(import.meta.dirname, "..", "tracevals", "fixtures", "conformance");
const trace = (name: string): string => join(CONFORMANCE, "traces", `${name}.jsonl`);

function env(name: string, extra: Record<string, unknown> = {}): Envelope {
  const parsed = parseEnvelope(envelope(name, undefined, extra));
  if (parsed === undefined) throw new Error(`${name} is not an envelope`);
  return parsed;
}

const failing: FamilyCheckRun = {
  status: "fail",
  files: ["docs/limits.md"],
  checks: [{ command: "meta validate", status: "fail", render: () => "docs/limits.md\n  ✖ /description" }],
};

const FILES = "manni found errors in the files you changed. Fix them, then finish.\n\nmeta validate\ndocs/limits.md\n  ✖ /description";
const FILES_STILL = "manni still reports errors after one repair pass. Run manni check to see them.";
const broken = (rules: number) => ({ broken: { rules, report: "CLAUDE.md\n  ✖ no-force-push", trace: "/t/s1.jsonl" } });

function json(reply: { stdout?: string }): Record<string, unknown> {
  return JSON.parse(reply.stdout ?? "") as Record<string, unknown>;
}

describe("hookScope", () => {
  it("runs the file checks on a Stop, and none on a SubagentStop", () => {
    expect(hookScope(env("stop-transcript"), "/repo")).toEqual({ scope: { kind: "changed" } });
    expect(hookScope(env("subagent-stop"), "/repo")).toBeUndefined();
    expect(hookScope(env("session-end"), "/repo")).toBeUndefined();
  });
});

describe("turnReply", () => {
  it("a broken rule, first stop: one block, its sentence then the report", () => {
    const reply = turnReply(undefined, broken(1), env("stop-transcript"));
    expect(reply.exitCode).toBe(0);
    expect(json(reply)).toEqual({
      decision: "block",
      reason:
        "This turn broke 1 rule from the files that governed it. Fix the work, or say why the rule does not apply here, then finish.\n\nCLAUDE.md\n  ✖ no-force-push",
    });
  });

  it("counts rules in the plural", () => {
    const doc = json(turnReply(undefined, broken(3), env("stop-transcript")));
    expect(doc.reason).toMatch(/^This turn broke 3 rules from the files that governed it\. /);
  });

  it("file errors and a broken rule: one block, 0078's paragraph first", () => {
    const doc = json(turnReply(failing, broken(1), env("stop-transcript")));
    expect(doc.decision).toBe("block");
    expect(doc.reason).toBe(
      `${FILES}\n\nThis turn broke 1 rule from the files that governed it. Fix the work, or say why the rule does not apply here, then finish.\n\nCLAUDE.md\n  ✖ no-force-push`,
    );
  });

  it("after the repair pass: a message naming the trace judged", () => {
    expect(turnReply(undefined, broken(1), env("stop-hook-active"))).toEqual({
      exitCode: 0,
      stdout:
        '{"systemMessage":"tracevals still finds broken rules after one repair pass. Run manni tracevals check /t/s1.jsonl to see them."}\n',
    });
  });

  it("after the repair pass with file errors too: both sentences in one message", () => {
    expect(json(turnReply(failing, broken(1), env("stop-hook-active")))).toEqual({
      systemMessage: `${FILES_STILL} tracevals still finds broken rules after one repair pass. Run manni tracevals check /t/s1.jsonl to see them.`,
    });
  });

  it("a skip is a message, beside a file block when there is one", () => {
    const skipMessage = "tracevals skipped this turn: qwen3.5-4b is still downloading.";
    expect(json(turnReply(undefined, { skipMessage }, env("stop-transcript")))).toEqual({ systemMessage: skipMessage });
    expect(json(turnReply(failing, { skipMessage }, env("stop-transcript")))).toEqual({
      decision: "block",
      reason: FILES,
      systemMessage: skipMessage,
    });
  });

  it("clean, needs-review or not judged: 0078's reply alone", () => {
    expect(turnReply(undefined, undefined, env("stop-transcript"))).toEqual({ exitCode: 0 });
    expect(json(turnReply(failing, undefined, env("stop-hook-active")))).toEqual({ systemMessage: FILES_STILL });
  });
});

describe("runTurnCheck", () => {
  let dir: string;
  let project: string;
  let homeEnv: Record<string, string>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "manni-family-turn-"));
    project = join(dir, "project");
    await cp(join(CONFORMANCE, "project"), project, { recursive: true });
    const home = join(dir, "home");
    homeEnv = { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, USERPROFILE: home };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const stop = (name: string, extra: Record<string, unknown> = {}): Envelope =>
    env("stop-transcript", { transcript_path: trace(name), cwd: project, ...extra });

  it("a broken rule: the count, the report naming the file and the rule, the trace", async () => {
    const verdict = await runTurnCheck(stop("breaks"), project, { env: homeEnv });
    expect(verdict?.broken?.rules).toBeGreaterThan(0);
    expect(verdict?.broken?.report).toContain("CLAUDE.md");
    expect(verdict?.broken?.report).toContain("no-force-push");
    expect(verdict?.broken?.report).not.toContain("\u001b[");
    expect(verdict?.broken?.trace).toBe(trace("breaks"));
  });

  it("a turn that touched nothing, or followed the rules: nothing", async () => {
    expect(await runTurnCheck(stop("untouched"), project, { env: homeEnv })).toBeUndefined();
    expect(await runTurnCheck(stop("empty-turn"), project, { env: homeEnv })).toBeUndefined();
  });

  it("no conformance: nothing", async () => {
    await writeFile(join(project, "manni.config.yaml"), "tracevals:\n  provider: mock\n");
    expect(await runTurnCheck(stop("breaks"), project, { env: homeEnv })).toBeUndefined();
  });

  it("an envelope with no transcript: nothing", async () => {
    expect(await runTurnCheck(env("stop", { cwd: project }), project, { env: homeEnv })).toBeUndefined();
  });

  it("a SubagentStop judges the agent's own transcript", async () => {
    const sub = env("subagent-stop", {
      transcript_path: trace("follows"),
      agent_transcript_path: trace("breaks"),
      cwd: project,
    });
    const verdict = await runTurnCheck(sub, project, { env: homeEnv });
    expect(verdict?.broken?.trace).toBe(trace("breaks"));
  });

  it("an operational failure is silent", async () => {
    expect(await runTurnCheck(stop("missing"), project, { env: homeEnv })).toBeUndefined();
  });

  it("says a skip once per session", async () => {
    const seams = { env: homeEnv, judge: llama(), localModels: downloading() };
    const message = "tracevals skipped this turn: qwen3.5-4b is still downloading.";
    expect(await runTurnCheck(stop("breaks"), project, seams)).toEqual({ skipMessage: message });
    expect(await runTurnCheck(stop("breaks"), project, seams)).toBeUndefined();
    expect(await runTurnCheck(stop("breaks", { session_id: "s2" }), project, seams)).toEqual({ skipMessage: message });
  });
});

describe("sayOnce", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "manni-said-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("records what was said under the project's session directory", () => {
    expect(sayOnce(dir, "s1", "downloading")).toBe(true);
    expect(sayOnce(dir, "s1", "downloading")).toBe(false);
    expect(sayOnce(dir, "s1", "memory")).toBe(true);
    expect(dirname(saidPath(dir, "s1", "memory"))).toBe(join(dir, ".manni", "tracevals", "sessions"));
  });

  it("lets exactly one of many concurrent callers say it", async () => {
    const said = await Promise.all(
      Array.from({ length: 8 }, () => Promise.resolve().then(() => sayOnce(dir, "s1", "busy"))),
    );
    expect(said.filter(Boolean)).toHaveLength(1);
  });

  it("keeps a session id from leaving the directory, and two ids from sharing a marker", () => {
    expect(dirname(saidPath(dir, "../x", "busy"))).toBe(join(dir, ".manni", "tracevals", "sessions"));
    expect(saidPath(dir, "abc/def", "busy")).not.toBe(saidPath(dir, "abc!def", "busy"));
    expect(sayOnce(dir, "abc/def", "busy")).toBe(true);
    expect(sayOnce(dir, "abc!def", "busy")).toBe(true);
  });
});

/** A local decider, without a runtime: mock decisions under llama-cpp's name. */
function llama(): InferenceProvider {
  const inner = new MockProvider([{ json: {} }], "qwen3.5-4b", { decisions: mockTurnDecisions });
  const provider: InferenceProvider & Pick<MockProvider, "decide" | "stateLimit"> = {
    provider: () => "llama-cpp",
    modelName: () => "qwen3.5-4b",
    completeJSON: (req: CompleteJSONRequest) => inner.completeJSON(req),
    decide: (req: DecideRequest) => inner.decide(req),
    stateLimit: () => inner.stateLimit(),
  };
  return provider;
}

function downloading(): LocalModels {
  return {
    runtimePresent: () => Promise.resolve(true),
    state: () => Promise.resolve("downloading"),
    fits: () => Promise.resolve({ fits: true, needBytes: 1, freeBytes: 2 }),
    ensure: () => Promise.reject(new Error("a hook downloads nothing")),
  };
}
