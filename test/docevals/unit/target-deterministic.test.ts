/**
 * `target` on a deterministic eval, and the self-judgment warning.
 *
 * ADR 01033 promises that "a grader that cannot serve a requested target says
 * so as an options error rather than quietly grading something else". No
 * deterministic grader reads `target` yet — the judge does, and `tool:regex`
 * will — so until one does, asking `tool:remark` for `target: frontmatter`
 * has to fail loudly rather than lint the whole file and report a verdict
 * about bytes nobody asked about. That is the ADR 01022 rule one level down:
 * a verdict about the wrong bytes is worse than no verdict.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { parseDocevalsConfig } from "../helpers/config.js";

const judgeConfig = parseDocevalsConfig(
  ["version: 1", "judge:", "  ensemble-runs: 1"].join("\n"),
  "/fake/manni.config.yaml",
);

const BODY = "\n# Install\n\nRun the installer.\n";

/** One page whose single eval carries `extra` frontmatter lines verbatim. */
function scaffold(extra: string[], configExtra: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-dettarget-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "last-reviewed: 2020-01-01",
      ...configExtra,
      "evals:",
      "  - id: freshness-check",
      "    assertion: The page was reviewed recently.",
      "    grader: tool:freshness",
      "    options:",
      "      max-age-days: 100000",
      ...extra,
      "---",
      BODY,
    ].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "",
    ].join("\n"),
  );
  return root;
}

const run = (root: string) => runEvals({ cwd: root, generate: false });
const only = async (root: string) => {
  const report = await run(root);
  const r = report.evalResults.find((e) => e.evalName === "freshness-check");
  if (!r) throw new Error("eval did not resolve");
  return r;
};

describe("target on a deterministic grader", () => {
  it("grades normally when no target is named", async () => {
    const r = await only(scaffold([]));
    expect(r.outcome).toBe("pass");
    expect(r.skipReason).toBeUndefined();
  });

  it("grades normally for the default target", async () => {
    // `body` is what every deterministic grader already reads, so naming it
    // explicitly must not become an error.
    const r = await only(scaffold(["    target: body"]));
    expect(r.outcome).toBe("pass");
  });

  it("errors rather than grading the whole page for an unsupported target", async () => {
    const r = await only(scaffold(["    target: frontmatter"]));
    expect(r.outcome).toBe("error");
    expect(r.skipReason).toContain("tool:freshness");
    expect(r.skipReason).toContain("frontmatter");
  });

  it("names a companion-file target by its path", async () => {
    const r = await only(
      scaffold([
        "    target:",
        "      source: file",
        "      path: sample.ts",
      ]),
    );
    expect(r.outcome).toBe("error");
    expect(r.skipReason).toContain("sample.ts");
  });

  it("lets a grader that declares the target through", async () => {
    // `tool:regex` calls readTarget itself, so the guard must not stand
    // between it and the feature it implements. Without the declaration this
    // errors exactly like tool:freshness above.
    const root = mkdtempSync(join(tmpdir(), "manni-docevals-dettarget-ok-"));
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "install.md"),
      [
        "---",
        "title: Install",
        "evals:",
        "  - id: title-present",
        "    assertion: The frontmatter names a title.",
        "    grader: tool:regex",
        "    target: frontmatter",
        "    options:",
        "      pattern: 'title:'",
        "      match: contains",
        "---",
        BODY,
      ].join("\n"),
    );
    writeFileSync(
      join(root, "manni.config.yaml"),
      [
        "docevals:",
        "  version: 1",
        "  files:",
        '    include: ["docs/**/*.md"]',
        "",
      ].join("\n"),
    );
    const report = await run(root);
    const r = report.evalResults.find((e) => e.evalName === "title-present");
    expect(r?.outcome).toBe("pass");
    expect(r?.skipReason).toBeUndefined();
  });

  it("counts as a failure, so a run cannot go green on an ignored target", async () => {
    // The point of erroring rather than skipping: a skip keeps exit 0, and an
    // eval that silently measured the wrong bytes would look like coverage.
    const report = await run(scaffold(["    target: frontmatter"]));
    expect(report.exitCode).toBe(1);
  });
});

describe("the self-judgment warning", () => {
  // Driven through `makeJudge` rather than the engine: the warning compares
  // against the model that actually judged the eval, which only the judge
  // stage knows. An engine test with an injected judge would assert nothing.
  const judgePage = async (generatedBy: string | undefined, judgeModel: string) => {
    const content = [
      "---",
      "title: x",
      ...(generatedBy === undefined ? [] : [`generated-by: ${generatedBy}`]),
      "evals:",
      "  - id: claim-check",
      "    assertion: The page satisfies the claim.",
      "    examples: { pass: yes, fail: no }",
      "---",
      "Visible body.",
    ].join("\n");
    const page: PageFile = {
      file: "docs/page.md",
      absPath: join("/fake", "docs", "page.md"),
      content,
      body: stripFrontmatterBlock(content),
      frontmatter: extractFrontmatter(content, "markdown"),
    };
    const plan = resolvePage(page, judgeConfig);
    const ev = plan.evals[0];
    if (!ev) throw new Error("no eval resolved");
    const provider = new MockProvider([mockVerdict("pass", 0.95)], judgeModel);
    await makeJudge({ provider, root: mkdtempSync(join(tmpdir(), "sj-")) })(
      [{ plan, eval: ev }],
      judgeConfig,
      {},
    );
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when the page's generating model is also the judge model", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await judgePage("mock-model", "mock-model");
    const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).toContain("generated-by");
    expect(said).toContain("docs/page.md");
  });

  it("stays quiet when a different model judges", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await judgePage("some-other-model", "mock-model");
    const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).not.toContain("generated-by");
  });

  it("stays quiet when the page records no author", async () => {
    // Absent provenance is "unknown", not evidence of self-judgment.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await judgePage(undefined, "mock-model");
    const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(said).not.toContain("generated-by");
  });
});
