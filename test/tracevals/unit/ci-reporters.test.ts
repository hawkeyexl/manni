/**
 * The CI formats: `github`, `sarif` and `junit`, for one trace and for a batch.
 *
 * Shapes follow docevals' reporters. What is tracevals' own is the location:
 * a finding points at the entry that declares the eval, and the trace
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

/** What a failed eval tells the reader to do (proposal 0089). */
const S =
  "Redo the session work so it holds, or fix the eval if the artifact does not ask for this.";
const GUIDE = "https://hawkeyexl.github.io/manni/tracevals/triage/";

/** Guidance as the engine stamps it, with its two printed lines. */
function g(id: string, rule: string, description: string | null) {
  return { id, rule, description, guide: GUIDE };
}
const forbiddenGuidance = [
  "skills/fix-bug/SKILL.md forbidden-tool: The session never ran shell commands; this skill is edit-only.",
  `Guide: ${GUIDE}`,
];

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
    location: { file: "C:/work/demo/artifact-evals.yaml", line: 12 },
    outcome: "fail",
    findings: [
      {
        evalName: "forbidden-tool",
        artifact: "C:\\work\\demo\\skills\\fix-bug\\SKILL.md",
        message: `tool Bash was used 1 time(s) but must not be. ${S}`,
        severity: "error",
      },
    ],
    guidance: g(
      "skills/fix-bug/SKILL.md",
      "forbidden-tool",
      "The session never ran shell commands; this skill is edit-only.",
    ),
    durationMs: 2,
  },
  {
    evalName: "tests-first",
    artifact: "C:\\work\\demo\\CLAUDE.md",
    artifactName: "CLAUDE.md",
    artifactType: "project-rules",
    grader: "ai",
    implicit: false,
    location: { file: "C:/work/demo/CLAUDE.md", line: 5 },
    outcome: "fail",
    consensus: judgeFail,
    guidance: g("CLAUDE.md", "tests-first", "Run the tests before committing."),
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
    location: { file: "C:/Users/me/.claude/skills/lint/SKILL.md", line: 9 },
    outcome: "error",
    error: "command: spawn ENOENT",
    guidance: g("C:/Users/me/.claude/skills/lint/SKILL.md", "lint-clean", "Lint passes."),
    durationMs: 1,
  },
  {
    evalName: "asked-first",
    artifact: "C:\\work\\demo\\CLAUDE.md",
    artifactName: "CLAUDE.md",
    artifactType: "project-rules",
    grader: "human",
    implicit: false,
    location: { file: "C:/work/demo/CLAUDE.md", line: 8 },
    outcome: "needs-review",
    skipReason: "awaiting human review",
    guidance: g("CLAUDE.md", "asked-first", "Ask before deleting files."),
    durationMs: 0,
  },
  {
    evalName: "turn-budget",
    artifact: "C:\\work\\demo\\CLAUDE.md",
    artifactName: "CLAUDE.md",
    artifactType: "project-rules",
    grader: "turn-count",
    implicit: false,
    location: { file: "C:/work/demo/CLAUDE.md", line: 11 },
    outcome: "pass",
    guidance: g("CLAUDE.md", "turn-budget", null),
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

  it("annotates a finding at the entry that declares the eval, naming the trace", () => {
    // The eval lives in a manifest, so the annotation does too, not the skill.
    // The trace ends the first line; the guidance lines follow it.
    expect(lines).toContain(
      "::error file=artifact-evals.yaml,line=12,title=manni tracevals%3A forbidden-tool::" +
        `tool Bash was used 1 time(s) but must not be. ${S} (trace: traces/session.jsonl)` +
        `%0A${forbiddenGuidance.join("%0A")}`,
    );
  });

  it("annotates a judged failure with the judged block, then guidance", () => {
    expect(lines).toContain(
      "::error file=CLAUDE.md,line=5,title=manni tracevals%3A tests-first::" +
        `AI judge: fail (confidence 0.80). ${S} (trace: traces/session.jsonl)` +
        "%0AObserved: committed without running tests" +
        "%0AReasoning: No test command preceded the commit." +
        "%0ACLAUDE.md tests-first: Run the tests before committing." +
        `%0AGuide: ${GUIDE}`,
    );
  });

  it("annotates an errored eval rather than leaving it to the summary", () => {
    expect(lines).toContain(
      "::error file=C%3A/Users/me/.claude/skills/lint/SKILL.md,line=9,title=manni tracevals%3A lint-clean::" +
        "command: spawn ENOENT (trace: traces/session.jsonl)" +
        `%0AC:/Users/me/.claude/skills/lint/SKILL.md lint-clean: Lint passes.%0AGuide: ${GUIDE}`,
    );
  });

  it("warns once for an eval awaiting review", () => {
    const review = lines.filter((l) => l.includes("asked-first"));
    expect(review).toEqual([
      "::warning file=CLAUDE.md,line=8,title=manni tracevals%3A asked-first::" +
        "Awaiting human review. Read the session against the assertion and decide. (trace: traces/session.jsonl)" +
        `%0ACLAUDE.md asked-first: Ask before deleting files.%0AGuide: ${GUIDE}`,
    ]);
  });

  it("annotates the file alone when no line declares the eval", () => {
    const implicit: RunReport = {
      ...report,
      evalResults: [
        {
          ...must(results[1], "the judged failure"),
          implicit: true,
          location: { file: "C:/work/demo/CLAUDE.md" },
        },
      ],
    };
    const out = renderGithub(ciInputFromRun(implicit, { root: ROOT }), "SUMMARY");
    expect(out).toContain("::error file=CLAUDE.md,title=manni tracevals%3A tests-first::");
  });

  it("carries trace warnings as warning annotations", () => {
    expect(lines).toContain(
      "::warning title=manni tracevals::1 unparseable JSONL line(s) were skipped (trace: traces/session.jsonl)",
    );
  });

  it("annotates nothing for a pass", () => {
    expect(lines.filter((l) => l.startsWith("::") && l.includes("turn-budget"))).toEqual([]);
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
      tool: {
        driver: {
          name: string;
          rules: {
            id: string;
            name: string;
            shortDescription: { text: string };
            fullDescription?: { text: string };
            helpUri?: string;
            defaultConfiguration: { level: string };
          }[];
        };
      };
      originalUriBaseIds: Record<string, { uri: string }>;
      results: {
        ruleId: string;
        level: string;
        message: { text: string };
        locations: {
          physicalLocation: {
            artifactLocation: { uri: string; uriBaseId?: string };
            region?: { startLine: number };
          };
        }[];
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
    expect(ids).toEqual([
      "tracevals/ai",
      "tracevals/command",
      "tracevals/human",
      "tracevals/tool-usage",
    ]);
    for (const r of run.results) expect(ids).toContain(r.ruleId);
    expect(run.tool.driver.rules.find((r) => r.id === "tracevals/ai")?.name).toBe("ai");
  });

  it("describes a built-in grader's rule and links the triage guide", () => {
    const rule = must(
      run.tool.driver.rules.find((r) => r.id === "tracevals/tool-usage"),
      "the tool-usage rule",
    );
    expect(rule.shortDescription.text).toBe("manni tracevals tool-usage grader");
    expect(rule.fullDescription?.text).toBe(
      "Checks whether the session used a tool, and how often.",
    );
    expect(rule.helpUri).toBe(GUIDE);
    for (const r of run.tool.driver.rules) {
      expect(r.fullDescription?.text, `${r.id} has no full description`).toBeDefined();
      expect(r.helpUri).toBe(GUIDE);
    }
  });

  it("gives a plugin grader's rule neither a full description nor a guide", () => {
    const plugin: RunReport = {
      ...report,
      evalResults: [{ ...must(results[0], "the finding"), grader: "my-plugin" }],
    };
    const parsed = JSON.parse(render(plugin, "sarif")) as typeof log;
    const rule = must(parsed.runs[0]?.tool.driver.rules[0], "the plugin rule");
    expect(rule.id).toBe("tracevals/my-plugin");
    expect(rule.fullDescription).toBeUndefined();
    expect(rule.helpUri).toBeUndefined();
  });

  it("locates a finding at the entry that declares the eval, with the trace in its properties", () => {
    const finding = must(run.results.find((r) => r.ruleId === "tracevals/tool-usage"), "the finding");
    expect(finding.level).toBe("error");
    expect(finding.message.text).toBe(
      [`tool Bash was used 1 time(s) but must not be. ${S}`, ...forbiddenGuidance].join("\n"),
    );
    expect(finding.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: "artifact-evals.yaml", uriBaseId: "SRCROOT" },
      region: { startLine: 12 },
    });
    expect(finding.properties).toEqual({
      eval: "forbidden-tool",
      artifactName: "fix-bug",
      artifactType: "skill",
      trace: "traces/session.jsonl",
      sessionId: "abc",
      guidance: g(
        "skills/fix-bug/SKILL.md",
        "forbidden-tool",
        "The session never ran shell commands; this skill is edit-only.",
      ),
    });
  });

  it("reports an eval awaiting review as one warning under its grader's rule", () => {
    const review = run.results.filter((r) => r.properties.eval === "asked-first");
    expect(review).toHaveLength(1);
    expect(review[0]?.ruleId).toBe("tracevals/human");
    expect(review[0]?.level).toBe("warning");
    expect(review[0]?.message.text).toBe(
      [
        "Awaiting human review. Read the session against the assertion and decide.",
        "CLAUDE.md asked-first: Ask before deleting files.",
        `Guide: ${GUIDE}`,
      ].join("\n"),
    );
  });

  it("gives an artifact outside the root an absolute file URI", () => {
    const errored = must(run.results.find((r) => r.ruleId === "tracevals/command"), "the errored eval");
    expect(errored.level).toBe("error");
    expect(errored.message.text).toBe(
      `command: spawn ENOENT\nC:/Users/me/.claude/skills/lint/SKILL.md lint-clean: Lint passes.\nGuide: ${GUIDE}`,
    );
    expect(errored.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: "file:///C:/Users/me/.claude/skills/lint/SKILL.md" },
      region: { startLine: 9 },
    });
  });

  it("reports a judged failure, and nothing for a pass", () => {
    const judged = must(run.results.find((r) => r.ruleId === "tracevals/ai"), "the judged failure");
    expect(judged.message.text).toBe(
      [
        `AI judge: fail (confidence 0.80). ${S}`,
        "Observed: committed without running tests",
        "Reasoning: No test command preceded the commit.",
        "CLAUDE.md tests-first: Run the tests before committing.",
        `Guide: ${GUIDE}`,
      ].join("\n"),
    );
    expect(run.results.filter((r) => r.properties.eval === "turn-budget")).toEqual([]);
  });

  it("locates an eval a hosted manifest declares at its URL, with no region", () => {
    const hosted: RunReport = {
      ...report,
      evalResults: [
        {
          ...must(results[1], "the judged failure"),
          location: { file: "https://example.com/evals.yaml" },
        },
      ],
    };
    const parsed = JSON.parse(render(hosted, "sarif")) as typeof log;
    expect(parsed.runs[0]?.results[0]?.locations[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: "https://example.com/evals.yaml" },
    });
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
      '<testcase classname="skills/fix-bug/SKILL.md" name="forbidden-tool" ' +
        'file="artifact-evals.yaml" line="12" time="0.002">\n' +
        '      <failure message="forbidden-tool failed" type="tracevals/tool-usage">' +
        `tool Bash was used 1 time(s) but must not be. ${S}\n` +
        "skills/fix-bug/SKILL.md forbidden-tool: The session never ran shell commands; this skill is edit-only.\n" +
        `Guide: ${GUIDE}</failure>`,
    );
  });

  it("fails a judged eval with the judged block, then guidance", () => {
    expect(xml).toContain(
      '<failure message="tests-first failed" type="tracevals/ai">' +
        `AI judge: fail (confidence 0.80). ${S}\n` +
        "Observed: committed without running tests\n" +
        "Reasoning: No test command preceded the commit.\n" +
        "CLAUDE.md tests-first: Run the tests before committing.\n" +
        `Guide: ${GUIDE}</failure>`,
    );
  });

  it("errors an errored eval with its reason, then guidance", () => {
    expect(xml).toContain(
      '<error message="lint-clean errored" type="tracevals/command">command: spawn ENOENT\n' +
        `C:/Users/me/.claude/skills/lint/SKILL.md lint-clean: Lint passes.\nGuide: ${GUIDE}</error>`,
    );
  });

  it("skips a review queue and passes a pass", () => {
    expect(xml).toContain('<skipped message="needs human review" />');
    expect(xml).toContain(
      '<testcase classname="CLAUDE.md" name="turn-budget" file="CLAUDE.md" line="11" time="0.001" />',
    );
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

describe("judged evals in every reporter (proposal 0089)", () => {
  const run = (match: "pass" | "fail" | "partial", observed: string, reasoning: string) => ({
    verdict: { claim: "a failing test came first", observed, match, confidence: 0.88, reasoning },
    provider: "mock",
    model: "mock",
    cached: false,
    durationMs: 1,
  });
  // The passing run comes first. Quoting it would argue against the verdict.
  const split: ConsensusResult = {
    runs: [
      run("pass", "A test file was touched early.", "Looks fine."),
      run("fail", "The session edited src/app.ts before any test file.", "No failing test was written before the fix."),
      run("fail", "Edited the source first.", "Second failing run."),
    ],
    votes: { pass: 1, fail: 2, partial: 0, error: 0 },
    verdict: "fail",
    agreement: 0.67,
    meanConfidence: 0.88,
    zone: "auto-fail",
  };
  const unsure: ConsensusResult = { ...split, verdict: "pass", zone: "human-review" };
  const skill = ".claude/skills/fix-bug/SKILL.md";
  const judged = (evalName: string, outcome: "fail" | "needs-review", consensus: ConsensusResult): EvalResult => ({
    evalName,
    artifact: `${ROOT}\\.claude\\skills\\fix-bug\\SKILL.md`,
    artifactName: "fix-bug",
    artifactType: "skill",
    grader: "ai",
    implicit: false,
    location: { file: skill, line: 27 },
    outcome,
    consensus,
    guidance: g(skill, evalName, "Reproduce the bug with a failing test before applying the fix."),
    durationMs: 1,
  });
  const judgedReport: RunReport = {
    ...report,
    warnings: [],
    evalResults: [judged("eval-5", "fail", split), judged("eval-6", "needs-review", unsure)],
    summary: { total: 2, pass: 0, fail: 1, error: 0, needsReview: 1, skipped: 0, passRate: 0 },
  };
  const OBSERVED = "Observed: The session edited src/app.ts before any test file.";
  const REASONING = "Reasoning: No failing test was written before the fix.";
  const REVIEW =
    "AI judge: no confident verdict (confidence 0.88). Read the session and decide. " +
    "If this recurs, sharpen the assertion and run manni tracevals calibrate.";

  it.each(["pretty", "github", "sarif", "junit", "markdown"] as const)(
    "%s quotes the failing run, never the passing one",
    (format) => {
      const out = render(judgedReport, format);
      expect(out).toContain(OBSERVED);
      expect(out).toContain(REASONING);
      expect(out).not.toContain("A test file was touched early.");
      expect(out).not.toContain("Looks fine.");
    },
  );

  it("pretty prints the judged block, the votes, then the guidance", () => {
    const lines = render(judgedReport, "pretty").split("\n");
    const at = lines.findIndex((l) => l.includes("fix-bug › eval-5"));
    expect(lines.slice(at, at + 7)).toEqual([
      `  FAIL   fix-bug › eval-5  ${skill}:27`,
      `         AI judge: fail (confidence 0.88). ${S}`,
      `         ${OBSERVED}`,
      `         ${REASONING}`,
      "         votes pass:1 fail:2 partial:0 error:0",
      `         ${skill} eval-5: Reproduce the bug with a failing test before applying the fix.`,
      `         Guide: ${GUIDE}`,
    ]);
  });

  it("pretty prints a needs-review eval's judged block", () => {
    const out = render(judgedReport, "pretty");
    expect(out).toContain(`         ${REVIEW}`);
  });

  it("github warns once for an eval the judge could not settle", () => {
    const lines = render(judgedReport, "github").split("\n");
    const warnings = lines.filter((l) => l.startsWith("::warning") && l.includes("eval-6"));
    expect(warnings).toHaveLength(1);
    // render() roots paths at the working directory, so the trace is absolute here.
    expect(warnings[0]).toMatch(/::AI judge: no confident verdict .* \(trace: [^)]+\)%0AObserved: /);
    expect(warnings[0]).toContain(`::${REVIEW} (trace: `);
  });

  it("sarif reports an eval the judge could not settle as one ai warning", () => {
    const log = JSON.parse(render(judgedReport, "sarif")) as {
      runs: { results: { ruleId: string; level: string; message: { text: string }; properties: { eval: string } }[] }[];
    };
    const review = (log.runs[0]?.results ?? []).filter((r) => r.properties.eval === "eval-6");
    expect(review).toHaveLength(1);
    expect(review[0]?.ruleId).toBe("tracevals/ai");
    expect(review[0]?.level).toBe("warning");
    expect(review[0]?.message.text.startsWith(`${REVIEW}\n${OBSERVED}`)).toBe(true);
  });

  it("markdown lists every eval to act on under Findings", () => {
    const out = render(judgedReport, "markdown");
    expect(out).toContain(
      [
        "## Findings",
        "",
        `- **FAIL** fix-bug › eval-5 · \`${skill}:27\``,
        `  - AI judge: fail (confidence 0.88). ${S}`,
        `  - ${OBSERVED}`,
        `  - ${REASONING}`,
        `  - ${skill} eval-5: Reproduce the bug with a failing test before applying the fix.`,
        `  - Guide: ${GUIDE}`,
        `- **REVIEW** fix-bug › eval-6 · \`${skill}:27\``,
        `  - ${REVIEW}`,
      ].join("\n"),
    );
    // The Evals table stays where it was, ahead of the new section.
    expect(out.indexOf("## Evals")).toBeLessThan(out.indexOf("## Findings"));
  });

  it("markdown lists a finding, an error and a human review, and leaves a pass out", () => {
    const out = render(report, "markdown");
    const findings = out.slice(out.indexOf("## Findings"), out.indexOf("## Artifact coverage"));
    expect(findings).toContain(
      [
        "- **FAIL** fix-bug › forbidden-tool · `C:/work/demo/artifact-evals.yaml:12`",
        `  - tool Bash was used 1 time(s) but must not be. ${S}`,
        ...forbiddenGuidance.map((l) => `  - ${l}`),
      ].join("\n"),
    );
    expect(findings).toContain(
      "- **ERROR** lint › lint-clean · `C:/Users/me/.claude/skills/lint/SKILL.md:9`",
    );
    expect(findings).toContain("  - command: spawn ENOENT");
    expect(findings).toContain(
      "  - Awaiting human review. Read the session against the assertion and decide.",
    );
    expect(findings).not.toContain("turn-budget");
  });

  it("markdown has no Findings section when everything passed", () => {
    const clean: RunReport = {
      ...report,
      evalResults: [must(results[4], "the passing result")],
    };
    expect(render(clean, "markdown")).not.toContain("## Findings");
  });
});
