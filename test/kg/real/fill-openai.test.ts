/**
 * `manni kg fill` against a real OpenAI-compatible server (ADR 01031).
 *
 * **Not part of `npm test`.** It needs a server on `OLLAMA_BASE_URL`; the
 * `fill-live` CI job starts one. The default suite stays hermetic.
 *
 * Why this one and not the Anthropic path: `OpenAICompatProvider` asks for
 * structured output with `response_format: {type: "json_schema", strict: true}`,
 * and Ollama maps that onto its native `format` field, which llama-server
 * compiles to a GBNF grammar. The constraint is genuinely applied, so a passing
 * run means something. Ollama's Anthropic-compatible endpoint accepts
 * `tool_choice` and never reads it — the forcing mechanism the Anthropic
 * provider depends on — so the same test there would be green and hollow.
 *
 * Every assertion is about shape and mechanism, never about the *content* of
 * what a 1B model says. A small model under grammar constraint emits
 * schema-valid JSON whose values may be nonsense; asserting on the values would
 * make this flaky for a reason that has nothing to do with dockg.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runFill } from "../../../src/kg/commands/fill.js";

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
const MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:1b";

function corpus(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-fill-live-"));
  writeFileSync(
    join(dir, "dockg.config.yaml"),
    [
      "version: 1",
      'inputs: ["*.md"]',
      "fill:",
      "  provider: openai",
      `  model: ${MODEL}`,
      `  baseUrl: ${BASE_URL}`,
      "  apiKeyEnv: OLLAMA_API_KEY",
      // Confidence is a self-report, and a 1B model's is not to be trusted.
      // Zero keeps the gate from being what this test measures.
      "  minConfidence: 0",
      "  maxCostUsd: null",
      "  fields: [label, concepts]",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "a.md"), body);
  return dir;
}

beforeAll(async () => {
  // Fail with the reason rather than a timeout thirty seconds later.
  const res = await fetch(`${BASE_URL}/models`).catch((e: unknown) => {
    throw new Error(
      `No OpenAI-compatible server at ${BASE_URL} — start one (see the fill-live CI job)`,
      { cause: e },
    );
  });
  expect(res.ok, `${BASE_URL}/models returned ${res.status}`).toBe(true);
}, 60_000);

describe("manni kg fill against a real OpenAI-compatible server", () => {
  it("completes a real structured-output call and writes frontmatter", async () => {
    const dir = corpus(
      "---\ntitle: Query syntax\n---\n\n# Query syntax\n\nHow to write search queries with operators and filters.\n",
    );

    const report = await runFill({ cwd: dir, noCache: true });

    expect(report.exitCode, JSON.stringify(report.results)).toBe(0);
    expect(report.results).toHaveLength(1);
    const result = report.results[0]!;
    expect(
      ["filled", "nothing-proposed"],
      `unexpected status: ${result.status} ${result.error ?? ""}`,
    ).toContain(result.status);

    // The mechanism, not the content: whatever the model said had to survive
    // the schema validator to get here, and anything it wrote is under `kg`.
    if (result.status === "filled") {
      const written = readFileSync(join(dir, "a.md"), "utf8");
      expect(written).toContain("kg:");
      for (const field of result.fields) {
        expect(["label", "concepts"]).toContain(field);
      }
    }
  }, 300_000);

  it("reports the budget as unpriceable for a model with no price", async () => {
    // The local model has no PRICE_TABLE entry, which is the case ADR 01027
    // exists for — verified here against a real provider rather than a mock.
    const dir = corpus("---\ntitle: T\n---\n\n# T\n\nShort body.\n");
    const report = await runFill({
      cwd: dir,
      noCache: true,
      dryRun: true,
      maxCost: 5,
    });
    expect(report.budget).toBe("unpriceable");
    expect(report.warnings[0]).toContain("cannot be enforced");
  }, 300_000);

  it("caches, so a second identical run makes no HTTP call", async () => {
    const dir = corpus("---\ntitle: Caching\n---\n\n# Caching\n\nBody text.\n");
    const first = await runFill({ cwd: dir, dryRun: true });
    const second = await runFill({ cwd: dir, dryRun: true });
    expect(first.results[0]!.cached).toBe(false);
    expect(second.results[0]!.cached).toBe(true);
  }, 300_000);
});
