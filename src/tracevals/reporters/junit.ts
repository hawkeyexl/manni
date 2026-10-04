/**
 * JUnit XML reporter.
 *
 * docevals' mapping, with the trace standing where docevals' eval suite
 * stands: one `<testsuite>` per trace, one `<testcase>` per (artifact, eval)
 * pair. `classname` is the artifact and `name` is the eval, so a JUnit viewer
 * groups by the file someone edits to change the outcome. Each `<failure>` and
 * `<error>` carries its rule, `tracevals/<grader>`, as `type`.
 *
 * A trace a batch could not read at all is a suite of one errored testcase, so
 * the CI test tab counts it rather than showing a corpus one trace short.
 */
import { xmlEscape as esc } from "../../shared/xml.js";
import type { EvalResult, RunReport } from "../types.js";
import {
  displayPath,
  errorText,
  judgeFailText,
  locationPath,
  ruleIdFor,
  TRACE_RULE_ID,
  type CiInput,
} from "./ci.js";

function attr(name: string, value: string | number): string {
  return `${name}="${esc(String(value))}"`;
}

const seconds = (ms: number): string => (ms / 1000).toFixed(3);

/** The message body for a failing eval: findings, or the judge's reasoning. */
function failureText(result: EvalResult): string {
  const findings = (result.findings ?? []).map((f) => f.message);
  if (findings.length > 0) return findings.join("\n");
  return judgeFailText(result) ?? `${result.evalName} failed`;
}

function testcase(result: EvalResult, root: string): string {
  // `file` and `line` are the entry that declares the eval, the attributes a
  // JUnit viewer that links to source reads.
  const line = result.location.line;
  const open = `    <testcase ${attr("classname", displayPath(result.artifact, root))} ${attr(
    "name",
    result.evalName,
  )} ${attr("file", locationPath(result.location, root))}${
    line === undefined ? "" : ` ${attr("line", line)}`
  } ${attr("time", seconds(result.durationMs))}`;
  const type = attr("type", ruleIdFor(result.grader));
  switch (result.outcome) {
    case "pass":
      return `${open} />`;
    case "skipped":
      return `${open}>\n      <skipped ${attr(
        "message",
        result.skipReason ?? "skipped",
      )} />\n    </testcase>`;
    case "error":
      return `${open}>\n      <error ${attr(
        "message",
        `${result.evalName} errored`,
      )} ${type}>${esc(errorText(result))}</error>\n    </testcase>`;
    case "needs-review":
      // Not a failure and not a pass. JUnit has no third state, and calling it
      // a failure would make a human-review queue look like a broken build.
      return `${open}>\n      <skipped ${attr(
        "message",
        "needs human review",
      )} />\n    </testcase>`;
    case "fail":
      return `${open}>\n      <failure ${attr(
        "message",
        `${result.evalName} failed`,
      )} ${type}>${esc(failureText(result))}</failure>\n    </testcase>`;
  }
}

interface Counts {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
}

function counts(run: RunReport): Counts {
  const r = run.evalResults;
  return {
    tests: r.length,
    failures: r.filter((x) => x.outcome === "fail").length,
    errors: r.filter((x) => x.outcome === "error").length,
    skipped: r.filter((x) => x.outcome === "skipped" || x.outcome === "needs-review")
      .length,
  };
}

function suiteOpen(name: string, c: Counts, ms: number): string {
  return `  <testsuite ${attr("name", name)} ${attr("tests", c.tests)} ${attr(
    "failures",
    c.failures,
  )} ${attr("errors", c.errors)} ${attr("skipped", c.skipped)} ${attr(
    "time",
    seconds(ms),
  )}>`;
}

export function renderJunit(input: CiInput): string {
  const total: Counts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const suites: string[] = [];

  for (const run of input.runs) {
    const c = counts(run);
    total.tests += c.tests;
    total.failures += c.failures;
    total.errors += c.errors;
    suites.push(
      [
        suiteOpen(displayPath(run.trace.file, input.root), c, run.durationMs),
        ...run.evalResults.map((r) => testcase(r, input.root)),
        "  </testsuite>",
      ].join("\n"),
    );
  }

  for (const t of input.traceErrors) {
    total.tests += 1;
    total.errors += 1;
    const name = displayPath(t.file, input.root);
    suites.push(
      [
        suiteOpen(name, { tests: 1, failures: 0, errors: 1, skipped: 0 }, t.durationMs),
        `    <testcase ${attr("classname", name)} ${attr("name", "trace")} ${attr(
          "time",
          seconds(t.durationMs),
        )}>`,
        `      <error ${attr("message", "trace could not be evaluated")} ${attr(
          "type",
          TRACE_RULE_ID,
        )}>${esc(t.error)}</error>`,
        "    </testcase>",
        "  </testsuite>",
      ].join("\n"),
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites ${attr("name", "manni-tracevals")} ${attr("tests", total.tests)} ${attr(
      "failures",
      total.failures,
    )} ${attr("errors", total.errors)}>`,
    ...suites,
    "</testsuites>",
    "",
  ].join("\n");
}
