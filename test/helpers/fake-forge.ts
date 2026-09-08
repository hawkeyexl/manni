/**
 * Point a `GhClient` / `GlabClient` at `fake-forge-bin.mjs`.
 *
 * `fakeForge(responses)` writes a scenario file to a fresh temp directory,
 * names it in `FAKE_FORGE_SCENARIO` (the fake reads its script from there,
 * so one scenario is live per process at a time — vitest runs a file's cases
 * in sequence, which is enough), and returns the `SpawnOptions` that make the
 * client run `node fake-forge-bin.mjs <args>` instead of `gh <args>`. Every
 * spawn is appended to a log the test reads back through `calls()` and
 * `cwds()`, so a case can assert the exact argv, the directory the CLI ran
 * from, and, for the cache, that no spawn happened.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpawnOptions } from "../../src/meta/core/derive/forge.js";

/** The script that impersonates `gh` and `glab`. */
export const FAKE_FORGE_BIN = fileURLToPath(
  new URL("./fake-forge-bin.mjs", import.meta.url),
);

export interface FakeResponse {
  /** Each token must be a substring of some argv element for this response to fire. */
  includes: string[];
  /** A string is written as-is; anything else is JSON-encoded. */
  stdout?: unknown;
  stderr?: string;
  exit?: number;
  /** Delay before answering, for the timeout case. */
  sleepMs?: number;
}

export interface FakeForge {
  spawn: SpawnOptions;
  /** The temp directory; the client's `cwd`, and where the scenario lives. */
  dir: string;
  /** Every argv the fake was run with, in order, `prefixArgs` excluded. */
  calls(): string[][];
  /** The `process.cwd()` of each run, in the same order as `calls()`. */
  cwds(): string[];
  cleanup(): void;
}

/** One line of the fake's log. */
interface LogEntry {
  argv: string[];
  cwd: string;
}

export function fakeForge(
  responses: FakeResponse[],
  opts: { timeoutMs?: number } = {},
): FakeForge {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-fake-forge-")));
  const log = join(dir, "calls.log");
  const scenario = join(dir, "scenario.json");
  writeFileSync(scenario, JSON.stringify({ log, responses }), "utf8");
  process.env.FAKE_FORGE_SCENARIO = scenario;
  const entries = (): LogEntry[] => {
    if (!existsSync(log)) return [];
    return readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as LogEntry);
  };
  return {
    spawn: {
      bin: process.execPath,
      prefixArgs: [FAKE_FORGE_BIN],
      cwd: dir,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    },
    dir,
    calls() {
      return entries().map((e) => e.argv);
    },
    cwds() {
      return entries().map((e) => e.cwd);
    },
    cleanup() {
      if (process.env.FAKE_FORGE_SCENARIO === scenario) {
        delete process.env.FAKE_FORGE_SCENARIO;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
