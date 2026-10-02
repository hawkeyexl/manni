/**
 * docevals speaks the family's severity scale, `notice | warning | error`,
 * from `src/shared/severity.ts`. A flag or key two domains both have carries
 * the same name and the same values, so `info` (the scale docevals was
 * imported with) is an unknown value everywhere a user can write one: an eval
 * in the config and an eval on a page.
 *
 * `severity-map` mapped a wrapped tool's own scale onto this one. No
 * registered grader has a scale of its own, so the key is gone from the
 * config, and on a page, where the shared vocabulary still allows it, it is a
 * warning that it does nothing.
 */
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { SEVERITIES } from "../../../src/shared/severity.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import { isValidProposal } from "../../../src/docevals/fill/prompt.js";
import { render } from "../../../src/docevals/reporters/index.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";
import { DocevalsError } from "../../../src/docevals/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import { programName } from "../../../src/shared/program-name.js";

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
  it("accepts notice on an eval", () => {
    const config = parseDocevalsConfig(
      ["evals:", "  style:", "    grader: tool:regex", "    severity: notice"].join("\n"),
    );
    expect(config.evals.style?.severity).toBe("notice");
  });

  it("rejects info on an eval as an ordinary schema error", () => {
    expect(() =>
      parseDocevalsConfig(
        ["evals:", "  style:", "    grader: tool:regex", "    severity: info"].join(
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

  it("refuses severity-map as an unknown key, naming where it is", () => {
    expect(() =>
      parseDocevalsConfig(
        [
          "evals:",
          "  style:",
          "    grader: tool:regex",
          "    severity-map: { suggestion: notice }",
        ].join("\n"),
      ),
    ).toThrow(
      new DocevalsError(
        "Invalid config in /fake/manni.config.yaml:\n" +
          '  /docevals/evals/style: unknown key "severity-map"',
      ),
    );
  });
});

describe("severity-map on a page", () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetWarnings();
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stderr.mockRestore();
  });

  const MAPPED = [
    "evals:",
    "  - id: quiet",
    "    grader: tool:regex",
    "    options: { pattern: Body }",
    "    severity-map: { suggestion: notice }",
  ].join("\n");

  it("warns once that it has no effect, and still resolves the eval", () => {
    const first = resolvePage(page(MAPPED), EMPTY);
    resolvePage(page(MAPPED), EMPTY);
    expect(first.problems).toEqual([]);
    expect(first.evals.map((e) => e.name)).toEqual(["quiet"]);
    expect(stderr.mock.calls).toEqual([
      [
        `${programName()}: docs/page.md: eval "quiet" sets severity-map, ` +
          "which no registered grader reads; it has no effect.\n",
      ],
    ]);
  });

  it("says nothing for an eval that does not set it", () => {
    resolvePage(page("evals:\n  - id: plain\n    grader: tool:regex"), EMPTY);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("severity on a page", () => {
  it("accepts notice on an inline eval", () => {
    const plan = resolvePage(
      page("evals:\n  - id: quiet\n    grader: tool:regex\n    severity: notice"),
      EMPTY,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.evals[0]?.severity).toBe("notice");
  });

  it("reports info as a schema error on the page", () => {
    const plan = resolvePage(
      page("evals:\n  - id: quiet\n    grader: tool:regex\n    severity: info"),
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

describe("reporters", () => {
  const REPORT: EngineReport = {
    pages: 1,
    evalResults: [
      {
        evalName: "style",
        type: "regression",
        grader: "tool:regex",
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
