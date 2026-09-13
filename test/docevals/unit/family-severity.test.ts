/**
 * docevals speaks the family's severity scale, `notice | warning | error`,
 * from `src/shared/severity.ts`. A flag or key two domains both have carries
 * the same name and the same values, so `info` (the scale docevals was
 * imported with) is an unknown value everywhere a user can write one: an eval
 * in the config, a `severity-map`, and an eval on a page.
 */
import { stripVTControlCharacters } from "node:util";
import { describe, it, expect } from "vitest";
import { SEVERITIES } from "../../../src/shared/severity.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { isValidProposal } from "../../../src/docevals/fill/prompt.js";
import { valeGrader } from "../../../src/docevals/graders/tools/vale.js";
import type { ExecFn } from "../../../src/docevals/graders/types.js";
import { render } from "../../../src/docevals/reporters/index.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";
import { DocevalsError } from "../../../src/docevals/types.js";

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

const EMPTY = parseDocevalsConfig("");

describe("severity in the config", () => {
  it("accepts notice on an eval and in a severity-map", () => {
    const config = parseDocevalsConfig(
      [
        "evals:",
        "  style:",
        "    grader: tool:vale",
        "    severity: notice",
        "    severity-map: { suggestion: notice }",
      ].join("\n"),
    );
    expect(config.evals.style?.severity).toBe("notice");
    expect(config.evals.style?.severityMap).toEqual({ suggestion: "notice" });
  });

  it("rejects info on an eval as an ordinary schema error", () => {
    expect(() =>
      parseDocevalsConfig(
        ["evals:", "  style:", "    grader: tool:vale", "    severity: info"].join(
          "\n",
        ),
      ),
    ).toThrow(
      new DocevalsError(
        "Invalid config in /fake/manni.config.yaml:\n" +
          "  /docevals/evals/style/severity: must be equal to one of the allowed values",
      ),
    );
  });

  it("rejects info in a severity-map", () => {
    expect(() =>
      parseDocevalsConfig(
        [
          "evals:",
          "  style:",
          "    grader: tool:vale",
          "    severity-map: { suggestion: info }",
        ].join("\n"),
      ),
    ).toThrow(/\/docevals\/evals\/style\/severity-map\/suggestion: must be equal to one of the allowed values/);
  });
});

describe("severity on a page", () => {
  it("accepts notice on an inline eval", () => {
    const plan = resolvePage(
      page("evals:\n  - id: quiet\n    grader: tool:freshness\n    severity: notice"),
      EMPTY,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.evals[0]?.severity).toBe("notice");
  });

  it("reports info as a schema error on the page", () => {
    const plan = resolvePage(
      page("evals:\n  - id: quiet\n    grader: tool:freshness\n    severity: info"),
      EMPTY,
    );
    expect(plan.evals).toEqual([]);
    expect(plan.problems.map((p) => p.level)).toContain("error");
    expect(plan.problems.map((p) => p.message)).toContain(
      "frontmatter/evals/0/severity: must be equal to one of the allowed values",
    );
  });
});

describe("severity fill proposes", () => {
  it("is the family scale", () => {
    const proposal = (severity: string) => ({
      evals: [
        { id: "x", assertion: "A.", confidence: 0.9, examples: { pass: "p", fail: "f" }, severity },
      ],
    });
    for (const severity of SEVERITIES) expect(isValidProposal(proposal(severity))).toBe(true);
    expect(isValidProposal(proposal("info"))).toBe(false);
  });
});

describe("vale's default severity map", () => {
  it("maps a suggestion to notice", async () => {
    const config = parseDocevalsConfig(
      ["evals:", "  style:", "    grader: tool:vale", "suites:", "  s: { evals: [style] }"].join(
        "\n",
      ),
    );
    const plan = resolvePage(page("eval-suite: s"), config);
    const style = plan.evals[0];
    if (style === undefined) throw new Error("the suite resolved no eval");
    const exec: ExecFn = () =>
      Promise.resolve({
        code: 1,
        stdout: JSON.stringify({
          "docs/page.md": [{ Check: "Style.Wordy", Message: "Too wordy", Line: 7, Severity: "suggestion" }],
        }),
        stderr: "",
        timedOut: false,
      });
    const findings = await valeGrader.grade({
      targets: [{ plan, eval: style }],
      config,
      root: "/fake",
      exec,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "notice" });
  });
});

describe("reporters", () => {
  const REPORT: EngineReport = {
    pages: 1,
    evalResults: [
      {
        evalName: "style",
        type: "regression",
        grader: "tool:vale",
        file: "docs/page.md",
        outcome: "fail",
        findings: [
          { evalName: "style", file: "docs/page.md", message: "Spelling", severity: "error", line: 3 },
          { evalName: "style", file: "docs/page.md", message: "Too wordy", severity: "notice", line: 7 },
        ],
        durationMs: 1,
      },
    ],
    suites: [],
    usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
    generated: [],
    exitCode: 1,
    problems: [],
  };

  it("sarif writes notice as note", () => {
    const log = JSON.parse(render(REPORT, "sarif")) as {
      runs: { results: { level: string }[] }[];
    };
    expect(log.runs[0]?.results.map((r) => r.level)).toEqual(["error", "note"]);
  });

  it("github writes notice as a ::notice annotation", () => {
    expect(render(REPORT, "github")).toContain(
      "::notice file=docs/page.md,line=7,title=manni docevals%3A style::Too wordy",
    );
  });

  it("pretty, markdown and html label the finding notice", () => {
    expect(stripVTControlCharacters(render(REPORT, "pretty"))).toContain("notice:7 Too wordy");
    expect(render(REPORT, "markdown")).toContain("  - notice:7: Too wordy");
    expect(render(REPORT, "html")).toContain('<span class="sev notice">notice</span>');
  });
});
