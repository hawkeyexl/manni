/**
 * The missing-provider warning on `run`, one row per meaningful flag
 * combination (ADR 01043).
 *
 * The condition was `if (!options.deterministicOnly || options.generate === true)`.
 * Commander defaults a `--no-generate` flag's key to `true`, so the second
 * clause held unless `--no-generate` was passed — and the warning was
 * therefore suppressed only by the accidental pairing
 * `--deterministic-only --no-generate`. `--deterministic-only` on its own, the
 * standard no-API-key CI invocation, warned about the AI provider it had just
 * been told to skip.
 *
 * The intent was "generation was explicitly requested", which commander cannot
 * express: there is no `--generate` flag, so `generate` is `true` by default
 * and `false` only when negated. The warning is therefore about the judge, and
 * the judge alone — generation's own missing-provider signal is an `error`
 * result the engine raises where it is actually knowable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRun } from "../../../src/docevals/commands/run.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const ORIGINAL_ENV = { ...process.env };

/**
 * A corpus of one deterministic eval, so a provider is never *needed* — every
 * assertion below is about whether one was asked for.
 */
function scaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-warn-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "last-reviewed: 2026-08-01",
      "eval-suite: s",
      "---",
      "",
      "# Install",
      "",
      "Run the installer.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "  evals:",
      "    fresh-enough:",
      "      assertion: The page was reviewed within the last century.",
      "      grader: tool:freshness",
      "      options:",
      "        max-age-days: 100000",
      "  suites:",
      "    s:",
      "      evals: [fresh-enough]",
      "",
    ].join("\n"),
  );
  return root;
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // No key at all: `makeProvider` raises a DocevalsError, which is the branch
  // every case below travels through.
  delete process.env["ANTHROPIC_API_KEY"];
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  process.env = { ...ORIGINAL_ENV };
});

const warned = (): boolean =>
  warn.mock.calls.some((c: unknown[]) =>
    String(c[0]).includes("provider unavailable"),
  );

/**
 * The options object `src/cli.ts` actually builds.
 *
 * `generate: true` is not a choice made here — commander defaults a `--no-x`
 * flag's key to `true`, verified against the parser itself. Calling `runRun`
 * without it does not reproduce the defect at all, because the broken clause
 * tested `options.generate === true` and a hand-built call leaves it
 * `undefined`. Every case below therefore starts from what the CLI passes.
 */
const run = (flags: Record<string, unknown>) =>
  runRun([], {
    cwd: scaffold(),
    generate: true,
    cache: true,
    ...flags,
  });

describe("run: the missing-provider warning", () => {
  it("warns on a plain run, where the judge was wanted", async () => {
    await run({});
    expect(warned()).toBe(true);
  });

  // The defect. This is the standard CI invocation on a runner with no key.
  it("stays silent under --deterministic-only alone", async () => {
    await run({ deterministicOnly: true });
    expect(warned()).toBe(false);
  });

  // The accidental pairing that used to be the *only* silent combination.
  it("stays silent under --deterministic-only --no-generate", async () => {
    await run({ deterministicOnly: true, generate: false });
    expect(warned()).toBe(false);
  });

  // The guard against fixing the above by deleting the warning: turning
  // generation off does not turn the judge off, so this must still warn.
  it("warns under --no-generate alone", async () => {
    await run({ generate: false });
    expect(warned()).toBe(true);
  });

  // `--ai-only` cannot degrade to anything, so it is exit 2 rather than a
  // warning — unchanged, and pinned here so the table is complete.
  it("raises rather than warns under --ai-only", async () => {
    await expect(run({ aiOnly: true })).rejects.toThrow(DocevalsError);
    expect(warned()).toBe(false);
  });

  it("stays silent when a provider is actually available", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    await run({});
    expect(warned()).toBe(false);
  });
});

describe("run: generation without a provider", () => {
  /** The same corpus, plus a command eval with no command to generate one for. */
  function needsGeneration(): string {
    const root = scaffold();
    writeFileSync(
      join(root, "docs", "install.md"),
      [
        "---",
        "title: Install",
        "last-reviewed: 2026-08-01",
        "evals:",
        "  - id: has-heading",
        "    assertion: The page has an Examples heading.",
        "    grader: command",
        "---",
        "",
        "# Install",
        "",
        "Run the installer.",
        "",
      ].join("\n"),
    );
    return root;
  }

  // What replaces the clause that was removed. Generation's need for a
  // provider is not knowable where the provider is built — it depends on the
  // corpus — so it is reported where it *is* knowable, as an error result that
  // exits 1 rather than a warning that scrolls past.
  it("errors the eval it could not generate for, under --deterministic-only", async () => {
    const report = await runRun([], {
      cwd: needsGeneration(),
      deterministicOnly: true,
      generate: true,
      // Default deny (ADR 01025): without the grant the page-authored command
      // eval is skipped before it can become a generation target, so the grant
      // is what puts this test on the path it is about.
      allowExecution: ["frontmatter-commands"],
    });
    const result = report.evalResults.find((r) => r.evalName === "has-heading");
    expect(result?.outcome).toBe("error");
    expect(result?.skipReason).toMatch(/configure a provider/);
    expect(report.exitCode).toBe(1);
  });
});
