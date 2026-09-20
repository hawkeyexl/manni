import { describe, expect, it } from "vitest";
import {
  render,
  renderGithub,
  renderJson,
  renderJunit,
  renderPretty,
  toValidationResults,
  type ReportFormat,
} from "../../../src/lint/reporters/index.js";
import { renderSarif } from "../../../src/lint/reporters/sarif.js";
import {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../../src/shared/github.js";
import type { LintRun } from "../../../src/lint/commands/lint.js";
import { LintError, type Finding } from "../../../src/lint/types.js";

const ESC = String.fromCharCode(27);

function finding(over: Partial<Finding> = {}): Finding {
  return {
    type: "missing_section",
    heading: "Prerequisites",
    message: "Required section is missing",
    position: {
      start: { line: 3, column: 1, offset: 42 },
      end: { line: 3, column: 16, offset: 57 },
    },
    severity: "error",
    ...over,
  };
}

const run: LintRun = {
  results: [
    { file: "ok.md", success: true, findings: [], template: "how-to" },
    {
      file: "bad.md",
      success: false,
      findings: [
        finding(),
        finding({
          type: "paragraph_count",
          heading: "Overview",
          message: "Expected at least 2 paragraphs, found 1",
          position: {
            start: { line: 9, column: 3, offset: 120 },
            end: { line: 11, column: 1, offset: 180 },
          },
        }),
      ],
      template: "how-to",
    },
    {
      file: "guide.xyz",
      success: false,
      findings: [],
      template: null,
      skipped: "unsupported-format",
      reason: `guide.xyz: no parser is registered for ".xyz".`,
    },
  ],
  summary: { checked: 2, passed: 1, failed: 1, skipped: 1 },
};

const cleanRun: LintRun = {
  results: [
    { file: "ok.md", success: true, findings: [], template: "how-to" },
    { file: "also-ok.md", success: true, findings: [], template: "how-to" },
  ],
  summary: { checked: 2, passed: 2, failed: 0, skipped: 0 },
};

/**
 * The JSON reporter is a published contract, not an implementation detail:
 * manni docevals reads it with `JSON.parse` and plain property access, so a
 * renamed key yields zero findings instead of an error. These assertions are
 * deliberately about key names and nesting rather than about values.
 */
describe("json reporter", () => {
  it("emits a bare top-level array, one entry per file", () => {
    const parsed = JSON.parse(renderJson(run));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((r: { file: string }) => r.file)).toEqual([
      "ok.md",
      "bad.md",
      "guide.xyz",
    ]);
  });

  it("uses exactly the file keys { file, success, errors, skipped }", () => {
    const first: object = JSON.parse(renderJson(run))[0];
    expect(Object.keys(first)).toEqual([
      "file",
      "success",
      "errors",
      "skipped",
    ]);
  });

  // The internal field is `findings`. The wire field is `errors`, and has to
  // stay that way.
  it("names the findings array `errors`, never `findings`", () => {
    const parsed = JSON.parse(renderJson(run));
    expect(parsed[1]).toHaveProperty("errors");
    expect(parsed[1]).not.toHaveProperty("findings");
    expect(parsed[1].errors).toHaveLength(2);
  });

  // `type` keeps its place and its spelling. `ruleId`, `tool` and `severity`
  // join it: additive keys are safe, a rename is not.
  it("uses exactly the error keys { type, ruleId, tool, heading, message, position, severity }", () => {
    const error: Record<string, unknown> = JSON.parse(renderJson(run))[1].errors[0];
    expect(Object.keys(error)).toEqual([
      "type",
      "ruleId",
      "tool",
      "heading",
      "message",
      "position",
      "severity",
    ]);
    expect(error.type).toBe("missing_section");
    expect(error.heading).toBe("Prerequisites");
    expect(error.message).toBe("Required section is missing");
  });

  // `severity` is what lets a consumer tell a warning-only file (`success:
  // true` with a non-empty `errors` array) apart from a finding the shape
  // simply forgot to fail on.
  it("carries the finding's severity", () => {
    const error: Record<string, unknown> = JSON.parse(renderJson(run))[1].errors[0];
    expect(error.severity).toBe("error");
  });

  it("carries the namespaced rule id and the tool that produced it", () => {
    const error: Record<string, unknown> = JSON.parse(renderJson(run))[1].errors[0];
    expect(error.ruleId).toBe("manni:lint/structure/missing-section");
    expect(error.tool).toBe("manni");
  });

  it("nests source location as position.start / position.end", () => {
    const error = JSON.parse(renderJson(run))[1].errors[0];
    expect(error.position.start.line).toBe(3);
    expect(error.position.start.column).toBe(1);
    expect(error.position.start.offset).toBe(42);
    expect(error.position.end.line).toBe(3);
    expect(error.position.end.column).toBe(16);
    expect(error.position.end.offset).toBe(57);
  });

  // `{ success: false, errors: [] }` is what a skipped file and a failure
  // whose finding vanished both look like, and a consumer that cannot tell
  // them apart counts a file nothing read as a file that was read and found
  // wanting. `skipped` is additive, so the docevals read path is untouched.
  it("says a skipped file was skipped, and why in one word", () => {
    const skipped = JSON.parse(renderJson(run))[2];
    expect(skipped.file).toBe("guide.xyz");
    expect(skipped.success).toBe(false);
    expect(skipped.errors).toEqual([]);
    expect(skipped.skipped).toBe("unsupported-format");
    // The prose reason stays a diagnostic for the pretty and SARIF reports.
    expect(skipped).not.toHaveProperty("reason");
  });

  // Null rather than absent: a consumer reads `result.skipped` on every entry,
  // and a key that comes and goes makes "not skipped" and "an older manni"
  // the same observation.
  it("says so explicitly when a file was not skipped", () => {
    const parsed = JSON.parse(renderJson(run));
    expect(parsed[0].skipped).toBeNull();
    expect(parsed[1].skipped).toBeNull();
  });

  // Mirrors manni docevals src/graders/tools/doc-structure-lint.ts field for
  // field. If this stops compiling or matching, that grader silently stops
  // reporting.
  it("survives the manni docevals read path", () => {
    interface WireError {
      type?: string;
      heading?: string;
      message?: string;
      position?: { start?: { line?: number; column?: number } };
    }
    const parsed = JSON.parse(renderJson(run)) as { errors?: WireError[] }[];
    const graded = parsed
      .flatMap((result) => result.errors ?? [])
      .map((err) => ({
        ruleId: err.type,
        message: err.heading
          ? `${err.heading}: ${err.message ?? "structure error"}`
          : (err.message ?? "structure error"),
        line: err.position?.start?.line,
        col: err.position?.start?.column,
      }));

    expect(graded).toEqual([
      {
        ruleId: "missing_section",
        message: "Prerequisites: Required section is missing",
        line: 3,
        col: 1,
      },
      {
        ruleId: "paragraph_count",
        message: "Overview: Expected at least 2 paragraphs, found 1",
        line: 9,
        col: 3,
      },
    ]);
  });
});

describe("pretty reporter", () => {
  it("marks every file passing on a clean run and emits no ANSI when color is off", () => {
    const out = renderPretty(cleanRun, { color: false });
    expect(out).toContain("✓ ok.md");
    expect(out).toContain("✓ also-ok.md");
    expect(out).toContain("2 files checked, 2 passed, 0 failed, 0 skipped");
    expect(out).not.toContain("✗");
    expect(out.includes(ESC)).toBe(false);
  });

  it("lists each finding under its file with position and message", () => {
    const out = renderPretty(run, { color: false });
    expect(out).toContain("✗ bad.md");
    expect(out).toContain("3:1");
    // The namespaced id, not the bare `type`: it is what a reader searches
    // for, and what every other reporter files the finding under.
    expect(out).toContain("manni:lint/structure/missing-section");
    expect(out).toContain("Prerequisites: Required section is missing");
    expect(out).toContain("9:3");
    expect(out).toContain("manni:lint/structure/paragraph-count");
    // `checked` counts linted files only; the skipped one is counted apart.
    expect(out).toContain("2 files checked, 1 passed, 1 failed, 1 skipped");
  });

  // A skip that leaves no trace is indistinguishable from a pass.
  it("says which file was skipped and why", () => {
    const out = renderPretty(run, { color: false });
    expect(out).toContain("- guide.xyz");
    expect(out).toContain(`skipped: guide.xyz: no parser is registered for ".xyz".`);
  });

  it("emits ANSI only when color is on", () => {
    expect(renderPretty(run, { color: true }).includes(ESC)).toBe(true);
    expect(renderPretty(run).includes(ESC)).toBe(false);
  });

  // `success` means "no error-severity finding", not "no findings": a file
  // whose only finding is a warning (e.g. `unsupported_content_kind`) still
  // passes, but it is not silent about it either - unlike the old behaviour,
  // where the findings loop was never reached for a `success: true` result.
  describe("a passing file with only a warning", () => {
    const warningRun: LintRun = {
      results: [
        {
          file: "warned.md",
          success: true,
          findings: [
            finding({
              type: "unsupported_content_kind",
              heading: null,
              message: 'The markdown parser does not report tables, so the "no-tables" rule is not checked for this file.',
              severity: "warning",
            }),
          ],
          template: "how-to",
        },
      ],
      summary: { checked: 1, passed: 1, failed: 0, skipped: 0 },
    };

    it("marks the file distinctly from both a pass and a failure", () => {
      const out = renderPretty(warningRun, { color: false });
      expect(out).toContain("⚠ warned.md");
      expect(out).not.toContain("✓ warned.md");
      expect(out).not.toContain("✗ warned.md");
    });

    it("lists the warning under the file, marked as a warning rather than an error", () => {
      const out = renderPretty(warningRun, { color: false });
      expect(out).toContain("manni:lint/structure/unsupported-content-kind");
      expect(out).toContain(
        'warning The markdown parser does not report tables, so the "no-tables" rule is not checked for this file.',
      );
    });

    it("counts the file as passed and names the warning on the summary line", () => {
      const out = renderPretty(warningRun, { color: false });
      expect(out).toContain("1 file checked, 1 passed, 0 failed, 0 skipped, 1 warning");
      // A passing summary stays green: nothing here failed the run.
      expect(out).not.toContain(ESC + "[31m");
    });
  });

  // A file can fail on an error and still carry a warning in the same run -
  // the state cap and `unsupported_content_kind` are independent. Both
  // findings print, each carrying its own severity.
  it("distinguishes a warning from an error on a failing file, and counts only the warning", () => {
    const mixedRun: LintRun = {
      results: [
        {
          file: "mixed.md",
          success: false,
          findings: [
            finding(),
            finding({
              type: "unsupported_content_kind",
              heading: null,
              message: "The markdown parser does not report tables.",
              severity: "warning",
            }),
          ],
          template: "how-to",
        },
      ],
      summary: { checked: 1, passed: 0, failed: 1, skipped: 0 },
    };
    const out = renderPretty(mixedRun, { color: false });
    expect(out).toContain("✗ mixed.md");
    // The error line carries no level word - the `✗` already says so.
    expect(out).toContain("manni:lint/structure/missing-section  Prerequisites: Required section is missing");
    expect(out).toContain(
      "manni:lint/structure/unsupported-content-kind  warning The markdown parser does not report tables.",
    );
    expect(out).toContain("1 file checked, 0 passed, 1 failed, 0 skipped, 1 warning");
  });
});

describe("github reporter", () => {
  /**
   * One finding, so an escaping assertion is about the annotation itself and
   * not about which of several lines it landed on. Anything not overridden
   * matches the shared fixture.
   */
  function annotationFor(over: {
    file?: string;
    message?: string;
    severity?: Finding["severity"];
  }): string {
    const single: LintRun = {
      results: [
        {
          file: over.file ?? "bad.md",
          success: false,
          findings: [
            finding({
              heading: null,
              message: over.message ?? "Required section is missing",
              ...(over.severity === undefined ? {} : { severity: over.severity }),
            }),
          ],
          template: "how-to",
        },
      ],
      summary: { checked: 1, passed: 0, failed: 1, skipped: 0 },
    };
    return renderGithub(single);
  }

  // `title=<ruleId>` rather than a `[type]` prefix inside the message, which
  // is where cite puts it: GitHub renders the title as the alert's heading,
  // and repeating it in the body says the rule's name twice.
  it("emits one annotation per finding, with file, line, col and the rule id as title", () => {
    const out = renderGithub(run);
    expect(out.split("\n")).toEqual([
      "::error file=bad.md,line=3,col=1,title=manni%3Alint/structure/missing-section::Prerequisites: Required section is missing",
      "::error file=bad.md,line=9,col=3,title=manni%3Alint/structure/paragraph-count::Overview: Expected at least 2 paragraphs, found 1",
    ]);
  });

  // The family scale is GitHub's, so the level *is* the severity. Every
  // structural finding is an error today; a warning must not fail the check.
  it("uses the finding's severity as the annotation level", () => {
    const out = annotationFor({ severity: "warning" });
    expect(out.startsWith("::warning ")).toBe(true);
  });

  it("annotates nothing for passing or skipped files", () => {
    expect(renderGithub(run)).not.toContain("ok.md");
    expect(renderGithub(run)).not.toContain("guide.xyz");
    expect(renderGithub(cleanRun)).toBe("");
  });

  // Every absolute path on Windows carries a drive-letter colon. Unescaped, it
  // closes the `::`-terminated property list early, and GitHub drops the
  // annotation instead of attaching it to the file - so the whole `-f github`
  // output is silently useless on a Windows runner.
  it("escapes a colon in the file property so a Windows path still parses", () => {
    const out = annotationFor({ file: "C:\\docs\\a.md" });
    expect(out).toBe(
      "::error file=C%3A\\docs\\a.md,line=3,col=1,title=manni%3Alint/structure/missing-section::Required section is missing",
    );
  });

  // Properties are comma-separated, so a comma inside one splits the path in
  // half and leaves the remainder parsed as a nameless second property.
  it("escapes a comma in the file property so the path stays one property", () => {
    const out = annotationFor({ file: "docs/a,b.md" });
    expect(out).toContain("file=docs/a%2Cb.md,line=3,col=1,title=");
  });

  // A literal `%` is the escape character: left alone it makes GitHub read the
  // next two characters as a hex code and swallow them.
  it("escapes a percent in the message as %25", () => {
    const out = annotationFor({ message: "coverage is 50% of the file" });
    expect(out).toContain("coverage is 50%25 of the file");
  });

  // Percent has to be escaped before the line breaks are. The other order
  // rewrites the `%` of a `%0A` this code just introduced, and the annotation
  // shows a literal `%0A` where the break should be.
  it("escapes a percent before a newline, so the newline escape survives", () => {
    const out = annotationFor({ message: "50%\nof files" });
    expect(out).toContain("50%25%0Aof files");
    expect(out).not.toContain("%250A");
    expect(out).not.toContain("%2525");
  });

  // A raw newline ends the workflow command, so the rest of the message is
  // printed as loose log output and never reaches the annotation.
  it("escapes a newline as %0A and keeps the annotation on one line", () => {
    const out = annotationFor({ message: "first line\nsecond line" });
    expect(out.split("\n")).toHaveLength(1);
    expect(out).toContain("first line%0Asecond line");
  });

  // A bare `\r` is a line break too, and a runner's log treats it as one. The
  // collapse this replaced matched `\r?\n`, which let a lone carriage return
  // through untouched.
  it("escapes a bare carriage return as %0D and keeps the annotation on one line", () => {
    const out = annotationFor({ message: "first line\rsecond line" });
    expect(out).toContain("first line%0Dsecond line");
    expect(out).not.toContain("\r");
    expect(out.split(/\r?\n/)).toHaveLength(1);
  });

  // CRLF has to survive as both halves, in order, or a Windows-authored
  // message loses a character on the way to the annotation.
  it("escapes a CRLF pair as %0D%0A", () => {
    const out = annotationFor({ message: "first line\r\nsecond line" });
    expect(out).toContain("first line%0D%0Asecond line");
  });

  // Through the family's own escapers, not a local pair that happens to agree
  // today. The ordering is the part a second copy re-derives wrong, and a
  // wrong one is invisible until a message carrying a `%` reaches a runner.
  it("escapes through the shared workflow-command rule", () => {
    const file = "C:\\docs\\a,b.md";
    const message = "50%\nof files";
    const out = annotationFor({ file, message });
    expect(out).toContain(`file=${escapeWorkflowCommandProperty(file)}`);
    expect(out.endsWith(`::${escapeWorkflowCommandMessage(message)}`)).toBe(true);
  });
});

/**
 * JUnit rides meta's renderer over adapted results, exactly as cite's does, so
 * the family ships one XML writer and one escaping rule. What is lint's is the
 * classname and the `<failure type>`, which is the namespaced rule id.
 */
describe("junit reporter", () => {
  it("emits one testcase per file and one failure per finding", () => {
    const xml = renderJunit(run);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<testcase name="ok.md" classname="manni.lint"/>');
    expect(xml).toContain('<testcase name="bad.md" classname="manni.lint">');
    expect([...xml.matchAll(/<failure /g)]).toHaveLength(2);
  });

  it("files each failure under the namespaced rule id", () => {
    const xml = renderJunit(run);
    expect(xml).toContain('type="manni:lint/structure/missing-section"');
    expect(xml).toContain('type="manni:lint/structure/paragraph-count"');
  });

  it("names the suite and counts files, not findings", () => {
    const xml = renderJunit(run);
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="1"');
  });

  /**
   * A skipped file is not a passing test.
   *
   * JUnit's only two verdicts here are "testcase" and "testcase with a
   * failure", so a file nothing looked at can only enter the tab as a green
   * one - a pass claimed on evidence that was never gathered, and a `tests`
   * count that disagrees with the `2 files checked, 1 skipped` the same run
   * prints. The skip is still reported everywhere that has somewhere to put
   * it: pretty says so in words, SARIF as a `toolExecutionNotification`.
   */
  it("leaves a skipped file out rather than passing it", () => {
    const xml = renderJunit(run);
    expect(xml).not.toContain("guide.xyz");
    // The counts are the run's own, not the length of the result list.
    expect(xml).toContain('tests="2"');
  });

  it("owes its envelope on a clean run", () => {
    const xml = renderJunit(cleanRun);
    expect(xml).toContain('tests="2"');
    expect(xml).toContain('failures="0"');
    expect(xml).not.toContain("<failure");
  });
});

/**
 * `toValidationResults` is exported, so meta's own renderers are legitimate
 * consumers - and they read `ok` by meta's definition of it, which is about
 * severity and not about whether anything was found.
 */
describe("toValidationResults", () => {
  function runOf(...findings: Finding[]): LintRun {
    return {
      results: [
        { file: "a.md", success: findings.length === 0, findings, template: "how-to" },
      ],
      summary: {
        checked: 1,
        passed: findings.length === 0 ? 1 : 0,
        failed: findings.length === 0 ? 0 : 1,
        skipped: 0,
      },
    };
  }

  // `ok` is "no error-severity finding", not "no findings". Counted the other
  // way, a file whose only finding is a warning renders as a `✗` through
  // meta's pretty reporter while lint's own exit code says the run passed.
  it("calls a file with only warnings ok", () => {
    const [result] = toValidationResults(runOf(finding({ severity: "warning" })));
    expect(result?.ok).toBe(true);
    expect(result?.errors).toHaveLength(1);
  });

  it("calls a file with an error-severity finding not ok", () => {
    const [result] = toValidationResults(runOf(finding({ severity: "error" })));
    expect(result?.ok).toBe(false);
  });

  it("calls a file with no findings ok", () => {
    const [result] = toValidationResults(runOf());
    expect(result?.ok).toBe(true);
  });
});

describe("render", () => {
  it("dispatches on the format and defaults to pretty", () => {
    expect(render(run, "json")).toBe(renderJson(run));
    expect(render(run, "github")).toBe(renderGithub(run));
    expect(render(run, "junit")).toBe(renderJunit(run));
    expect(render(run, "pretty", { color: false })).toBe(
      renderPretty(run, { color: false }),
    );
  });

  // `render` is the entry point a library caller reaches for, and SARIF is the
  // one reporter whose entire output is paths. Without a way to pass `root`
  // through, such a caller was pinned to the process cwd and every URI in the
  // document was silently relative to the wrong directory.
  it("forwards root to the sarif reporter", () => {
    // An absolute path on purpose: `root` is only consulted for one, so a run
    // of relative paths would pass this test without the option travelling.
    const root = process.platform === "win32" ? "C:/repo" : "/repo";
    const absolute: LintRun = {
      ...run,
      results: [
        {
          file: `${root}/docs/a.md`,
          success: false,
          findings: [finding()],
          template: "how-to",
        },
      ],
    };

    expect(render(absolute, "sarif", { root })).toBe(
      renderSarif(absolute, { root }),
    );
    // Proof it travelled: under the run's own root the URI is repo-relative,
    // while under the process cwd the same file is outside the root and falls
    // back to an absolute `file:` URI.
    expect(render(absolute, "sarif", { root })).not.toBe(renderSarif(absolute));
  });

  /**
   * The findings formats are meta's, not lint's. So the day one is added
   * there, `-f <it>` passes the CLI's check - which is meta's `isReportFormat`
   * - and arrives here with no case of its own. Falling through to pretty
   * would hand a machine reader a human report, quietly; the `never` guard
   * makes the addition a compile error, and this is its runtime half.
   */
  it("refuses a format it has no case for, rather than rendering pretty", () => {
    const unknown = "toml" as ReportFormat;
    expect(() => render(run, unknown)).toThrow(LintError);
    expect(() => render(run, unknown)).toThrow(/toml/);
  });
});
