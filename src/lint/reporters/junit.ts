/**
 * JUnit XML, rendered through **meta's** writer rather than a second one.
 *
 * There is no authoritative JUnit schema, and the escaping is the part a
 * hand-rolled writer gets wrong - XML 1.0 forbids characters that sit quite
 * happily in a JavaScript string, and one of them makes the whole document
 * unparseable rather than merely mis-rendered. That work is done once, in
 * `src/meta/reporters/junit.ts`, and cite already rides it. So does lint:
 * adapt the run onto meta's `ValidationResult`, hand it to that writer, and
 * the family ships one XML writer, one escaping rule, and one
 * testcase-per-file convention.
 *
 * What is lint's is the two strings that identify the findings as lint's:
 * the `classname` on every `<testcase>`, and the `<failure type>`, which is
 * the namespaced rule id.
 */
import {
  isErrorSeverity,
  renderJunit as renderJunitXml,
  type FieldError,
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
 * The files this run actually checked, as meta's results.
 *
 * The skipped ones are **not** here, and that is the one place this reporter
 * parts company with the others. A skip has to be reported, or a file nothing
 * looked at is indistinguishable from a file that passed - so pretty says so
 * in words and SARIF files a `toolExecutionNotification`. JUnit has neither:
 * meta's writer emits a testcase or a testcase with a failure, so a skipped
 * file can only arrive as a green test. That is worse than absent. It claims a
 * pass on evidence nobody gathered, and it puts the suite's `tests` count three
 * above the `2 files checked, 3 skipped` the same run prints.
 *
 * So the count here is the run's `checked`, by construction: one testcase per
 * file that was linted.
 */
export function toValidationResults(run: LintRun): ValidationResult[] {
  return run.results
    .filter((result) => result.skipped == null)
    .map((result) => ({
      file: result.file,
      // meta's `format` is the extractor that read the file. A lint result does
      // not carry the parser that produced its tree, and no reporter reached
      // through here reads the field, so it names the domain rather than
      // inventing a format the run never recorded.
      format: "lint",
      // meta's invariant, not a count: `ok` is "no error-severity finding".
      // Read as "no findings at all", a file whose only finding is a warning
      // renders as a `✗` through meta's own pretty reporter - which is a
      // legitimate consumer, since this function is exported - while lint's
      // exit code says the run passed.
      ok: !result.findings.some(isErrorSeverity),
      schemas: [RULE_ID_PREFIX],
      errors: result.findings.map(toFieldError),
    }));
}

/**
 * Straight to meta's JUnit writer rather than through its `render`, which
 * takes a `RunSummary` its junit branch does not forward. Building one here
 * only to have it dropped read as though the suite's counts came from the run,
 * and they do not: they are the length of the list above and how much of it
 * carries an error-severity finding.
 */
export function renderJunit(run: LintRun): string {
  return renderJunitXml(toValidationResults(run), {
    classname: JUNIT_CLASSNAME,
  });
}
