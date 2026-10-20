/**
 * SARIF 2.1.0 reporter.
 *
 * `github` annotates a pull request and nothing else: the annotations live on
 * one check run and scroll away with it. SARIF is what a code-scanning
 * dashboard ingests, so findings become a queryable history — which finding,
 * on which line, first seen when, still open or not.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 *   - **URIs are repo-relative and forward-slashed.** An absolute path, or a
 *     Windows path with backslashes, uploads successfully and then matches no
 *     file, so every finding lands on nothing.
 *   - **Every reported rule is declared** in `tool.driver.rules`. A dashboard
 *     showing a bare `regex/found` with no name or description is the
 *     difference between a finding someone acts on and one they dismiss.
 */
import type { EngineReport } from "../core/engine.js";
import { FIX_GUIDE, type EvalResult, type Finding, type Severity } from "../types.js";
import { declaringEntry } from "./location.js";
import { judgedLines, resultGuidance } from "./judged.js";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json";

/** SARIF has three levels; `notice` is `note`, not a dropped finding. */
function levelFor(severity: Severity): "error" | "warning" | "note" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "notice":
      return "note";
  }
}

/** Repo-relative, forward-slashed — what a code-scanning host can resolve. */
function uriFor(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * A finding's rule id.
 *
 * `tool:regex` supplies its own (`regex/found`); `command` and
 * the judge do not, so the eval name stands in. Either way a result must carry
 * *some* stable id, or the dashboard groups every finding under one heading.
 */
function ruleIdFor(finding: Finding): string {
  return finding.ruleId ?? finding.evalName;
}

/**
 * The entry that declares an eval, as a SARIF physical location. SARIF regions
 * are 1-based and `startLine` is required once a region is present, so an
 * entry with no line has no region rather than an invented line 1.
 */
function entryLocation(result: EvalResult): unknown {
  const entry = declaringEntry(result);
  return {
    artifactLocation: { uri: uriFor(entry.file) },
    ...(entry.line !== undefined ? { region: { startLine: entry.line } } : {}),
  };
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri: string;
  defaultConfiguration: { level: "error" | "warning" | "note" };
}

/**
 * The `tool:regex` rules, which mean the same thing whichever eval reports
 * them. Each is named for itself, so its name does not depend on which eval
 * happened to report it first.
 */
const STATIC_RULES: Record<string, { short: string; full: string }> = {
  "regex/found": {
    short: "Text the eval forbids is present",
    full: "The page contains text an eval forbids. The line is the first match.",
  },
  "regex/not-found": {
    short: "Text the eval asks for is missing",
    full: "The page lacks text an eval asks for.",
  },
  "regex/count": {
    short: "Text matches a different number of times",
    full: "The page matches an eval's pattern a different number of times than the eval asks. The line is the first match.",
  },
  "regex/unreadable-target": {
    short: "The eval's target cannot be read",
    full: "The file an eval reads cannot be read. The eval is at fault, not the page.",
  },
};

export function renderSarif(report: EngineReport): string {
  const rules = new Map<string, SarifRule>();
  const results: unknown[] = [];

  /** Declares a rule the first time it is reported. */
  const declare = (
    id: string,
    evalName: string,
    grader: string,
    level: SarifRule["defaultConfiguration"]["level"],
  ): void => {
    if (rules.has(id)) return;
    const fixed = STATIC_RULES[id];
    rules.set(id, {
      id,
      name: fixed === undefined ? evalName : id,
      shortDescription: {
        text: fixed?.short ?? `manni docevals eval "${evalName}" (${grader})`,
      },
      ...(fixed === undefined ? {} : { fullDescription: { text: fixed.full } }),
      helpUri: FIX_GUIDE,
      defaultConfiguration: { level },
    });
  };

  for (const evalResult of report.evalResults) {
    const guidance = resultGuidance(evalResult);
    // The lines a reader sees, and the object a machine reads, on every
    // result this eval reports.
    const message = (lines: string[]) => ({ text: [...lines, ...guidance].join("\n") });
    const properties =
      evalResult.guidance == null ? {} : { properties: { guidance: evalResult.guidance } };

    for (const finding of evalResult.findings ?? []) {
      const id = ruleIdFor(finding);
      const level = levelFor(finding.severity);
      declare(id, finding.evalName, evalResult.grader, level);
      results.push({
        ruleId: id,
        level,
        message: message([finding.message]),
        locations: [
          {
            // A finding with a content line keeps it. One without lands on
            // the entry that declares the eval.
            physicalLocation:
              finding.line != null
                ? {
                    artifactLocation: { uri: uriFor(finding.file) },
                    region: {
                      startLine: finding.line,
                      ...(finding.col != null ? { startColumn: finding.col } : {}),
                    },
                  }
                : entryLocation(evalResult),
          },
        ],
        ...properties,
      });
    }

    // An errored eval has neither findings nor consensus. Leaving it out
    // shows it on the dashboard as never having run, which reads as "all
    // clear" at the moment something actually went wrong.
    if (evalResult.outcome === "error") {
      const id = evalResult.evalName;
      declare(id, evalResult.evalName, evalResult.grader, "error");
      results.push({
        ruleId: id,
        level: "error",
        message: message([evalResult.skipReason ?? "eval errored"]),
        locations: [{ physicalLocation: entryLocation(evalResult) }],
        ...properties,
      });
    }

    // A judged eval produces no `Finding`; without this its failure is absent
    // from the dashboard entirely, which reads as "the AI evals all passed".
    // An eval awaiting review is a warning, so the run that fails on it under
    // --fail-on-review says why.
    const judged = judgedLines(evalResult);
    if (judged.length > 0) {
      const id = evalResult.evalName;
      const level = evalResult.outcome === "fail" ? "error" : "warning";
      declare(
        id,
        evalResult.evalName,
        evalResult.grader === "ai" ? "AI judge" : evalResult.grader,
        level,
      );
      results.push({
        ruleId: id,
        level,
        message: message(judged),
        locations: [{ physicalLocation: entryLocation(evalResult) }],
        ...properties,
      });
    }
  }

  const log = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "manni-docevals",
            informationUri: "https://hawkeyexl.github.io/manni/docevals/",
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
