/**
 * "A grader that reached no verdict fails the eval, at any severity"
 * (ADR 01022), tested where the rule lives.
 *
 * The decision moved this property out of the adapters and into one line of
 * `core/engine.ts`:
 *
 * ```ts
 * const hasError = own.some((f) => f.severity === "error" || f.diagnostic === true);
 * ```
 *
 * Nothing tested that line. The adapter tests assert that a diagnostic finding
 * carries the flag, which is only half of it — the half that fails the eval is
 * the engine's, and an adapter test cannot see it. So drive a real
 * `severity: warning` eval through `runEvals` with a fake exec and assert the
 * outcome, both ways round: the diagnostic fails it, and an ordinary warning
 * finding on the same eval still passes. The second case is what proves the
 * failure came from the flag rather than from severity handling.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import type { ExecFn, ExecResult } from "../../../src/docevals/graders/types.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "tool-output");

/** Deliberately at `severity: warning` — the setting the rule is about. */
const PAGE = `---
title: Guide
evals:
  - id: well-structured
    assertion: The page follows the how-to template.
    grader: tool:doc-structure-lint
    options: { template: "how-to" }
    severity: warning
---

# Guide

Body.
`;

const CONFIG = `docevals:
  version: 1
  files:
    include: ["docs/**/*.md"]
`;

function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-diagnostic-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "guide.md"), PAGE);
  writeFileSync(join(root, "manni.config.yaml"), CONFIG);
  return root;
}

/** No binary is ever spawned; the adapter only sees what this returns. */
const fakeExec =
  (result: Partial<ExecResult>): ExecFn =>
  () =>
    Promise.resolve({ code: 0, stdout: "", stderr: "", timedOut: false, ...result });

const run = (root: string, exec: ExecFn) => runEvals({ cwd: root, generate: false, exec });

describe("a diagnostic finding fails its eval at warning severity", () => {
  it("fails when the tool's output could not be read", async () => {
    const report = await run(scaffold(), fakeExec({ code: 0, stdout: "Structure OK!" }));

    const result = report.evalResults[0];
    expect(result?.evalName).toBe("well-structured");
    expect(result?.outcome).toBe("fail");
    // Severity is untouched — it is what the reader sees, and it still
    // describes how much a page problem would matter. The flag failed the eval.
    expect(result?.findings?.[0]?.severity).toBe("warning");
    expect(result?.findings?.[0]?.diagnostic).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("still passes on an ordinary warning-severity finding", async () => {
    const captured = readFileSync(join(FIXTURES, "doc-structure-lint-fail.json"), "utf8");
    const report = await run(scaffold(), fakeExec({ code: 1, stdout: captured }));

    const result = report.evalResults[0];
    expect(result?.findings?.[0]?.severity).toBe("warning");
    expect(result?.findings?.[0]?.diagnostic).toBeUndefined();
    // Reported, not fatal: warnings and info report but pass. Whatever the
    // flag does, it must not have cost severity its meaning.
    expect(result?.outcome).toBe("pass");
    expect(report.exitCode).toBe(0);
  });
});
