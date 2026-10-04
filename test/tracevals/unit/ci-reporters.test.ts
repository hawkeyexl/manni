/**
 * The CI formats: `github`, `sarif` and `junit`, for one trace and for a batch.
 *
 * Shapes follow docevals' reporters. What is tracevals' own is the location:
 * a finding points at the artifact file that declared the eval, and the trace
 * it was graded against travels in the message (github), the properties
 * (sarif) or the testsuite name (junit).
 */
import { describe, expect, it } from "vitest";
import type { ConsensusResult } from "@hawkeyexl/inference";
import { render, renderBatch } from "../../../src/tracevals/reporters/index.js";
import { renderGithub } from "../../../src/tracevals/reporters/github.js";
import { renderSarif } from "../../../src/tracevals/reporters/sarif.js";
import { renderJunit } from "../../../src/tracevals/reporters/junit.js";
import { ciInputFromBatch, ciInputFromRun } from "../../../src/tracevals/reporters/ci.js";
import { aggregate } from "../../../src/tracevals/aggregate.js";
import type { EvalResult, RunReport } from "../../../src/tracevals/types.js";
import { must } from "../helpers.js";

const ROOT = "C:\\work\\demo";

const judgeFail: ConsensusResult = {
  runs: [
    {
      verdict: {
        claim: "ran the tests before committing",
        observed: "committed without running tests",
        match: "fail",
        confidence: 0.8,
        reasoning: "No test command preceded the commit.",
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
  meanConfidence: 0.8,
  zone: "auto-fail",
};

const results: EvalResult[] = [
  {
    evalName: "forbidden-tool",
    artifact: "C:\\work\\demo\\skills\\fix-bug\\SKILL.md",
    artifactName: "fix-bug",
    artifactType: "skill",
    grader: "tool-usage",
    implicit: false,
    outcome: "fail",
    findings: [
      {
        evalName: "forbidden-tool",
        artifact: "C:\\work\\demo\\skills\\fix-bug\\SKILL.md",
        message: "tool Bash was used 1 time(s) but must not be",
        severity: "error",
      },
    ],
    durationMs: 2,
  },
  {
    evalName: "tests-first",
    artifact: "C:\\work\\demo\\CLAUDE.md",
    artifactName: "CLAUDE.md",
    artifactType: "project-rules",
    grader: "ai",
    implicit: false,
    outcome: "fail",
    consensus: judgeFail,
    durationMs: 5,
  },
  {
    evalName: "lint-clean",
    // Outside the root: a user-level skill, the ordinary case for tracevals.
    artifact: "C:\\Users\\me\\.claude\\skills\\lint\\SKILL.md",
    artifactName: "lint",
    artifactType: "skill",
    grader: "command",
    implicit: false,
    outcome: "error",
    error: "command: spawn ENOENT",
    durationMs: 1,
  },
  {
    evalName: "asked-first",
    artifact: "C:\\work\\demo\\CLAUDE.md",
    artifactName: "CLAUDE.md",
    artifactType: "project-rules",
    grader: "human",
    implicit: false,
    outcome: "needs-review",
    durationMs: 0,
  },
  {
    evalName: "turn-budget",
    artifact: "C:\\work\\demo\\CLAUDE.md",
    artifactName: "CLAUDE.md",
    artifactType: "project-rules",
    grader: "turn-count",
    implicit: false,
    outcome: "pass",
    durationMs: 1,
  },
];

const report: RunReport = {
  trace: {
    file: "C:\\work\\demo\\traces\\session.jsonl",
    source: "claude-code",
    sessionId: "abc",
    cwd: ROOT,
    turnCount: 4,
  },
  warnings: ["1 unparseable JSONL line(s) were skipped"],
  coverage: [],
  availability: {
    recorded: false,
    skills: { offered: 0, used: 0, unused: 0 },
    agents: { offered: 0, used: 0, unused: 0 },
    listed: false,
  },
  evalResults: results,
  summary: { total: 5, pass: 1, fail: 2, error: 1, needsReview: 1, skipped: 0, passRate: 0.25 },
  exitCode: 1,
  turns: 1,
  durationMs: 9,
};

describe("github", () => {
  const out = renderGithub(ciInputFromRun(report, { root: ROOT }), "SUMMARY");
  const lines = out.split("\n");

  it("annotates a finding at the artifact that declared the eval, naming the trace", () => {
    expect(lines).toContain(
      "::error file=skills/fix-bug/SKILL.md,title=manni tracevals%3A forbidden-tool::" +
        "tool Bash was used 1 time(s) but must not be (trace: traces/session.jsonl)",
    );
  });

  it("annotates a judged failure with its confidence and reasoning", () => {
    expect(lines).toContain(
      "::error file=CLAUDE.md,title=manni tracevals%3A tests-first::" +
        "AI judge: fail (confidence 0.80). No test command preceded the commit. (trace: traces/session.jsonl)",
    );
  });

  it("annotates an errored eval rather than leaving it to the summary", () => {
    expect(lines).toContain(
      "::error file=C%3A/Users/me/.claude/skills/lint/SKILL.md,title=manni tracevals%3A lint-clean::" +
        "command: spawn ENOENT (trace: traces/session.jsonl)",
    );
  });

  it("carries trace warnings as warning annotations", () => {
    expect(lines).toContain(
      "::warning title=manni tracevals::1 unparseable JSONL line(s) were skipped (trace: traces/session.jsonl)",
    );
  });

  it("annotates nothing for a pass or a review queue", () => {
    expect(out).not.toContain("turn-budget");
    expect(out).not.toContain("asked-first");
  });

  it("ends with the markdown summary after a blank line", () => {
    expect(out.endsWith("\n\nSUMMARY")).toBe(true);
  });

  it("render(report, 'github') appends the run's markdown summary", () => {
    const rendered = render(report, "github");
    expect(rendered).toContain("::error ");
    expect(rendered).toContain("| Outcome | Artifact | Eval | Grader | Detail |");
  });
});

describe("sarif", () => {
  const log = JSON.parse(renderSarif(ciInputFromRun(report, { root: ROOT }))) as {
    version: string;
    runs: {
      tool: { driver: { name: string; rules: { id: string; name: string; defaultConfiguration: { level: string } }[] } };
      originalUriBaseIds: Record<string, { uri: string }>;
      results: {
        ruleId: string;
        level: string;
        message: { text: string };
        locations: { physicalLocation: { artifactLocation: { uri: string; uriBaseId?: string } } }[];
        properties: Record<string, unknown>;
      }[];
    }[];
  };
  const run = must(log.runs[0], "the one SARIF run");

  it("is SARIF 2.1.0 from manni-tracevals, rooted at the run root", () => {
    expect(log.version).toBe("2.1.0");
    expect(run.tool.driver.name).toBe("manni-tracevals");
    expect(run.originalUriBaseIds.SRCROOT?.uri).toBe("file:///C:/work/demo/");
  });

  it("names rules tracevals/<grader> and declares every one it reports", () => {
    const ids = run.tool.driver.rules.map((r) => r.id).sort();
    expect(ids).toEqual(["tracevals/ai", "tracevals/command", "tracevals/tool-usage"]);
    for (const r of run.results) expect(ids).toContain(r.ruleId);
    expect(run.tool.driver.rules.find((r) => r.id === "tracevals/ai")?.name).toBe("ai");
  });

  it("locates a finding at the artifact, with the trace in its properties", () => {
    const finding = must(run.results.find((r) => r.ruleId === "tracevals/tool-usage"), "the finding");
    expect(finding.level).toBe("error");
    expect(finding.message.text).toBe("tool Bash was used 1 time(s) but must not be");
    expect(finding.locations[0]?.physicalLocation.artifactLocation).toEqual({
      uri: "skills/fix-bug/SKILL.md",
      uriBaseId: "SRCROOT",
    });
    expect(finding.properties).toEqual({
      eval: "forbidden-tool",
      artifactName: "fix-bug",
      artifactType: "skill",
      trace: "traces/session.jsonl",
      sessionId: "abc",
    });
  });

  it("gives an artifact outside the root an absolute file URI", () => {
    const errored = must(run.results.find((r) => r.ruleId === "tracevals/command"), "the errored eval");
    expect(errored.level).toBe("error");
    expect(errored.message.text).toBe("command: spawn ENOENT");
    expect(errored.locations[0]?.physicalLocation.artifactLocation).toEqual({
      uri: "file:///C:/Users/me/.claude/skills/lint/SKILL.md",
    });
  });

  it("reports a judged failure, and nothing for a pass or a review queue", () => {
    const judged = must(run.results.find((r) => r.ruleId === "tracevals/ai"), "the judged failure");
    expect(judged.message.text).toBe(
      "AI judge: fail (confidence 0.80). No test command preceded the commit.",
    );
    expect(run.results).toHaveLength(3);
  });

  it("maps notice to note", () => {
    const quiet: RunReport = {
      ...report,
      evalResults: [
        {
          ...must(results[0], "the first result"),
          outcome: "pass",
          findings: [
            {
              evalName: "forbidden-tool",
              artifact: "C:\\work\\demo\\skills\\fix-bug\\SKILL.md",
              message: "close to the limit",
              severity: "notice",
            },
          ],
        },
      ],
    };
    const parsed = JSON.parse(render(quiet, "sarif")) as typeof log;
    expect(parsed.runs[0]?.results[0]?.level).toBe("note");
  });
});

describe("junit", () => {
  const xml = renderJunit(ciInputFromRun(report, { root: ROOT }));

  it("is one testsuite per trace, with outcome tallies", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<testsuites name="manni-tracevals" tests="5" failures="2" errors="1">');
    expect(xml).toContain(
      '<testsuite name="traces/session.jsonl" tests="5" failures="2" errors="1" skipped="1" time="0.009">',
    );
  });

  it("names a testcase by artifact and eval, and fails it with the finding", () => {
    expect(xml).toContain(
      '<testcase classname="skills/fix-bug/SKILL.md" name="forbidden-tool" time="0.002">\n' +
        '      <failure message="forbidden-tool failed" type="tracevals/tool-usage">' +
        "tool Bash was used 1 time(s) but must not be</failure>",
    );
  });

  it("fails a judged eval with the judge's reasoning", () => {
    expect(xml).toContain(
      '<failure message="tests-first failed" type="tracevals/ai">' +
        "AI judge: fail (confidence 0.80). No test command preceded the commit.</failure>",
    );
  });

  it("errors an errored eval with its reason", () => {
    expect(xml).toContain(
      '<error message="lint-clean errored" type="tracevals/command">command: spawn ENOENT</error>',
    );
  });

  it("skips a review queue and passes a pass", () => {
    expect(xml).toContain('<skipped message="needs human review" />');
    expect(xml).toContain('<testcase classname="CLAUDE.md" name="turn-budget" time="0.001" />');
  });

  it("escapes XML metacharacters in messages", () => {
    const nasty: RunReport = {
      ...report,
      evalResults: [
        {
          ...must(results[0], "the first result"),
          findings: [
            {
              evalName: "forbidden-tool",
              artifact: "C:\\work\\demo\\skills\\fix-bug\\SKILL.md",
              message: 'used <Bash> & "rm"\u001b[31m',
              severity: "error",
            },
          ],
        },
      ],
    };
    const out = render(nasty, "junit");
    expect(out).toContain("used &lt;Bash&gt; &amp; &quot;rm&quot;[31m");
  });
});

describe("batch CI formats", () => {
  const second: RunReport = {
    ...report,
    trace: { ...report.trace, file: "C:\\work\\demo\\traces\\second.jsonl", sessionId: "def" },
    warnings: [],
    evalResults: [{ ...must(results[4], "the passing result") }],
    summary: { total: 1, pass: 1, fail: 0, error: 0, needsReview: 0, skipped: 0, passRate: 1 },
    exitCode: 0,
  };
  const batch = aggregate(
    [
      { file: report.trace.file, report },
      { file: second.trace.file, report: second },
      { file: "C:\\work\\demo\\traces\\broken.jsonl", error: "not JSONL", durationMs: 1 },
    ],
    { durationMs: 10, warnings: ["plugin ./x.js registered nothing"] },
  );
  const input = ciInputFromBatch(batch, [report, second], { root: ROOT });

  it("github annotates every trace, the unreadable one, and batch warnings", () => {
    const out = renderGithub(input, "SUMMARY");
    expect(out).toContain("(trace: traces/session.jsonl)");
    expect(out).toContain(
      "::error file=traces/broken.jsonl,title=manni tracevals::trace could not be evaluated: not JSONL",
    );
    expect(out).toContain("::warning title=manni tracevals::plugin ./x.js registered nothing");
  });

  it("sarif reports the unreadable trace under tracevals/trace", () => {
    const log = JSON.parse(renderSarif(input)) as {
      runs: { tool: { driver: { rules: { id: string }[] } }; results: { ruleId: string; message: { text: string } }[] }[];
    };
    const run = must(log.runs[0], "the one SARIF run");
    const broken = must(run.results.find((r) => r.ruleId === "tracevals/trace"), "the unreadable trace");
    expect(broken.message.text).toBe("trace could not be evaluated: not JSONL");
    expect(run.tool.driver.rules.map((r) => r.id)).toContain("tracevals/trace");
  });

  it("junit has a testsuite per trace, the unreadable one as an error", () => {
    const xml = renderJunit(input);
    expect(xml).toContain('<testsuites name="manni-tracevals" tests="7" failures="2" errors="2">');
    expect(xml).toContain('<testsuite name="traces/second.jsonl" tests="1" failures="0" errors="0" skipped="0"');
    expect(xml).toContain(
      '<testsuite name="traces/broken.jsonl" tests="1" failures="0" errors="1" skipped="0" time="0.001">',
    );
    expect(xml).toContain(
      '<error message="trace could not be evaluated" type="tracevals/trace">not JSONL</error>',
    );
  });

  it("renderBatch takes the per-trace reports for a CI format", () => {
    const out = renderBatch(batch, "github", [report, second]);
    expect(out).toContain("::error ");
    // The aggregate's own markdown is the summary, not one trace's.
    expect(out).toContain("traces/broken.jsonl");
  });

  it("renderBatch refuses a CI format without the per-trace reports", () => {
    expect(() => renderBatch(batch, "sarif")).toThrow(/per-trace reports/);
  });
});
