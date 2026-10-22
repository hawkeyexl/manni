/**
 * Golden-set files and set health (proposal 0087 § 7b), end to end through
 * the built CLI. `graph.questionFiles` names files of questions that span
 * pages or that the docs don't answer. `graph check` asks them beside each
 * page's own, reports duplicates and copied wording, prints the set's health
 * and can gate on a found rate. Each fixture under
 * test/graph/fixtures/questions/ is one feature.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "dist", "cli.js");
const fixtures = join(root, "test", "graph", "fixtures", "questions");

function run(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [cli, "graph", ...args], { encoding: "utf8", cwd });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

/** A fresh, built copy of one fixture, outside any repository. */
function built(feature: string, config?: (yaml: string) => string): string {
  const cwd = mkdtempSync(join(tmpdir(), `manni-graph-${feature}-`));
  cpSync(join(fixtures, feature), cwd, { recursive: true });
  if (config) {
    const path = join(cwd, "manni.config.yaml");
    writeFileSync(path, config(readFileSync(path, "utf8")));
  }
  const b = run(["build"], cwd);
  expect(b.status, b.stdout + b.stderr).toBe(0);
  return cwd;
}

const threshold = (value: string) => (y: string) =>
  y.replace("      top: 1", `      top: 1\n      foundThreshold: ${value}`);

/**
 * The finding lines of a pretty report, without the summary. These fixtures
 * publish no chunk artifact, so the cited row's notice is left out here, and
 * cited.test.ts covers it.
 */
function findings(stdout: string): string[] {
  return stdout
    .split("\n")
    .filter((l) => /^(error|warning|notice): /.test(l) && !l.includes(CITED_SKIPPED));
}

const CITED_SKIPPED = "the cited row did not run";
/** A JSON report's findings, without the cited row's notice. */
const own = <T extends Record<string, unknown>>(fs: T[]): T[] =>
  fs.filter((f) => !String(f.message).startsWith(CITED_SKIPPED));

/** The health summary of a pretty report: from `questions` to the blank line after it. */
function summary(stdout: string): string[] {
  const lines = stdout.split("\n");
  const start = lines.findIndex((l) => l.startsWith("questions  "));
  if (start < 0) return [];
  const end = lines.indexOf("", start);
  return lines.slice(start, end < 0 ? undefined : end);
}

const DOC = "https://example.com/graph/doc";

describe("a golden-set file question", () => {
  it("must find every answer, each on its own page", () => {
    const r = run(["check"], built("cross-page"));
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(findings(r.stdout)).toEqual([
      'warning: questions.yaml: "After rotating the key, how do I check nothing broke?" does not find docs/rotate.md § Rotate in the top 1 (it ranks 4; first is docs/validate.md § Check the result)',
    ]);
  });

  it("points its finding at the file and line of its item, with no path", () => {
    const report = JSON.parse(run(["check", "-f", "json"], built("cross-page")).stdout) as {
      findings: Record<string, unknown>[];
    };
    expect(own(report.findings)).toEqual([
      {
        severity: "warning",
        message:
          '"After rotating the key, how do I check nothing broke?" does not find docs/rotate.md § Rotate in the top 1 (it ranks 4; first is docs/validate.md § Check the result)',
        focusNode: "questions.yaml:3",
        docs: ["questions.yaml"],
        guidance: null,
      },
    ]);
  });

  it("names an answer page that does not exist, and counts it as not found", () => {
    const r = run(["check"], built("answer-gone"));
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual([
      'warning: questions.yaml: docs/old.md, which holds the answer to "How large may an upload be?", does not exist, so re-pin or remove the question.',
    ]);
    expect(summary(r.stdout)).toContain("  found    0 of 1 reviewed in the top 1 (0%), 0 first (0%)");
  });

  it("is never asked when it has no answers, and is counted as a gap", () => {
    const r = run(["check"], built("gap", threshold("100")));
    expect(r.status, r.stdout).toBe(0);
    expect(findings(r.stdout)).toEqual([]);
    expect(summary(r.stdout)).toEqual([
      "questions  2: 2 reviewed, 0 drafted, on 1 page and in questions.yaml",
      "  found    1 of 1 reviewed in the top 1 (100%), 1 first (100%)",
      "  answers  0 pinned, 0 not reviewed: 0 current, 0 moved, 0 changed; 1 not pinned",
      "  gaps     1 question the docs don't answer",
    ]);
  });
});

describe("a golden-set file that cannot be read", () => {
  it("is an operational error when it is missing", () => {
    const cwd = built("cross-page");
    rmSync(join(cwd, "questions.yaml"));
    const r = run(["check"], cwd);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toBe(
      "manni: graph.questionFiles names questions.yaml, which does not exist. Fix the path, or remove it from graph.questionFiles.",
    );
  });

  it("is an operational error when it fails its schema, in Ajv's words", () => {
    const cwd = built("cross-page");
    writeFileSync(
      join(cwd, "questions.yaml"),
      "- question: Where is it?\n  answers:\n    - file: docs/rotate.md\n",
    );
    const r = run(["check"], cwd);
    expect(r.status).toBe(2);
    expect(r.stderr.trim()).toBe(
      "manni: questions.yaml: /0/answers/0 must have required property 'lines'.",
    );
  });
});

describe("set health", () => {
  it("reports a question asked twice on each copy after the first, in path order", () => {
    const r = run(["check"], built("duplicate"));
    expect(findings(r.stdout).filter((l) => l.includes("is also asked"))).toEqual([
      'warning: docs/retry.md: "how do I retry a  failed upload" is also asked on docs/limits.md, so keep it where it is answered.',
      'warning: questions.yaml: "How do I retry a failed upload?" is also asked on docs/limits.md, so keep it where it is answered.',
    ]);
    expect(r.stdout).toContain(
      `answered.\n  at ${DOC}/docs/retry.md graph:sampleQuestion\n`,
    );
    expect(r.stdout).toMatch(/answered\.\n {2}at questions\.yaml:\d+\n/);
  });

  it("reports a question that copies its answer's word pairs, at notice", () => {
    const r = run(["check"], built("copied-wording"));
    expect(r.status).toBe(0);
    expect(findings(r.stdout)).toEqual([
      'notice: docs/retry.md: "Do uploads retry three times by default?" repeats 5 of its 6 word pairs from its answer, so it tests matching words more than finding. (drafted, not reviewed)',
    ]);
    expect(r.stdout).toContain(
      `(drafted, not reviewed)\n  at ${DOC}/docs/retry.md graph:sampleQuestion\n`,
    );
    expect(summary(r.stdout)).toEqual([
      "questions  3: 2 reviewed, 1 drafted, on 1 page",
      "  found    2 of 2 reviewed in the top 2 (100%), 1 first (50%)",
      "  drafted  1 of 1 in the top 2, not counted until reviewed",
      "  answers  3 pinned, 1 not reviewed: 3 current, 0 moved, 0 changed; 0 not pinned",
    ]);
  });

  it("prints the summary between the findings and the counts", () => {
    const r = run(["check"], built("cross-page"));
    expect(r.stdout.split("\n")).toEqual([
      'warning: questions.yaml: "After rotating the key, how do I check nothing broke?" does not find docs/rotate.md § Rotate in the top 1 (it ranks 4; first is docs/validate.md § Check the result)',
      "  at questions.yaml:3",
      "notice: (no page): the cited row did not run: no chunk artifact; run manni graph publish.",
      "  at questions",
      "",
      "questions  1: 1 reviewed, 0 drafted, in questions.yaml",
      "  found    0 of 1 reviewed in the top 1 (0%), 0 first (0%)",
      "  answers  2 pinned, 0 not reviewed: 2 current, 0 moved, 0 changed; 0 not pinned",
      "",
      "0 errors, 1 warning, 1 notice",
      "",
    ]);
  });

  it("prints no summary when no question exists", () => {
    const cwd = built("answer-gone");
    writeFileSync(join(cwd, "questions.yaml"), "[]\n");
    const r = run(["check"], cwd);
    expect(r.stdout).not.toContain("questions  ");
    expect(JSON.parse(run(["check", "-f", "json"], cwd).stdout)).not.toHaveProperty("questions");
  });

  it("adds the counts to the JSON report", () => {
    const report = JSON.parse(run(["check", "-f", "json"], built("gap")).stdout) as {
      questions: unknown;
    };
    expect(report.questions).toEqual({
      total: 2,
      reviewed: 2,
      drafted: 0,
      pages: 1,
      files: ["questions.yaml"],
      top: 1,
      found: {
        reviewed: { inTop: 1, first: 1, of: 1 },
        drafted: { inTop: 0, first: 0, of: 0 },
      },
      answers: { pinned: 0, unreviewed: 0, current: 0, moved: 0, changed: 0, unpinned: 1 },
      gaps: 1,
    });
  });

  it("prints the summary after the annotations under -f github", () => {
    const r = run(["check", "-f", "github"], built("cross-page"));
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^::warning file=questions\.yaml::/);
    expect(lines.slice(1)).toEqual([
      "::notice::the cited row did not run: no chunk artifact; run manni graph publish. (questions)",
      "",
      "questions  1: 1 reviewed, 0 drafted, in questions.yaml",
      "  found    0 of 1 reviewed in the top 1 (0%), 0 first (0%)",
      "  answers  2 pinned, 0 not reviewed: 2 current, 0 moved, 0 changed; 0 not pinned",
    ]);
  });
});

describe("graph.check.questions.foundThreshold", () => {
  it("fails the run when the found rate is under it", () => {
    const r = run(["check"], built("cross-page", threshold("98")));
    expect(r.status).toBe(1);
    expect(findings(r.stdout)).toContain(
      "error: (no page): 0 of 1 reviewed questions are found in the top 1 (0%), under the 98% that graph.check.questions.foundThreshold asks for.",
    );
    expect(r.stdout).toContain("asks for.\n  at questions\n");
  });

  it("is not touched by questions.severity", () => {
    const r = run(
      ["check"],
      built("cross-page", (y) =>
        threshold("98")(y).replace("      top: 1", "      top: 1\n      severity: off"),
      ),
    );
    expect(r.status).toBe(1);
    expect(findings(r.stdout)).toEqual([
      "error: (no page): 0 of 1 reviewed questions are found in the top 1 (0%), under the 98% that graph.check.questions.foundThreshold asks for.",
    ]);
  });

  it("passes at or above it", () => {
    expect(run(["check"], built("cross-page", threshold("0"))).status).toBe(0);
  });
});

describe("graph stats: question coverage", () => {
  it("adds sample-questions to the document coverage, and lists concepts with no question", () => {
    const cwd = built("question-coverage");
    const r = run(["stats"], cwd);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/\n {2}sample-questions\s+1\/2\s+50\.0%\n/);
    expect(r.stdout).toContain("Concepts with no question (1):\n  Jitter\n");

    const report = JSON.parse(run(["stats", "-f", "json"], cwd).stdout) as {
      conceptsWithoutQuestions: string[];
    };
    expect(report.conceptsWithoutQuestions).toEqual(["https://example.com/graph/concept/jitter"]);
  });

  it("leaves the concepts list out of a graph with no concepts", () => {
    const r = run(["stats"], built("cross-page"));
    expect(r.stdout).toContain("Concepts:   0");
    expect(r.stdout).not.toContain("Concepts with no question");
  });

  it("gates the row only when the per-field map names it", () => {
    const cwd = built("question-coverage");
    const uniform = JSON.parse(
      run(["stats", "--check", "--coverage-threshold", "60", "-f", "json"], cwd).stdout,
    ) as { coverageFindings: { field: string }[] };
    expect(uniform.coverageFindings.map((f) => f.field)).not.toContain("sample-questions");
    const named = built("question-coverage", (y) =>
      y.replace("graph:\n", "graph:\n  stats:\n    coverageThreshold:\n      sample-questions: 60\n"),
    );
    expect(run(["stats", "--check"], named).status).toBe(1);
  });
});
