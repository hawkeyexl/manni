/**
 * Where the reporters point a result: at the entry that declares its eval.
 *
 * A finding with a line of its own in the page keeps it, because that is the
 * content the eval objected to. Everything else about an eval has no content
 * line, so it lands on the eval's `location`, which may be a manifest.
 */
import { describe, expect, it } from "vitest";
import type { ConsensusResult } from "@hawkeyexl/inference";
import { render } from "../../../src/docevals/reporters/index.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";

const judgeFail: ConsensusResult = {
  runs: [
    {
      verdict: {
        claim: "the page says what goTo waits for",
        observed: "it does not",
        match: "fail",
        confidence: 0.9,
        reasoning: "No wait condition is named.",
      },
      provider: "mock",
      model: "mock",
      cached: false,
      durationMs: 1,
    },
  ],
  votes: { pass: 0, fail: 1, partial: 0, error: 0 },
  verdict: "fail",
  agreement: 1,
  meanConfidence: 0.9,
  zone: "auto-fail",
};

const REPORT: EngineReport = {
  pages: 2,
  evalResults: [
    {
      evalName: "no-todo-markers",
      suite: "reference",
      type: "regression",
      grader: "tool:regex",
      file: "docs/goTo.mdx",
      location: { file: "docs/goTo.mdx", line: 7 },
      outcome: "fail",
      findings: [
        {
          evalName: "no-todo-markers",
          file: "docs/goTo.mdx",
          ruleId: "regex/found",
          message: "Pattern found",
          severity: "error",
          line: 14,
        },
      ],
      durationMs: 1,
    },
    {
      evalName: "check-script",
      suite: "reference",
      type: "regression",
      grader: "command",
      file: "docs/goTo.mdx",
      location: { file: "site.metadata.yaml", line: 9 },
      outcome: "fail",
      findings: [
        {
          evalName: "check-script",
          file: "docs/goTo.mdx",
          message: "exit 1",
          severity: "error",
        },
      ],
      durationMs: 1,
    },
    {
      evalName: "waits-are-named",
      suite: "reference",
      type: "regression",
      grader: "ai",
      file: "docs/goTo.mdx",
      location: { file: "site.metadata.yaml", line: 12 },
      outcome: "fail",
      consensus: judgeFail,
      durationMs: 1,
    },
    {
      evalName: "broken-check",
      suite: "reference",
      type: "regression",
      grader: "command",
      file: "docs/find.mdx",
      location: { file: "docs/find.mdx", line: 9 },
      outcome: "error",
      skipReason: "spawn ENOENT",
      durationMs: 1,
    },
    {
      evalName: "suite-default",
      suite: "reference",
      type: "regression",
      grader: "tool:regex",
      file: "docs/find.mdx",
      location: { file: "docs/find.mdx" },
      outcome: "pass",
      durationMs: 1,
    },
  ],
  suites: [],
  usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
  generated: [],
  problems: [],
  exitCode: 1,
};

describe("github", () => {
  const lines = render(REPORT, "github").split("\n");

  it("keeps a finding's own content line", () => {
    expect(lines).toContain(
      "::error file=docs/goTo.mdx,line=14,title=manni docevals%3A no-todo-markers::Pattern found",
    );
  });

  it("falls back to the declaring entry for a finding with no line", () => {
    expect(lines).toContain(
      "::error file=site.metadata.yaml,line=9,title=manni docevals%3A check-script::exit 1",
    );
  });

  it("annotates a judged failure at the declaring entry", () => {
    expect(lines).toContain(
      "::error file=site.metadata.yaml,line=12,title=manni docevals%3A waits-are-named::" +
        "AI judge: fail (confidence 0.90). No wait condition is named.",
    );
  });
});

interface Sarif {
  runs: {
    results: {
      ruleId: string;
      locations: {
        physicalLocation: {
          artifactLocation: { uri: string };
          region?: { startLine: number };
        };
      }[];
    }[];
  }[];
}

describe("sarif", () => {
  const log = JSON.parse(render(REPORT, "sarif")) as Sarif;
  const where = (ruleId: string) =>
    log.runs[0]?.results.find((r) => r.ruleId === ruleId)?.locations[0]?.physicalLocation;

  it("keeps a finding's own content line", () => {
    expect(where("regex/found")).toEqual({
      artifactLocation: { uri: "docs/goTo.mdx" },
      region: { startLine: 14 },
    });
  });

  it("puts a finding with no line at the declaring entry", () => {
    expect(where("check-script")).toEqual({
      artifactLocation: { uri: "site.metadata.yaml" },
      region: { startLine: 9 },
    });
  });

  it("puts a judged failure and an errored eval at their declaring entries", () => {
    expect(where("waits-are-named")).toEqual({
      artifactLocation: { uri: "site.metadata.yaml" },
      region: { startLine: 12 },
    });
    expect(where("broken-check")).toEqual({
      artifactLocation: { uri: "docs/find.mdx" },
      region: { startLine: 9 },
    });
  });
});

describe("junit", () => {
  const xml = render(REPORT, "junit");

  it("gives each testcase the declaring file and line", () => {
    expect(xml).toContain(
      '<testcase classname="docs/goTo.mdx" name="waits-are-named" file="site.metadata.yaml" line="12" time="0.001">',
    );
  });

  it("omits the line when no entry records one", () => {
    expect(xml).toContain(
      '<testcase classname="docs/find.mdx" name="suite-default" file="docs/find.mdx" time="0.001" />',
    );
  });
});

describe("pretty, markdown and html", () => {
  it("pretty shows the declaring entry beside the eval name", () => {
    const out = render(REPORT, "pretty");
    expect(out).toContain("waits-are-named [auto-fail]  site.metadata.yaml:12");
    expect(out).toContain("suite-default  docs/find.mdx");
  });

  it("markdown names the declaring entry beside the page", () => {
    const out = render(REPORT, "markdown");
    expect(out).toContain("**waits-are-named** — `docs/goTo.mdx` · `site.metadata.yaml:12`");
    // When the page declares the eval, one label says both.
    expect(out).toContain("**no-todo-markers** — `docs/goTo.mdx:7`");
  });

  it("html shows the declaring entry beside the eval name", () => {
    const out = render(REPORT, "html");
    expect(out).toContain("<code>waits-are-named</code>");
    expect(out).toContain("site.metadata.yaml:12");
  });
});
