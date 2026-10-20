/**
 * Integration: full deterministic pipeline over the fixture corpus, with the
 * real command grader running the pre-generated fixture script via node.
 *
 * The run starts in the corpus directory, so it discovers the showcase config
 * beside the pages and reads its `collections:` as the fallback paths.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { render } from "../../../src/docevals/reporters/index.js";

const PAGES = resolve(import.meta.dirname, "../fixtures/pages");

describe("deterministic run over fixtures", () => {
  it("produces the expected outcomes", async () => {
    const report = await runEvals({
      cwd: PAGES,
      deterministicOnly: true,
      generate: false,
    });

    expect(report.pages).toBe(13);
    const byKey = new Map(
      report.evalResults.map((r) => [`${r.file} ${r.evalName}`, r] as const),
    );

    // Pre-generated script runs and passes.
    expect(byKey.get("docs/actions/find.mdx has-examples-heading")?.outcome).toBe("pass");

    // A TBD marker fails no-todo-markers at the page's error severity, on the
    // file line that carries it.
    const goTo = byKey.get("docs/actions/goTo.mdx no-todo-markers");
    expect(goTo?.outcome).toBe("fail");
    expect(goTo?.findings?.[0]?.ruleId).toBe("regex/found");
    expect(goTo?.findings?.[0]?.severity).toBe("error");
    expect(goTo?.findings?.[0]?.line).toBe(14);

    // At warning severity the TODO marker passes but carries the finding.
    const concepts = byKey.get("docs/get-started/concepts.md no-todo-markers");
    expect(concepts?.outcome).toBe("pass");
    expect(concepts?.findings?.[0]?.severity).toBe("warning");
    expect(concepts?.findings?.[0]?.line).toBe(21);

    // The result also names the entry that declares the eval.
    expect(goTo?.location).toEqual({ file: "docs/actions/goTo.mdx", line: 7 });

    // Missing command with generation disabled errors, at its declaring entry.
    const install = byKey.get("docs/get-started/installation.mdx install-command-present");
    expect(install?.outcome).toBe("error");
    expect(install?.location).toEqual({
      file: "docs/get-started/installation.mdx",
      line: 17,
    });

    // AI evals are skipped under --deterministic-only.
    expect(byKey.get("docs/get-started/concepts.md defines-core-terms")?.outcome).toBe(
      "skipped",
    );

    // Per-page eval skip.
    expect(byKey.get("docs/tests/inline.mdx no-todo-markers")?.outcome).toBe("skipped");

    // Suite summaries exist for configured suites; failures produce exit 1.
    expect(report.suites.map((s) => s.suite)).toContain("reference");
    expect(report.exitCode).toBe(1);
  }, 30000);

  it("stamps every result with what its eval asks for, and prints it", async () => {
    const report = await runEvals({
      cwd: PAGES,
      deterministicOnly: true,
      generate: false,
    });
    for (const r of report.evalResults) {
      expect(r.guidance).toMatchObject({
        id: r.location?.file,
        rule: r.evalName,
        guide: "https://hawkeyexl.github.io/manni/docevals/fix/",
      });
    }
    const goTo = report.evalResults.find(
      (r) => r.file === "docs/actions/goTo.mdx" && r.evalName === "no-todo-markers",
    );
    expect(goTo?.guidance).toEqual({
      id: "docs/actions/goTo.mdx",
      rule: "no-todo-markers",
      description: "The page carries no TODO, TBD or FIXME markers.",
      guide: "https://hawkeyexl.github.io/manni/docevals/fix/",
    });

    const pretty = render(report, "pretty");
    expect(pretty).toContain(
      "found in body, expected absent. Remove or reword the matching text.\n" +
        "       docs/actions/goTo.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers.\n" +
        "       Guide: https://hawkeyexl.github.io/manni/docevals/fix/",
    );
    const github = render(report, "github");
    expect(github).toMatch(
      /::error file=docs\/actions\/goTo\.mdx,line=14,[^\n]*expected absent\. Remove or reword the matching text\.%0Adocs\/actions\/goTo\.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers\.%0AGuide: https:\/\/hawkeyexl\.github\.io\/manni\/docevals\/fix\//,
    );
  }, 30000);

  it("skips frontmatter commands when disabled", async () => {
    const report = await runEvals({
      cwd: PAGES,
      deterministicOnly: true,
      generate: false,
      execution: false,
    });
    const finding = report.evalResults.find(
      (r) => r.file === "docs/actions/find.mdx" && r.evalName === "has-examples-heading",
    );
    expect(finding?.outcome).toBe("skipped");
    expect(finding?.skipReason).toMatch(/frontmatter commands not granted/);
  });
});
