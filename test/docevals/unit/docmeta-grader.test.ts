/**
 * `tool:docmeta` must be told which schemas to validate against.
 *
 * The adapter passes `options.schemas` straight through as `cliSchemas`. When
 * that is undefined, docmeta falls back to its own `DEFAULT_SCHEMAS` — a set
 * that has widened twice across major versions (2.0.0 added Diátaxis and
 * Seven-Action, 3.0.0 added The Good Docs Project). Inheriting it means an
 * eval's meaning changes on a dependency bump, with no edit to any config in
 * this repo.
 *
 * Measured on the upgrade to 4.12.0: with no `schemas` option, all 13 fixture
 * pages fail `google:okf:0.1` for a missing `type` — a vocabulary nobody here
 * opted into. Which schemas a corpus is held to is not something manni docevals
 * can guess, so it asks.
 */
import { describe, it, expect } from "vitest";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { docmetaGrader } from "../../../src/docevals/graders/tools/docmeta.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock } from "../../../src/docevals/core/discover.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolve } from "node:path";
import type { PageFile } from "../../../src/docevals/core/discover.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

const CONFIG = parseDocevalsConfig(
  [
    "version: 1",
    "evals:",
    "  fm-bare:",
    "    assertion: Frontmatter validates.",
    "    grader: tool:docmeta",
    "  fm-aimed:",
    "    assertion: Frontmatter validates.",
    "    grader: tool:docmeta",
    "    options:",
    '      schemas: ["schemas/frontmatter-1.0.0.json"]',
    "suites:",
    "  bare: { evals: [fm-bare] }",
    "  aimed: { evals: [fm-aimed] }",
  ].join("\n"),
  "/fake/manni.config.yaml",
);

function target(suite: string): GraderTarget {
  const content = `---\ntitle: x\neval-suite: ${suite}\n---\nBody.`;
  const page: PageFile = {
    file: "docs/page.md",
    absPath: "/fake/docs/page.md",
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const plan = resolvePage(page, CONFIG);
  return { plan, eval: plan.evals[0]! };
}

describe("tool:docmeta without options.schemas", () => {
  it("reports a finding naming the missing option", async () => {
    const findings = await docmetaGrader.grade({
      targets: [target("bare")],
      config: CONFIG,
      root: process.cwd(),
      exec: () => {
        throw new Error("tool:docmeta runs in-process; exec must not be called");
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toMatch(/options\.schemas/);
    expect(findings[0]?.severity).toBe("error");
  });

  it("does not silently inherit docmeta's default schema set", async () => {
    // The failure mode this guards: 13/13 fixture pages failing
    // `google:okf:0.1` for a missing `type`, reported as if the pages were
    // wrong rather than the eval underspecified.
    const findings = await docmetaGrader.grade({
      targets: [target("bare")],
      config: CONFIG,
      root: process.cwd(),
      exec: () => {
        throw new Error("unreachable");
      },
    });
    for (const f of findings) expect(f.message).not.toMatch(/okf|seven-action/);
  });
});

/**
 * A grader that throws must not take the whole run with it.
 *
 * `runValidate` raises `DocmetaError` on a schema path it cannot read — and
 * since `options.schemas` is now required and hand-written, a typo there is
 * the likeliest way to reach it. Without a boundary that rejection propagates
 * out of `runEvals`: every remaining eval on every remaining page is dropped
 * with no result, no diagnostic, and no exit code saying anything was skipped.
 *
 * The engine already handles a failed *generation* this way — `outcome:
 * "error"` per target — so grading matches rather than inventing a third
 * behavior.
 */
describe("a grader that throws mid-run", () => {
  const CONFIG_TEXT = [
    "version: 1",
    'files: { include: ["test/docevals/fixtures/pages/docs/actions/find.mdx"] }',
    "evals:",
    "  bad-schema-path:",
    "    assertion: Frontmatter validates.",
    "    grader: tool:docmeta",
    "    options:",
    '      schemas: ["no/such/schema.json"]',
    "  fresh-enough:",
    "    assertion: Reviewed recently.",
    "    grader: tool:freshness",
    "    options: { field: last-reviewed, max-age-days: 100000 }",
    "suites:",
    "  reference: { evals: [bad-schema-path, fresh-enough] }",
  ].join("\n");

  it("does not reject the run", async () => {
    const { runEvals } = await import("../../../src/docevals/core/engine.js");
    const config = parseDocevalsConfig(
      CONFIG_TEXT,
      resolve(process.cwd(), "manni.config.yaml"),
    );
    const report = await runEvals({
      cwd: process.cwd(),
      config,
      deterministicOnly: true,
      generate: false,
    });
    expect(report.evalResults.length).toBeGreaterThan(0);
  }, 60000);

  it("errors only the failing grader's targets, and names why", async () => {
    const { runEvals } = await import("../../../src/docevals/core/engine.js");
    const config = parseDocevalsConfig(
      CONFIG_TEXT,
      resolve(process.cwd(), "manni.config.yaml"),
    );
    const report = await runEvals({
      cwd: process.cwd(),
      config,
      deterministicOnly: true,
      generate: false,
    });
    const broken = report.evalResults.find(
      (r) => r.evalName === "bad-schema-path",
    );
    expect(broken?.outcome).toBe("error");
    expect(broken?.skipReason).toMatch(/no\/such\/schema\.json|tool:docmeta/);

    // The unrelated eval on the same page still ran.
    const other = report.evalResults.find((r) => r.evalName === "fresh-enough");
    expect(other?.outcome).toBe("pass");
  }, 60000);

  it("surfaces as exit 1, not a green run", async () => {
    const { runEvals } = await import("../../../src/docevals/core/engine.js");
    const config = parseDocevalsConfig(
      CONFIG_TEXT,
      resolve(process.cwd(), "manni.config.yaml"),
    );
    const report = await runEvals({
      cwd: process.cwd(),
      config,
      deterministicOnly: true,
      generate: false,
    });
    expect(report.exitCode).toBe(1);
  }, 60000);
});
