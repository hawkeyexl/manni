/**
 * JUnit XML, rendered through **meta's** writer rather than a second one.
 *
 * There is no authoritative JUnit schema, and the escaping is the part a
 * hand-rolled writer gets wrong - XML 1.0 forbids characters that sit quite
 * happily in a JavaScript string, and one of them makes the whole document
 * unparseable rather than merely mis-rendered. That work is done once, in
 * `src/meta/reporters/junit.ts`, and cite already rides it. So does lint:
 * adapt the run onto meta's `ValidationResult`, hand it to `render`, and the
 * family ships one XML writer, one escaping rule, and one testcase-per-file
 * convention.
 *
 * What is lint's is the two strings that identify the findings as lint's:
 * the `classname` on every `<testcase>`, and the `<failure type>`, which is
 * the namespaced rule id.
 */
import {
  render,
  type FieldError,
  type RunSummary,
  type ValidationResult,
} from "../../meta/index.js";
import { RULE_ID_PREFIX, ruleName, STRUCTURE_JOB } from "../core/rule-id.js";
import type { LintRun } from "../commands/lint.js";

/** JUnit `classname` for this tool's findings, as cite's is `manni.cite`. */
const JUNIT_CLASSNAME = "manni.lint";

/**
 * One finding as a `FieldError`.
 *
 * `schema` and `keyword` are split where they are because meta's `ruleIdFor`
 * joins them with a `/`, and the id it has to produce is
 * `manni:lint/<job>/<rule>`. The prefix is the schema half and stays one
 * segment, which is what keeps it a built-in-shaped ref: a ref containing a
 * slash classifies as a local file, and a caller that passed a path frame
 * would see it rewritten into a relative path. The job and the rule travel
 * together as the keyword.
 *
 * `instancePath` is `""`, the whole document. A structural finding is about a
 * document's shape and not about a pointer into its metadata, so there is no
 * honest pointer to give; meta spells that `(root)`, as it does for its own
 * parse failures. The section the finding is anchored to is already in the
 * message.
 */
function toFieldError(
  finding: LintRun["results"][number]["findings"][number],
): FieldError {
  return {
    schema: RULE_ID_PREFIX,
    instancePath: "",
    message:
      finding.heading != null
        ? `${finding.heading}: ${finding.message}`
        : finding.message,
    keyword: `${STRUCTURE_JOB}/${ruleName(finding.type)}`,
    severity: finding.severity,
    line: finding.position.start.line,
    col: finding.position.start.column,
  };
}

/**
 * The run as meta's results. Every file the run touched becomes one, the
 * skipped ones included: a file that leaves no trace in the report is
 * indistinguishable from a file that passed, which is the failure this whole
 * reporter set exists to prevent. A skipped file carries no findings, so it
 * renders as a passing testcase - present, and not claimed as failing.
 */
export function toValidationResults(run: LintRun): ValidationResult[] {
  return run.results.map((result) => ({
    file: result.file,
    // meta's `format` is the extractor that read the file. A lint result does
    // not carry the parser that produced its tree, and no reporter reached
    // through here reads the field, so it names the domain rather than
    // inventing a format the run never recorded.
    format: "lint",
    ok: result.findings.length === 0,
    schemas: [RULE_ID_PREFIX],
    errors: result.findings.map(toFieldError),
  }));
}

/** The counts meta's renderers take beside the results. */
function summaryOf(run: LintRun): RunSummary {
  const { checked, passed, failed } = run.summary;
  return {
    files: checked,
    passed,
    failed,
    errors: run.results.reduce(
      (n, result) =>
        n + result.findings.filter((f) => f.severity === "error").length,
      0,
    ),
  };
}

export function renderJunit(run: LintRun): string {
  return render("junit", toValidationResults(run), summaryOf(run), {
    classname: JUNIT_CLASSNAME,
  });
}
