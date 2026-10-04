/**
 * JUnit XML — what CI systems parse for the "Tests" tab.
 *
 * There is no authoritative JUnit schema; Jenkins, GitLab, CircleCI, and Azure
 * each accept a different superset. This writer sticks to the attributes all of
 * them honor (`name`, `tests`, `failures`, `errors`, `classname`, `type`,
 * `message`) and avoids the contested ones — `time`, which would be meaningless
 * here, `system-out`, and nested suites. That is a compatibility judgement, not
 * a specification.
 *
 * **One `<testcase>` per file, one `<failure>` per violation.** So the tab reads
 * "2 tests, 1 failed" and matches `2 files checked, 1 failed`.
 * Violation-as-testcase would make the test count rise and fall with document
 * quality, which reads as a suite someone broke.
 *
 * **A warning is not a `<failure>`.** JUnit has no level below failure, and a
 * `<failure>` that did not fail the run would make the tab disagree with the
 * exit code. A warning-only file is a passing testcase; the warning is still
 * in the JSON and SARIF output, which have somewhere to put it.
 *
 * Escaping is the one thing a hand-rolled writer gets wrong. Messages carry
 * schema-authored text — a `pattern` regex may hold `<`, `&`, and quotes — and
 * paths can hold `&`. Every attribute value goes through `xmlEscape`; nothing
 * is interpolated raw.
 */
import type { FingerprintContext } from "../core/baseline.js";
import { isErrorSeverity, type ValidationResult } from "../types.js";
import { fieldLabel, ruleIdFor } from "./rule-id.js";
import { xmlEscape } from "../../shared/xml.js";

export { xmlEscape };

/** Suite and classname. One suite per run; nested suites are not portable. */
const SUITE_NAME = "manni";
const CLASS_NAME = "manni.validate";

const attr = (name: string, value: string): string =>
  ` ${name}="${xmlEscape(value)}"`;

export interface JunitOptions {
  /**
   * The `classname` each `<testcase>` carries: which docmeta command produced
   * these findings. Defaults to `docmeta.validate`, the only producer before
   * proposal 0026 made `query --check` a second one — whose findings must not
   * ship under validate's name.
   */
  classname?: string;
  /**
   * The run's path frame, used only to canonicalize a local-file schema ref in
   * `<failure type>`.
   *
   * Without it the attribute carries the ref exactly as the run received it —
   * `./my.schema.json` from the repo root, `../my.schema.json` from a
   * subdirectory, or a machine-absolute path once config discovery has rebased
   * it. SARIF's `ruleId` is already canonical, so a consumer correlating the two
   * for one run would find them disagreeing on the same violation.
   */
  frame?: FingerprintContext;
}

export function renderJunit(
  results: ValidationResult[],
  opts: JunitOptions = {},
): string {
  const tests = results.length;
  const failures = results.filter((r) => r.errors.some(isErrorSeverity)).length;

  const counts =
    attr("name", SUITE_NAME) +
    attr("tests", String(tests)) +
    attr("failures", String(failures)) +
    // Every violation is a `<failure>`; `errors` is reserved for a test that
    // could not run, which has no analogue here. Emitted as 0 rather than
    // omitted, because consumers read the attribute and show a blank column
    // without it.
    attr("errors", "0");

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites${counts}>`,
    `  <testsuite${counts}>`,
  ];

  const classname = opts.classname ?? CLASS_NAME;
  for (const r of results) {
    const open = `    <testcase${attr("name", r.file)}${attr("classname", classname)}`;
    const failing = r.errors.filter(isErrorSeverity);
    if (failing.length === 0) {
      // Self-closing: a passing test has nothing to carry.
      lines.push(`${open}/>`);
      continue;
    }
    lines.push(`${open}>`);
    for (const e of failing) {
      const where =
        e.file != null
          ? ` (${e.file}${e.line != null ? `:${e.line}` : ""})`
          : e.line != null
            ? ` (line ${e.line})`
            : "";
      lines.push(
        `      <failure${attr("type", ruleIdFor(e, opts.frame))}${attr(
          "message",
          `${fieldLabel(e.instancePath)} ${e.message}${where}`,
        )}/>`,
      );
    }
    lines.push("    </testcase>");
  }

  lines.push("  </testsuite>", "</testsuites>");
  return lines.join("\n");
}
