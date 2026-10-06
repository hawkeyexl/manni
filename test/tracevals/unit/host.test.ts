/**
 * The model host seam (proposal 0079, "Concurrency and the model host"). The
 * library's three calls are injected, so no test starts or reaches a real host.
 */
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelHostBusyError, type InferenceProvider } from "@hawkeyexl/inference";
import { checkTurn } from "../../../src/tracevals/commands/check.js";
import { runPrepare } from "../../../src/tracevals/commands/prepare.js";
import { runRelease } from "../../../src/tracevals/commands/release.js";
import { parseConfig } from "../../../src/tracevals/core/config.js";
import { providerSpecFor } from "../../../src/tracevals/judge/provider.js";
import {
  hostSetting,
  hostStatus,
  queued,
  QUEUE_WAIT_MS,
  releaseHost,
  warmModel,
  type HostApi,
} from "../../../src/tracevals/rules/host.js";
import type { LocalModels } from "../../../src/tracevals/rules/local.js";
import { resetWarnings } from "../../../src/shared/warn.js";

function fakeHost(overrides: Partial<HostApi> = {}) {
  const lease = vi.fn<HostApi["lease"]>(() => Promise.resolve({ pid: 4242 }));
  const release = vi.fn<HostApi["release"]>(() =>
    Promise.resolve({ released: [], unloaded: [], hostStopped: false }),
  );
  const api: HostApi = {
    lease,
    status: () => Promise.resolve(null),
    release,
    ...overrides,
  };
  return { api, lease, release };
}

describe("host setting", () => {
  it("spawns under a session in the loop, and only connects by hand", () => {
    expect(hostSetting(true, "s1", 30_000)).toEqual({
      host: "spawn",
      session: "s1",
      keepAlive: 30_000,
      hostWaitMs: QUEUE_WAIT_MS,
    });
    expect(hostSetting(true, "s1", undefined)).toMatchObject({ keepAlive: 10 * 60_000 });
    expect(hostSetting(false, "s1", 30_000)).toEqual({ host: "connect" });
    expect(hostSetting(true, undefined, 30_000)).toEqual({ host: "connect" });
  });

  it("reaches a llama-cpp spec, defaulting to connect", () => {
    const config = parseConfig({});
    const selection = { provider: "llama-cpp" as const, model: "qwen3.5-4b" };
    expect(providerSpecFor(config, selection).llamaCpp).toMatchObject({ host: "connect" });
    expect(
      providerSpecFor(config, selection, { host: hostSetting(true, "s1", 5) }).llamaCpp,
    ).toMatchObject({ host: "spawn", session: "s1", keepAlive: 5, hostWaitMs: QUEUE_WAIT_MS });
    expect(providerSpecFor(config, { provider: "anthropic", model: null }).llamaCpp).toBeUndefined();
  });
});

describe("the host's calls", () => {
  it("leases with spawn, and answers whether the model is loaded", async () => {
    const { api, lease } = fakeHost();
    expect(await warmModel({ sessionId: "s1", model: "qwen3.5-4b", keepAliveMs: 600_000 }, api)).toBe(true);
    expect(lease).toHaveBeenCalledWith({
      model: "qwen3.5-4b",
      session: "s1",
      keepAlive: 600_000,
      spawn: true,
      hostWaitMs: QUEUE_WAIT_MS,
    });
    const none = fakeHost({ lease: () => Promise.resolve(null) }).api;
    expect(await warmModel({ sessionId: "s1", model: "m", keepAliveMs: 1 }, none)).toBe(false);
    const broken = fakeHost({ lease: () => Promise.reject(new Error("no socket")) }).api;
    expect(await warmModel({ sessionId: "s1", model: "m", keepAliveMs: 1 }, broken)).toBe(false);
  });

  it("releases one session or all", async () => {
    const { api, release } = fakeHost();
    await releaseHost({ sessionId: "s1" }, api);
    await releaseHost({ all: true }, api);
    expect(release.mock.calls).toEqual([[{ session: "s1" }], [{ all: true }]]);
  });

  it("reports a running host as data, and null when none runs", async () => {
    expect(await hostStatus(fakeHost().api)).toBeNull();
    const running = fakeHost({
      status: () =>
        Promise.resolve({
          pid: 7,
          models: [{ model: "qwen3.5-4b", sessions: 2, idleMs: 180_000, queued: 0 }],
        }),
    }).api;
    expect(await hostStatus(running)).toEqual({
      pid: 7,
      models: [{ model: "qwen3.5-4b", sessions: 2, idleMs: 180_000, queued: 0 }],
    });
  });

  it("turns a busy host into busy, and lets other errors through", async () => {
    expect(await queued("m", () => Promise.resolve(1))).toEqual({ busy: false, value: 1 });
    expect(await queued("m", () => Promise.reject(new ModelHostBusyError("waited")))).toEqual({ busy: true });
    await expect(queued("m", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

describe("release", () => {
  it("says what a running host gave up", async () => {
    const { api } = fakeHost({
      release: () =>
        Promise.resolve({ released: ["a", "b"], unloaded: ["qwen3.5-4b"], hostStopped: true }),
    });
    const result = await runRelease({ stdin: "", all: true, hostApi: api });
    expect(result.stdout).toBe("Unloaded qwen3.5-4b and stopped the model host. 2 sessions held it.");
  });

  it("releases the SessionEnd envelope's session", async () => {
    const { api, release } = fakeHost();
    await runRelease({
      stdin: JSON.stringify({ session_id: "s9", hook_event_name: "SessionEnd" }),
      hostApi: api,
    });
    expect(release).toHaveBeenCalledWith({ session: "s9" });
  });
});

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "conformance");
let dir: string;
let project: string;
let env: Record<string, string>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "host-"));
  project = join(dir, "project");
  await cp(join(FIXTURE, "project"), project, { recursive: true });
  const home = join(dir, "home");
  env = { CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home, USERPROFILE: home };
  await writeFile(
    join(project, "manni.config.yaml"),
    "tracevals:\n  provider: mock\n  conformance:\n    hook: { provider: llama-cpp, model: qwen3.5-4b }\n",
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env["MANNI_TRACEVALS_JUDGE"];
  resetWarnings();
});

const local: LocalModels = {
  runtimePresent: () => Promise.resolve(true),
  state: () => Promise.resolve("ready"),
  fits: () => Promise.resolve({ fits: true, needBytes: 1, freeBytes: 2 }),
  ensure: () => Promise.resolve({ state: "ready", bytes: 3 }),
};

describe("prepare and check around the host", () => {
  it("leases the hook model under SessionStart, so the first Stop finds it warm", async () => {
    const { api, lease } = fakeHost();
    const stdin = JSON.stringify({ session_id: "s1", cwd: project, hook_event_name: "SessionStart" });
    const result = await runPrepare({ stdin, env, localModels: local, hostApi: api });
    expect(lease).toHaveBeenCalledTimes(1);
    expect(lease.mock.calls[0]?.[0]).toMatchObject({ model: "qwen3.5-4b", session: "s1", spawn: true });
    expect(result.report.models[0]).toMatchObject({ role: "hook", state: "loaded" });
  });

  it("takes no lease by hand", async () => {
    const { api, lease } = fakeHost();
    const result = await runPrepare({ stdin: "", project, env, localModels: local, hostApi: api });
    expect(lease).not.toHaveBeenCalled();
    expect(result.report.models[0]).toMatchObject({ state: "ready" });
  });

  it("skips the turn, with the message, when the host stayed busy", async () => {
    const busy = {
      provider: () => "llama-cpp",
      modelName: () => "qwen3.5-4b",
      completeJSON: () => Promise.reject(new ModelHostBusyError("waited")),
      decide: () => Promise.reject(new ModelHostBusyError("waited")),
      stateLimit: () => Promise.resolve(8192),
    } as unknown as InferenceProvider;
    const result = await checkTurn({
      transcriptPath: join(FIXTURE, "traces", "breaks.jsonl"),
      sessionId: "3b265d00-0000-4000-8000-000000000001",
      cwd: project,
      inLoop: true,
      env,
      judge: busy,
      localModels: local,
    });
    expect(result.skipped).toEqual({
      gate: "busy",
      message: "tracevals skipped this turn: qwen3.5-4b was busy with other judgements for 2 minutes.",
    });
  });
});
