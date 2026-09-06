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
 *     showing a bare `freshness/stale` with no name or description is the
 *     difference between a finding someone acts on and one they dismiss.
 */
import type { EngineReport } from "../core/engine.js";
import type { Finding, Severity } from "../types.js";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json";

/** SARIF has three levels; `info` is `note`, not a dropped finding. */
function levelFor(severity: Severity): "error" | "warning" | "note" {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
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
 * Tool graders supply their own (`MD013`, `Vale.Spelling`); native ones and
 * the judge do not, so the eval name stands in. Either way a result must carry
 * *some* stable id, or the dashboard groups every finding under one heading.
 */
function ruleIdFor(finding: Finding): string {
  return finding.ruleId ?? finding.evalName;
}

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: "error" | "warning" | "note" };
}

export function renderSarif(report: EngineReport): string {
  const rules = new Map<string, SarifRule>();
  const results: unknown[] = [];

  for (const evalResult of report.evalResults) {
    for (const finding of evalResult.findings ?? []) {
      const id = ruleIdFor(finding);
      const level = levelFor(finding.severity);
      if (!rules.has(id)) {
        rules.set(id, {
          id,
          name: finding.evalName,
          shortDescription: {
            text: `manni docevals eval "${finding.evalName}" (${evalResult.grader})`,
          },
          defaultConfiguration: { level },
        });
      }
      results.push({
        ruleId: id,
        level,
        message: { text: finding.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: uriFor(finding.file) },
              // SARIF regions are 1-based and `startLine` is required once a
              // region is present, so omit the region entirely rather than
              // inventing line 1 for a whole-file finding.
              ...(finding.line != null
                ? {
                    region: {
                      startLine: finding.line,
                      ...(finding.col != null ? { startColumn: finding.col } : {}),
                    },
                  }
                : {}),
            },
          },
        ],
      });
    }

    // An errored eval has neither findings nor consensus. Leaving it out
    // shows it on the dashboard as never having run, which reads as "all
    // clear" at the moment something actually went wrong.
    if (evalResult.outcome === "error") {
      const id = evalResult.evalName;
      if (!rules.has(id)) {
        rules.set(id, {
          id,
          name: evalResult.evalName,
          shortDescription: {
            text: `manni docevals eval "${evalResult.evalName}" (${evalResult.grader})`,
          },
          defaultConfiguration: { level: "error" },
        });
      }
      results.push({
        ruleId: id,
        level: "error",
        message: { text: evalResult.skipReason ?? "eval errored" },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: uriFor(evalResult.file) },
            },
          },
        ],
      });
    }

    // A judged eval produces no `Finding`; without this its failure is absent
    // from the dashboard entirely, which reads as "the AI evals all passed".
    if (evalResult.outcome === "fail" && evalResult.consensus) {
      const id = evalResult.evalName;
      if (!rules.has(id)) {
        rules.set(id, {
          id,
          name: evalResult.evalName,
          shortDescription: {
            text: `manni docevals eval "${evalResult.evalName}" (AI judge)`,
          },
          defaultConfiguration: { level: "error" },
        });
      }
      const reasoning =
        evalResult.consensus.runs.find((r) => r.verdict)?.verdict?.reasoning ??
        "";
      results.push({
        ruleId: id,
        level: "error",
        message: {
          text: `AI judge: fail (confidence ${evalResult.consensus.meanConfidence.toFixed(2)}). ${reasoning}`.trim(),
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: uriFor(evalResult.file) },
            },
          },
        ],
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
            informationUri: "https://hawkeyexl.github.io/manni docevals/",
            rules: [...rules.values()],
          },
        },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
