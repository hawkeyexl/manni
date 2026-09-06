import { describe, expect, it } from "vitest";
import {
  render,
  renderBatch,
  renderCalibration,
} from "../../../src/tracevals/reporters/index.js";
import { aggregate } from "../../../src/tracevals/aggregate.js";
import type { BatchReport, RunReport } from "../../../src/tracevals/types.js";
import type { CalibrationReport } from "../../../src/tracevals/calibrate/types.js";

const report: RunReport = {
  trace: {
    file: "C:\\traces\\session.jsonl",
    source: "claude-code",
    sessionId: "abc",
    cwd: "C:\\work\\demo-project",
    model: "claude-opus-4-8",
    turnCount: 2,
  },
  warnings: ["1 unparseable JSONL line(s) were skipped"],
  coverage: [
    {
      ref: "fix-bug",
      kind: "skill",
      resolved: true,
      path: "C:\\work\\demo\\SKILL.md",
      tried: [],
    },
    {
      ref: "ghost",
      kind: "skill",
      resolved: false,
      tried: ["a", "b"],
    },
  ],
  evalResults: [
    {
      evalName: "forbidden-tool",
      artifact: "C:\\work\\demo\\SKILL.md",
      artifactName: "fix-bug",
      artifactType: "skill",
      grader: "tool-usage",
      implicit: false,
      outcome: "fail",
      findings: [
        {
          evalName: "forbidden-tool",
          artifact: "C:\\work\\demo\\SKILL.md",
          message: "tool Bash was used 1 time(s) but must not be",
          severity: "error",
        },
      ],
      durationMs: 2,
    },
    {
      evalName: "adheres-to-artifact",
      artifact: "C:\\work\\demo\\CLAUDE.md",
      artifactName: "CLAUDE.md",
      artifactType: "project-rules",
      grader: "llm",
      implicit: true,
      outcome: "pass",
      durationMs: 5,
      costUsd: 0.01,
    },
  ],
  availability: {
    recorded: true,
    skills: { offered: 4, used: 1, unused: 3 },
    agents: { offered: 2, used: 0, unused: 2 },
    listed: false,
  },
  summary: {
    total: 2,
    pass: 1,
    fail: 1,
    error: 0,
    needsReview: 0,
    skipped: 0,
    passRate: 0.5,
  },
  exitCode: 1,
  costUsd: 0.01,
  durationMs: 100,
};

describe("reporters", () => {
  it("json round-trips the report", () => {
    const out = render(report, "json");
    const parsed = JSON.parse(out) as RunReport;
    expect(parsed.summary.fail).toBe(1);
    expect(parsed.evalResults).toHaveLength(2);
  });

  it("human output shows outcomes, findings, coverage, and warnings", () => {
    const out = render(report, "human");
    expect(out).toContain("FAIL");
    expect(out).toContain("forbidden-tool");
    expect(out).toContain("Bash");
    expect(out).toContain("ghost");
    expect(out).toContain("unparseable");
    expect(out).toContain("(implicit)");
  });

  it("markdown output includes eval and coverage tables", () => {
    const out = render(report, "markdown");
    expect(out).toContain("| Outcome | Artifact | Eval | Grader | Detail |");
    expect(out).toContain("| fail | fix-bug |");
    expect(out).toContain("## Artifact coverage");
    expect(out).toContain("**2 eval(s)**");
  });

  // Project rules resolve as one aggregated entry covering several files
  // (CLAUDE.md *and* AGENTS.md), so it is resolved with no single `path`. Every
  // reporter has to render that shape without inventing a location for it.
  describe("a resolved coverage entry with no single path", () => {
    const aggregated: RunReport = {
      ...report,
      coverage: [
        {
          ref: "project rules",
          kind: "project-rules",
          resolved: true,
          tried: ["C:\\work\\demo\\CLAUDE.md", "C:\\work\\demo\\AGENTS.md"],
        },
      ],
    };

    it("markdown renders an empty location, never the string undefined", () => {
      const out = render(aggregated, "markdown");
      expect(out).not.toContain("undefined");
      expect(out).toContain("| yes | project-rules | project rules |  |  |");
    });

    it("human renders an empty location, never the string undefined", () => {
      const out = render(aggregated, "human");
      expect(out).not.toContain("undefined");
    });

    // `ref` comes straight from the trace (a skill name or subagent_type), so a
    // pipe in it must not be able to break the table it is rendered into —
    // markdown reports get pasted into PR comments.
    it("escapes pipes so a coverage row keeps its column count", () => {
      const piped: RunReport = {
        ...aggregated,
        coverage: [
          {
            ref: "weird|name",
            kind: "skill",
            resolved: false,
            tried: [],
            note: "a | b",
          },
        ],
      };
      const out = render(piped, "markdown");
      const header = out.split("\n").find((l) => l.startsWith("| Resolved"))!;
      const row = out.split("\n").find((l) => l.includes("weird"))!;
      const cells = (line: string) => line.split(/(?<!\\)\|/).length - 2;
      expect(cells(row)).toBe(cells(header));
    });

    it("keeps the availability column when the ref carries a pipe", () => {
      const piped: RunReport = {
        ...aggregated,
        coverage: [
          {
            ref: "weird|name",
            kind: "skill",
            resolved: false,
            tried: [],
            availability: "not-offered",
          },
        ],
      };
      expect(render(piped, "markdown")).toContain("not-offered");
    });

    it("falls back to the note when one is present", () => {
      const withNote: RunReport = {
        ...aggregated,
        coverage: [{ ...aggregated.coverage[0]!, note: "several files" }],
      };
      expect(render(withNote, "markdown")).toContain(
        "| yes | project-rules | project rules |  | several files |",
      );
      expect(render(withNote, "human")).toContain("several files");
    });
  });

  // Offered, offered-but-unused, and not-offered are three different problems
  // (ADR 01016), and collapsing any pair sends a reader to the wrong place.
  describe("availability", () => {
    it("summarises the roster without listing it", () => {
      const out = render(report, "human");
      expect(out).toContain("4 skill(s) offered, 1 used, 3 never used");
      expect(out).toContain("2 agent(s) offered, 0 used, 2 never used");
      expect(out).toContain("--report-unused-artifacts");
    });

    it("markdown carries the same summary", () => {
      const out = render(report, "markdown");
      expect(out).toContain("## Availability");
      expect(out).toContain("4 skill(s) offered, 1 used, 3 never used");
    });

    it("says unknown rather than zero when no roster was recorded", () => {
      const none: RunReport = {
        ...report,
        availability: {
          recorded: false,
          skills: { offered: 0, used: 0, unused: 0 },
          agents: { offered: 0, used: 0, unused: 0 },
          listed: false,
        },
      };
      for (const format of ["human", "markdown"] as const) {
        const out = render(none, format);
        expect(out).toContain("unknown");
        expect(out).not.toContain("0 skill(s) offered");
      }
    });

    it("flags a referenced artifact that was never on the menu", () => {
      const missing: RunReport = {
        ...report,
        coverage: [
          { ref: "ghost", kind: "skill", resolved: false, tried: [], availability: "not-offered" },
        ],
      };
      expect(render(missing, "human")).toContain("not offered");
      expect(render(missing, "markdown")).toContain("not-offered");
    });

    it("never claims an unused artifact was not found", () => {
      // Nothing was looked for on disk, so "not found (0 locations tried)"
      // would be a claim about a search that never ran.
      const unused: RunReport = {
        ...report,
        availability: { ...report.availability, listed: true },
        coverage: [
          {
            ref: "deep-research",
            kind: "skill",
            resolved: false,
            tried: [],
            note: "offered, never used — Fan-out web searches.",
            availability: "offered-not-used",
          },
        ],
      };
      const human = render(unused, "human");
      expect(human).toContain("offered, never used — Fan-out web searches.");
      expect(human).not.toContain("not found");
      expect(human).not.toContain("--report-unused-artifacts");
      const markdown = render(unused, "markdown");
      expect(markdown).toContain("| n/a | skill | deep-research |");
      expect(markdown).not.toContain("not found");
    });
  });

  // Editing a SKILL.md after a session grades that session against instructions
  // it never saw. The coverage table is where that shows.
  describe("a stale coverage entry", () => {
    const stale: RunReport = {
      ...report,
      coverage: [
        {
          ref: "fix-bug",
          kind: "skill",
          resolved: true,
          path: "C:\\work\\demo\\SKILL.md",
          tried: [],
          stale: true,
          modifiedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    };

    it("human marks the row and keeps the path", () => {
      const out = render(stale, "human");
      expect(out).toContain("C:\\work\\demo\\SKILL.md");
      expect(out).toContain("modified after the session ended");
      expect(out).toContain("2026-07-01T00:00:00.000Z");
    });

    it("markdown marks the row without breaking the table", () => {
      const out = render(stale, "markdown");
      expect(out).toContain("modified after the session ended");
      const header = out.split("\n").find((l) => l.startsWith("| Resolved"))!;
      // By the note, not by the ref: `fix-bug` also names a row in the evals
      // table above, which has a different column count by design.
      const row = out
        .split("\n")
        .find((l) => l.includes("modified after the session ended"))!;
      const cells = (line: string) => line.split(/(?<!\\)\|/).length - 2;
      expect(cells(row)).toBe(cells(header));
      expect(row).toContain("`C:\\work\\demo\\SKILL.md`");
    });

    it("says nothing when the entry is not stale", () => {
      expect(render(report, "human")).not.toContain(
        "modified after the session ended",
      );
      expect(render(report, "markdown")).not.toContain(
        "modified after the session ended",
      );
    });
  });

  /**
   * A manifest turns the mtime guess into content identity (ADR 01024), and the
   * report has to say which of the two answered — they are different claims and
   * a reader acts on them differently.
   */
  describe("a coverage entry checked against a session manifest", () => {
    const withManifest = (overrides: Partial<RunReport>): RunReport => ({
      ...report,
      manifest: {
        path: ".manni/tracevals/sessions/abc.json",
        sessionId: "abc",
        capturedAt: "2026-06-01T00:00:00.000Z",
        gitSha: "0123456789abcdef0123456789abcdef01234567",
        matched: 1,
        changed: 0,
        unrecorded: 0,
      },
      ...overrides,
    });

    const changed = withManifest({
      coverage: [
        {
          ref: "fix-bug",
          kind: "skill",
          resolved: true,
          path: "C:\\work\\demo\\SKILL.md",
          tried: [],
          stale: true,
          modifiedAt: "2026-07-01T00:00:00.000Z",
          contentCheck: {
            status: "mismatch",
            expected: "a".repeat(64),
            actual: "b".repeat(64),
          },
        },
      ],
      manifest: {
        path: ".manni/tracevals/sessions/abc.json",
        sessionId: "abc",
        capturedAt: "2026-06-01T00:00:00.000Z",
        gitSha: "0123456789abcdef0123456789abcdef01234567",
        matched: 0,
        changed: 1,
        unrecorded: 0,
      },
    });

    it("human names content identity, not mtime, for an exact mismatch", () => {
      const out = render(changed, "human");
      expect(out).toContain("changed since the session started");
      expect(out).not.toContain("modified after the session ended");
      // The path still leads the row: a flagged row is the one to open.
      expect(out).toContain("C:\\work\\demo\\SKILL.md");
    });

    it("human reports the manifest it consulted", () => {
      const out = render(changed, "human");
      expect(out).toContain("Session manifest");
      expect(out).toContain(".manni/tracevals/sessions/abc.json");
      expect(out).toContain("0123456789ab");
      expect(out).toContain("1 changed");
    });

    it("markdown keeps its column count with a manifest verdict", () => {
      const out = render(changed, "markdown");
      const header = out.split("\n").find((l) => l.startsWith("| Resolved"))!;
      const row = out
        .split("\n")
        .find((l) => l.includes("changed since the session started"))!;
      const cells = (line: string) => line.split(/(?<!\\)\|/).length - 2;
      expect(cells(row)).toBe(cells(header));
      expect(out).toContain("## Session manifest");
    });

    it("marks nothing when the manifest proved the content unchanged", () => {
      const unchanged = withManifest({
        coverage: [
          {
            ref: "fix-bug",
            kind: "skill",
            resolved: true,
            path: "C:\\work\\demo\\SKILL.md",
            tried: [],
            // mtime moved — a checkout does that — and the manifest answered.
            stale: false,
            modifiedAt: "2026-07-01T00:00:00.000Z",
            contentCheck: { status: "match" },
          },
        ],
      });
      const out = render(unchanged, "human");
      expect(out).not.toContain("modified after the session ended");
      expect(out).not.toContain("changed since the session started");
      expect(out).toContain("1 artifact(s) unchanged");
    });

    it("says nothing at all when no manifest was found", () => {
      // Silence is the default: a line on every run of every project that has
      // not adopted `capture` is noise.
      expect(render(report, "human")).not.toContain("Session manifest");
      expect(render(report, "markdown")).not.toContain("## Session manifest");
    });

    it("names how many rows still rest on the mtime guess", () => {
      const partial = withManifest({
        manifest: {
          path: ".manni/tracevals/sessions/abc.json",
          sessionId: "abc",
          capturedAt: "2026-06-01T00:00:00.000Z",
          matched: 1,
          changed: 0,
          unrecorded: 2,
        },
      });
      const out = render(partial, "human");
      expect(out).toContain("2 not recorded");
      expect(out).toContain("keep the mtime heuristic");
    });
  });
});

/**
 * The aggregate rendering (ADR 01018). Built from two runs of the same report
 * with the second one's `forbidden-tool` passing, so every row has a rate
 * strictly between 0 and 1 — the case a reporter that only prints counts would
 * render identically to any other.
 */
describe("batch reporters", () => {
  const passing: RunReport = {
    ...report,
    trace: { ...report.trace, file: "C:\\traces\\second.jsonl", sessionId: "def" },
    evalResults: [
      { ...report.evalResults[0]!, outcome: "pass", findings: [] },
      report.evalResults[1]!,
    ],
    summary: { total: 2, pass: 2, fail: 0, error: 0, needsReview: 0, skipped: 0, passRate: 1 },
    exitCode: 0,
  };

  const batch: BatchReport = aggregate(
    [
      { file: "C:\\traces\\session.jsonl", report },
      { file: "C:\\traces\\second.jsonl", report: passing },
      { file: "C:\\traces\\broken.jsonl", error: "not JSONL", durationMs: 1 },
    ],
    { durationMs: 10 },
  );

  it("computes rates with skipped results out of the denominator", () => {
    const row = batch.evals.find((e) => e.evalName === "forbidden-tool")!;
    expect(row.passRate).toBe(0.5);
    expect(row.traces).toBe(2);
    // The outlier is named, not just counted.
    expect(row.failingTraces).toEqual(["C:\\traces\\session.jsonl"]);
  });

  it("counts an unreadable trace against the batch without losing the rest", () => {
    expect(batch.summary.tracesErrored).toBe(1);
    expect(batch.summary.traces).toBe(3);
    expect(batch.exitCode).toBe(1);
    expect(batch.evals.length).toBeGreaterThan(0);
  });

  it("json round-trips the batch report", () => {
    const parsed = JSON.parse(renderBatch(batch, "json")) as BatchReport;
    expect(parsed.summary.traces).toBe(3);
    expect(parsed.evals.some((e) => e.evalName === "forbidden-tool")).toBe(true);
  });

  it("human output shows rates, outliers, and the unreadable trace", () => {
    const out = renderBatch(batch, "human");
    expect(out).toContain("3 trace(s)");
    expect(out).toContain("50%");
    expect(out).toContain("forbidden-tool");
    expect(out).toContain("session.jsonl");
    expect(out).toContain("not JSONL");
    expect(out).not.toContain("undefined");
  });

  it("markdown output includes both rate tables and the trace table", () => {
    const out = renderBatch(batch, "markdown");
    expect(out).toContain(
      "| Rate | Artifact | Eval | Grader | Traces | Outcomes | Outliers |",
    );
    expect(out).toContain("## Artifact pass rates");
    expect(out).toContain("## Traces");
    expect(out).toContain("| error |");
    expect(out).not.toContain("undefined");
  });

  /**
   * An exhausted judge budget is the one skip a reader must not scroll past:
   * it means the rates above it were computed over a corpus the tool stopped
   * looking at. The warnings block at the foot of the report is where the
   * detail belongs; the fact of it belongs beside the headline.
   */
  describe("a batch cut short by its own budget", () => {
    const cutShort = aggregate(
      [
        {
          file: "C:\traces\one.jsonl",
          report: {
            ...report,
            evalResults: [
              {
                ...report.evalResults[0]!,
                outcome: "skipped",
                findings: [],
                skipReason: "judge cost budget exhausted ($0.5)",
              },
            ],
            summary: {
              total: 1,
              pass: 0,
              fail: 0,
              error: 0,
              needsReview: 0,
              skipped: 1,
              passRate: 1,
            },
            exitCode: 0,
          },
        },
      ],
      { durationMs: 1 },
    );

    it("human flags it beside the headline, not only in the warnings", () => {
      const out = renderBatch(cutShort, "human");
      const head = out.slice(0, out.indexOf("Eval pass rates"));
      expect(head).toContain("BUDGET EXHAUSTED");
      expect(head).toContain("1 eval(s) across 1 trace(s)");
    });

    it("markdown carries it in the header block", () => {
      const out = renderBatch(cutShort, "markdown");
      expect(out).toContain("- **Budget**:");
      expect(out).toContain("judge cost budget exhausted ($0.5)");
    });

    it("says nothing at all when the budget held", () => {
      expect(renderBatch(batch, "human")).not.toContain("BUDGET EXHAUSTED");
      expect(renderBatch(batch, "markdown")).not.toContain("- **Budget**:");
    });
  });

  it("renders a review-only row as an outlier rather than a bare 0%", () => {
    const reviewed = aggregate(
      [
        {
          file: "C:\\traces\\one.jsonl",
          report: {
            ...report,
            evalResults: [
              { ...report.evalResults[0]!, outcome: "needs-review", findings: [] },
            ],
            summary: {
              total: 1,
              pass: 0,
              fail: 0,
              error: 0,
              needsReview: 1,
              skipped: 0,
              passRate: 1,
            },
          },
        },
      ],
      { durationMs: 1 },
    );
    expect(renderBatch(reviewed, "markdown")).toContain("review: one.jsonl");
    expect(renderBatch(reviewed, "human")).toContain("review: one.jsonl");
  });

  it("says nothing was graded rather than printing 0% for an all-skipped row", () => {
    const skipped = aggregate(
      [
        {
          file: "C:\\traces\\one.jsonl",
          report: {
            ...report,
            evalResults: [
              {
                ...report.evalResults[0]!,
                outcome: "skipped",
                skipReason: "judge cost budget exhausted ($1)",
                findings: [],
              },
            ],
            summary: {
              total: 1,
              pass: 0,
              fail: 0,
              error: 0,
              needsReview: 0,
              skipped: 1,
              passRate: 1,
            },
            exitCode: 0,
          },
        },
      ],
      { durationMs: 1 },
    );
    const row = skipped.evals[0]!;
    expect(row.passRate).toBeNull();
    expect(row.skipReasons).toEqual(["judge cost budget exhausted ($1)"]);
    // An exhausted budget has to be visible in the report, not inferable from
    // a missing row — it is the difference between "held" and "never checked".
    expect(renderBatch(skipped, "human")).toContain("budget exhausted");
    expect(renderBatch(skipped, "human")).toContain("—");
  });

  it("escapes pipes so an aggregate row keeps its column count", () => {
    const piped = aggregate(
      [
        {
          file: "C:\\traces\\one.jsonl",
          report: {
            ...report,
            evalResults: [
              { ...report.evalResults[0]!, evalName: "weird|name", findings: [] },
            ],
          },
        },
      ],
      { durationMs: 1 },
    );
    const out = renderBatch(piped, "markdown");
    const header = out.split("\n").find((l) => l.startsWith("| Rate | Artifact"))!;
    const row = out.split("\n").find((l) => l.includes("weird"))!;
    const cells = (line: string) => line.split(/(?<!\\)\|/).length - 2;
    expect(cells(row)).toBe(cells(header));
  });
});

/* -------------------------------------------------------------------------- *
 * Calibration rendering (ADR 01022)
 *
 * A calibration report answers a different question from a verdict report, so
 * the assertions are about *that* question: the two mistakes lead, every count
 * has the rows behind it, and a sweep says out loud that it cost nothing.
 * -------------------------------------------------------------------------- */

const emptyBatch: BatchReport = {
  traces: [],
  artifacts: [],
  evals: [],
  summary: {
    total: 0,
    pass: 0,
    fail: 0,
    error: 0,
    needsReview: 0,
    skipped: 0,
    passRate: 1,
    traces: 2,
    tracesPassed: 2,
    tracesFailed: 0,
    tracesErrored: 0,
  },
  warnings: [],
  exitCode: 0,
  costUsd: 0.02,
  durationMs: 10,
};

const calibrationCounts = (
  overrides: Partial<CalibrationReport["counts"]> = {},
): CalibrationReport["counts"] => ({
  labels: 6,
  scored: 5,
  agree: 3,
  falsePass: 1,
  falseFail: 1,
  review: 0,
  missedReview: 0,
  errored: 0,
  skipped: 1,
  reviewVolume: 2,
  insufficient: 0,
  agreement: 0.6,
  ...overrides,
});

const calibration: CalibrationReport = {
  labelsFile: "C:\\work\\demo\\tracevals\\labels.yaml",
  corpus: ["C:\\traces\\a.jsonl", "C:\\traces\\b.jsonl"],
  setting: { ensembleRuns: 3, zones: { autoPass: 0.8, autoFail: 0.8 } },
  counts: calibrationCounts(),
  disagreements: [
    {
      trace: "C:\\traces\\a.jsonl",
      artifactType: "project-rules",
      artifactName: "AGENTS.md",
      evalName: "eval-1",
      grader: "ai",
      expected: "fail",
      actual: "pass",
      kind: "false-pass",
      note: "Sprawled across four | packages",
      consensus: {
        votes: { pass: 3, fail: 0, partial: 0, error: 0 },
        agreement: 1,
        meanConfidence: 0.95,
        runs: 3,
      },
    },
    {
      trace: "C:\\traces\\a.jsonl",
      artifactType: "skill",
      artifactName: "fix-bug",
      evalName: "forbidden-tool",
      grader: "tool-usage",
      expected: "pass",
      actual: "fail",
      kind: "false-fail",
    },
  ],
  unscored: [
    {
      trace: "C:\\traces\\b.jsonl",
      artifactType: "project-rules",
      artifactName: "CLAUDE.md",
      evalName: "docs-work",
      grader: "skill-invoked",
      expected: "pass",
      actual: "skipped",
      kind: "skipped",
      skipReason: "trigger not met",
    },
  ],
  sweep: [
    {
      axis: "baseline",
      value: 3,
      setting: { ensembleRuns: 3, zones: { autoPass: 0.8, autoFail: 0.8 } },
      counts: calibrationCounts(),
    },
    {
      axis: "zones.autoPass",
      value: 0.95,
      setting: { ensembleRuns: 3, zones: { autoPass: 0.95, autoFail: 0.8 } },
      counts: calibrationCounts({ falsePass: 0, review: 1, reviewVolume: 4 }),
    },
  ],
  gates: [{ name: "falsePass", limit: 0, actual: 1, exceeded: true }],
  batch: emptyBatch,
  warnings: ["1 unparseable JSONL line(s) were skipped"],
  exitCode: 1,
  costUsd: 0.02,
  durationMs: 12,
};

/** Split rendered output into lines, so a table header can be found by name. */
const lines = (text: string): string[] => text.split(/\r?\n/);

describe("calibration reporters", () => {
  it("leads with the two mistakes and the review volume, not a pass rate", () => {
    const text = renderCalibration(calibration, "human");
    expect(text).toContain("Agreement 3/5 (60%)");
    expect(text).toMatch(/1\s+false passes/);
    expect(text).toMatch(/1\s+false fails/);
    expect(text).toMatch(/2\s+needs-review/);
  });

  it("names the eval behind each count and carries its note", () => {
    const text = renderCalibration(calibration, "human");
    expect(text).toContain("AGENTS.md › eval-1");
    expect(text).toContain("Sprawled across four | packages");
    // The arithmetic travels with a judged disagreement.
    expect(text).toContain("3p/0f/0?/0e over 3 run(s), confidence 0.95");
    // A deterministic one has none to show, and does not invent any.
    expect(text).toContain("fix-bug › forbidden-tool");
  });

  it("keeps the unscored rows visible and apart from disagreement", () => {
    const text = renderCalibration(calibration, "human");
    expect(text).toContain("Unscored (no evidence either way)");
    expect(text).toContain("trigger not met");
  });

  it("says a sweep cost nothing extra, and shows every cell", () => {
    const text = renderCalibration(calibration, "human");
    expect(text).toContain("no further model calls");
    expect(text).toContain("runs=3 autoPass=0.95 autoFail=0.8");
  });

  /**
   * A sweep row is a claim about a setting, and a claim with no denominator is
   * unreadable: two false passes out of two scored and two out of two hundred
   * are different findings. `insufficient` is the other half — a cell scored
   * from too few cached runs is a number that was quietly not measured.
   */
  it("shows the denominator behind every sweep row, and what it could not score", () => {
    const text = renderCalibration(calibration, "human");
    const header = lines(text).find(
      (l) => l.includes("axis") && l.includes("false-pass"),
    )!;
    expect(header).toContain("scored");
    expect(header).toContain("insuff");
    const baseline = lines(text).find((l) =>
      l.trimStart().startsWith("baseline"),
    )!;
    // scored 5, agree 3 — the same pair the headline reports as 3/5.
    expect(baseline).toMatch(/\b5\b/);
  });

  it("markdown names the same two columns", () => {
    const md = renderCalibration(calibration, "markdown");
    const header = lines(md).find((l) => l.startsWith("| Axis |"))!;
    expect(header).toContain("Scored");
    expect(header).toContain("Insufficient");
    const row = lines(md).find((l) => l.startsWith("| baseline |"))!;
    const cells = (line: string) => line.split(/(?<!\\)\|/).length - 2;
    expect(cells(row)).toBe(cells(header));
  });

  it("a run that scored nothing does not read as measured cleanly", () => {
    const vacuous: CalibrationReport = {
      ...calibration,
      counts: calibrationCounts({
        labels: 2,
        scored: 0,
        agree: 0,
        falsePass: 0,
        falseFail: 0,
        skipped: 2,
        reviewVolume: 0,
        agreement: null,
      }),
      disagreements: [],
      gates: [{ name: "falsePass", limit: 0, actual: 0, exceeded: false }],
      warnings: ["no labelled eval produced evidence: 2 label(s)"],
      exitCode: 1,
    };
    for (const format of ["human", "markdown"] as const) {
      const text = renderCalibration(vacuous, format);
      expect(text).not.toContain("Measured cleanly");
      expect(text).toContain("nothing was scored");
    }
  });

  it("reports a threshold that was exceeded", () => {
    expect(renderCalibration(calibration, "human")).toContain(
      "falsePass: 1 of at most 0",
    );
  });

  it("escapes pipes so a markdown row keeps its column count", () => {
    const md = renderCalibration(calibration, "markdown");
    const header = md
      .split("\n")
      .find((l) => l.startsWith("| Kind | Trace"))!;
    const row = md.split("\n").find((l) => l.startsWith("| FALSE-PASS"))!;
    const cells = (line: string) => line.split(/(?<!\\)\|/).length - 2;
    expect(cells(row)).toBe(cells(header));
    expect(md).toContain("Sprawled across four \\| packages");
  });

  it("renders every format, and json is a faithful round-trip", () => {
    expect(JSON.parse(renderCalibration(calibration, "json"))).toEqual(
      JSON.parse(JSON.stringify(calibration)),
    );
    expect(renderCalibration(calibration, "markdown")).toContain(
      "# manni tracevals calibration report",
    );
  });
});
