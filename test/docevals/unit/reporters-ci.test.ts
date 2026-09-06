/**
 * SARIF and JUnit reporters (docmeta proposal 0003).
 *
 * `github` already annotates a pull request, but it only reaches GitHub
 * Actions. SARIF is what a code-scanning dashboard ingests — findings survive
 * as a queryable history rather than as log lines that scroll away — and JUnit
 * is what every CI system already knows how to render as a test report.
 * Neither adds a check; both make the checks that ran legible somewhere else.
 */
import { describe, it, expect } from "vitest";
import { render } from "../../../src/docevals/reporters/index.js";
import { REPORT_FORMATS } from "../../../src/docevals/reporters/format.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";

const REPORT: EngineReport = {
  pages: 2,
  evalResults: [
    {
      evalName: "fresh-enough",
      suite: "reference",
      type: "regression",
      grader: "tool:freshness",
      file: "docs/goTo.mdx",
      outcome: "fail",
      findings: [
        {
          evalName: "fresh-enough",
          file: "docs/goTo.mdx",
          ruleId: "freshness/stale",
          message: "Reviewed 900 days ago",
          severity: "error",
          line: 4,
          col: 1,
        },
      ],
      durationMs: 3,
    },
    {
      evalName: "readable",
      suite: "reference",
      type: "regression",
      grader: "tool:reading-level",
      file: "docs/concepts.md",
      outcome: "pass",
      durationMs: 2,
    },
    {
      evalName: "skipped-one",
      suite: "reference",
      type: "regression",
      grader: "ai",
      file: "docs/index.mdx",
      outcome: "skipped",
      skipReason: "page skipped",
      durationMs: 0,
    },
  ],
  suites: [
    {
      suite: "reference",
      total: 3,
      passed: 1,
      failed: 1,
      needsReview: 0,
      skipped: 1,
      errored: 0,
      passRate: 0.5,
      targetPassRate: 1,
      meetsTarget: false,
    },
  ],
  usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
  generated: [],
  problems: [],
  exitCode: 1,
};

/**
 * Just enough of SARIF 2.1.0 to read what these tests assert.
 *
 * Declared here rather than imported from the reporter: the point is to pin
 * the *wire shape* a code-scanning host consumes, and asserting against the
 * reporter's own types would only restate its construction back at itself.
 */
interface SarifLog {
  $schema: string;
  version: string;
  runs: {
    tool: { driver: { name: string; rules: { id: string }[] } };
    results: {
      ruleId: string;
      level: string;
      message: { text: string };
      locations: {
        physicalLocation: {
          artifactLocation: { uri: string };
          region?: { startLine: number; startColumn?: number };
        };
      }[];
    }[];
  }[];
}

describe("sarif reporter", () => {
  const sarif = (): SarifLog => JSON.parse(render(REPORT, "sarif")) as SarifLog;

  it("is offered as a format", () => {
    expect(REPORT_FORMATS).toContain("sarif");
  });

  it("emits a SARIF 2.1.0 log with one run", () => {
    const log = sarif();
    expect(log.version).toBe("2.1.0");
    expect(log.$schema).toMatch(/sarif/i);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.tool.driver.name).toBe("manni-docevals");
  });

  it("carries each finding as a result with a repo-relative URI", () => {
    // Repo-relative, forward-slashed: an absolute or backslashed path does not
    // match anything GitHub can annotate.
    const result = sarif().runs[0]?.results[0];
    expect(result?.ruleId).toBe("freshness/stale");
    expect(result?.level).toBe("error");
    expect(result?.message.text).toBe("Reviewed 900 days ago");
    const loc = result?.locations[0]?.physicalLocation;
    expect(loc?.artifactLocation.uri).toBe("docs/goTo.mdx");
    expect(loc?.region?.startLine).toBe(4);
  });

  it("declares every rule it reports, so a dashboard can name them", () => {
    const run = sarif().runs[0];
    const declared = run?.tool.driver.rules.map((r) => r.id) ?? [];
    for (const result of run?.results ?? []) {
      expect(declared).toContain(result.ruleId);
    }
  });

  it("maps warning and info onto SARIF levels rather than dropping them", () => {
    const warned: EngineReport = {
      ...REPORT,
      evalResults: [
        {
          ...REPORT.evalResults[0]!,
          findings: [
            { ...REPORT.evalResults[0]!.findings![0]!, severity: "warning" },
            { ...REPORT.evalResults[0]!.findings![0]!, severity: "info" },
          ],
        },
      ],
    };
    const log = JSON.parse(render(warned, "sarif")) as SarifLog;
    const levels = log.runs[0]?.results.map((r) => r.level);
    expect(levels).toEqual(["warning", "note"]);
  });
});

describe("junit reporter", () => {
  const junit = (): string => render(REPORT, "junit");

  it("is offered as a format", () => {
    expect(REPORT_FORMATS).toContain("junit");
  });

  it("emits one testsuite per suite and one testcase per eval result", () => {
    const xml = junit();
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<testsuite name="reference"');
    expect((xml.match(/<testcase /g) ?? [])).toHaveLength(3);
  });

  it("marks a failing eval as a failure and a skipped one as skipped", () => {
    const xml = junit();
    expect(xml).toMatch(/<testcase [^>]*name="fresh-enough"[\s\S]*?<failure/);
    expect(xml).toMatch(/<testcase [^>]*name="skipped-one"[\s\S]*?<skipped/);
  });

  it("escapes XML metacharacters in messages", () => {
    // An unescaped `<` in a finding turns the report into invalid XML, and the
    // CI system reports "no tests" rather than the failure it was handed.
    const hostile: EngineReport = {
      ...REPORT,
      evalResults: [
        {
          ...REPORT.evalResults[0]!,
          findings: [
            {
              ...REPORT.evalResults[0]!.findings![0]!,
              message: 'Expected <h1> & got "h2" \'x\'',
            },
          ],
        },
      ],
    };
    const xml = render(hostile, "junit");
    expect(xml).toContain("&lt;h1&gt; &amp; got &quot;h2&quot; &apos;x&apos;");
    expect(xml).not.toMatch(/<h1>/);
  });
});

/**
 * The failure this reporter's own doc comment warns about, reached by the
 * likeliest route: `commandGrader` builds its message from `outputTail`, which
 * is raw tool stderr, and most CLI tools colour their stderr. XML 1.0 forbids
 * those control characters outright, so escaping only `<>&"'` is not enough.
 */
describe("junit reporter: hostile characters", () => {
  const withMessage = (message: string): EngineReport => ({
    ...REPORT,
    evalResults: [
      {
        ...REPORT.evalResults[0]!,
        findings: [{ ...REPORT.evalResults[0]!.findings![0]!, message }],
      },
    ],
  });

  it("strips ANSI colour codes rather than emitting invalid XML", () => {
    const xml = render(withMessage("\u001b[31mmissing heading\u001b[39m"), "junit");
    expect(xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(xml).toContain("missing heading");
  });

  it("strips every control character XML 1.0 forbids", () => {
    // NUL and friends can reach a message through a tool that writes binary to
    // stderr. Tabs, newlines and carriage returns are legal and must survive.
    const xml = render(withMessage("a\u0000b\u0007c\td\ne"), "junit");
    expect(xml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(xml).toContain("\t");
    expect(xml).toMatch(/d\ne/);
  });
});

/**
 * An `error` outcome — an unknown grader, a failed script generation, a
 * command eval with no command — produces neither findings nor consensus. If
 * the reporters only look at those two, an errored eval vanishes: the
 * dashboard shows it as never having run, which reads as "all clear" at
 * exactly the moment something went wrong.
 */
describe("reporters: errored evals", () => {
  const ERRORED: EngineReport = {
    ...REPORT,
    evalResults: [
      {
        evalName: "broken",
        suite: "reference",
        type: "regression",
        grader: "tool:nonesuch",
        file: "docs/a.md",
        outcome: "error",
        skipReason: "unknown grader kind",
        durationMs: 0,
      },
    ],
  };

  it("SARIF carries the errored eval as a result", () => {
    const log = JSON.parse(render(ERRORED, "sarif")) as SarifLog;
    const result = log.runs[0]?.results[0];
    expect(result?.ruleId).toBe("broken");
    expect(result?.level).toBe("error");
    expect(result?.message.text).toMatch(/unknown grader kind/);
  });

  it("SARIF declares the rule for it", () => {
    const log = JSON.parse(render(ERRORED, "sarif")) as SarifLog;
    expect(log.runs[0]?.tool.driver.rules.map((r) => r.id)).toContain("broken");
  });

  it("JUnit puts the reason in the error body, not a bare restatement", () => {
    const xml = render(ERRORED, "junit");
    expect(xml).toMatch(/<error[\s\S]*?unknown grader kind[\s\S]*?<\/error>/);
  });
});
