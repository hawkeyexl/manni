/**
 * Every eval points at the entry that declares it.
 *
 * A page declares an eval with one item of its `evals` key, in its frontmatter
 * or in the manifest a collection declares for it (proposal 0037). A suite
 * eval the page never names is attached by its `eval-suite` key instead. The
 * resolved eval carries that file and line, and the engine stamps it on the
 * result, so a CI annotation lands on the line someone edits.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { parseDocevalsConfig } from "../helpers/config.js";
import { loadConfig } from "../../../src/docevals/core/config.js";
import { discoverPages, stripFrontmatterBlock } from "../../../src/docevals/core/discover.js";
import type { PageFile } from "../../../src/docevals/core/discover.js";
import { withExternalMetadata } from "../../../src/docevals/core/external.js";
import { resolvePage, resolvePages } from "../../../src/docevals/core/resolve.js";
import type { ResolvedPagePlan } from "../../../src/docevals/core/resolve.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { runEvals } from "../../../src/docevals/core/engine.js";

const CONFIG = parseDocevalsConfig(
  [
    "evals:",
    "  central-tool:",
    "    grader: tool:regex",
    "    options: { pattern: TODO }",
    "suites:",
    "  ref:",
    "    target-pass-rate: 1",
    "    evals: [central-tool]",
  ].join("\n"),
  "/fake/manni.config.yaml",
);

function page(frontmatterYaml: string): PageFile {
  const content = `---\n${frontmatterYaml}\n---\nBody.`;
  return {
    file: "docs/page.md",
    absPath: "/fake/docs/page.md",
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
}

const locations = (plan: ResolvedPagePlan) =>
  plan.evals.map((e) => [e.name, e.location]);

describe("an eval's declaring location", () => {
  it("is the page entry for an inline eval, a reference, and the shorthand", () => {
    const plan = resolvePage(
      page(
        [
          "title: T",
          "evals:",
          "  - id: inline",
          "    grader: tool:regex",
          "    options: { pattern: x }",
          "  - use: central-tool",
          "  - The page says what it does.",
        ].join("\n"),
      ),
      CONFIG,
    );
    expect(locations(plan)).toEqual([
      ["inline", { file: "docs/page.md", line: 4 }],
      ["central-tool", { file: "docs/page.md", line: 7 }],
      ["assertion-3", { file: "docs/page.md", line: 8 }],
    ]);
  });

  it("is the page's eval-suite line for a suite eval the page never names", () => {
    const plan = resolvePage(page(["title: T", "eval-suite: ref"].join("\n")), CONFIG);
    expect(locations(plan)).toEqual([
      ["central-tool", { file: "docs/page.md", line: 3 }],
    ]);
  });

  it("is the page alone when the suite comes from the config's default", () => {
    const config = { ...CONFIG, defaults: { ...CONFIG.defaults, suite: "ref" } };
    const plan = resolvePage(page("title: T"), config);
    expect(locations(plan)).toEqual([["central-tool", { file: "docs/page.md" }]]);
  });
});

describe("an eval a manifest declares", () => {
  const FIXTURES = resolve(import.meta.dirname, "../fixtures/manifest");

  async function plansOf(fixture: string): Promise<ResolvedPagePlan[]> {
    const cwd = resolve(FIXTURES, fixture);
    const config = loadConfig(undefined, cwd);
    const pages = await withExternalMetadata(
      discoverPages(config, { paths: [] }, cwd),
      config,
      cwd,
    );
    return resolvePages(pages, config);
  }

  const planFor = (plans: ResolvedPagePlan[], file: string): ResolvedPagePlan => {
    const plan = plans.find((p) => p.page.file === file);
    if (!plan) throw new Error(`no plan for ${file}`);
    return plan;
  };

  it("is the shared manifest's entry line", async () => {
    const plans = await plansOf("external");
    expect(locations(planFor(plans, "docs/install.md"))).toEqual([
      ["no-todo-markers", { file: "site.metadata.yaml", line: 4 }],
    ]);
    // `dated.md` names the suite in the manifest and no eval of its own.
    expect(locations(planFor(plans, "docs/dated.md"))).toEqual([
      ["no-todo-markers", { file: "site.metadata.yaml", line: 6 }],
    ]);
  });

  it("is the page's own manifest under a {page} pattern", async () => {
    const plans = await plansOf("per-page");
    expect(locations(planFor(plans, "docs/install.md"))).toEqual([
      ["no-todo-markers", { file: "docs/install.evals.yaml", line: 4 }],
    ]);
  });

  it("is the manifest entry joined on a field", async () => {
    const plans = await plansOf("join");
    expect(locations(planFor(plans, "docs/install.md"))).toEqual([
      ["no-todo-markers", { file: "site.metadata.yaml", line: 4 }],
    ]);
  });
});

describe("an eval result's location", () => {
  it("is stamped by the engine from the resolved eval", async () => {
    const report = await runEvals({
      cwd: resolve(import.meta.dirname, "../fixtures/manifest/external"),
      generate: false,
      deterministicOnly: true,
    });
    const install = report.evalResults.find((r) => r.file === "docs/install.md");
    expect(install?.location).toEqual({ file: "site.metadata.yaml", line: 4 });
  });
});
