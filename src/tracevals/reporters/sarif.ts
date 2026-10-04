/**
 * SARIF 2.1.0 reporter.
 *
 * docevals' shape: one run, every reported rule declared in
 * `tool.driver.rules`, findings at error/warning/note, a judged failure and an
 * errored eval reported rather than left to read as "all clear".
 *
 * Two things are tracevals' own:
 *
 *   - **Rules are graders.** The id is `tracevals/<grader>`, so a dashboard
 *     groups by what checked the session (`tracevals/tool-usage`,
 *     `tracevals/ai`); the eval's own name is in `properties.eval`.
 *   - **Locations are artifacts, often outside the checkout.** A finding
 *     points at the skill or instruction file that declared the eval. Under
 *     the run root that is a relative URI against `SRCROOT`; a user-level
 *     skill in `~/.claude` gets an absolute `file:` URI, since no relative one
 *     reaches it. The trace graded is `properties.trace`.
 */
import type { Severity } from "../../shared/severity.js";
import {
  artifactLocation,
  fileUri,
  URI_BASE_ID,
} from "../../shared/sarif-location.js";
import type { EvalResult, RunReport } from "../types.js";
import {
  displayPath,
  errorText,
  judgeFailText,
  ruleIdFor,
  TRACE_RULE_ID,
  traceErrorText,
  type CiInput,
} from "./ci.js";

const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json";

type SarifLevel = "error" | "warning" | "note";

/** SARIF has three levels; `notice` is `note`, not a dropped finding. */
const LEVELS: Record<Severity, SarifLevel> = {
  error: "error",
  warning: "warning",
  notice: "note",
};

interface SarifRule {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: SarifLevel };
}

export function renderSarif(input: CiInput): string {
  const rules = new Map<string, SarifRule>();
  const results: unknown[] = [];

  const declare = (id: string, name: string, text: string, level: SarifLevel) => {
    if (!rules.has(id)) {
      rules.set(id, {
        id,
        name,
        shortDescription: { text },
        defaultConfiguration: { level },
      });
    }
  };

  const push = (
    run: RunReport,
    r: EvalResult,
    level: SarifLevel,
    text: string,
  ) => {
    const id = ruleIdFor(r.grader);
    declare(
      id,
      r.grader,
      r.grader === "ai"
        ? "manni tracevals AI judge"
        : `manni tracevals ${r.grader} grader`,
      level,
    );
    results.push({
      ruleId: id,
      level,
      message: { text },
      locations: [
        {
          physicalLocation: {
            artifactLocation: artifactLocation(r.artifact, input.root),
          },
        },
      ],
      properties: {
        eval: r.evalName,
        artifactName: r.artifactName,
        artifactType: r.artifactType,
        trace: displayPath(run.trace.file, input.root),
        ...(run.trace.sessionId !== undefined
          ? { sessionId: run.trace.sessionId }
          : {}),
      },
    });
  };

  for (const run of input.runs) {
    for (const r of run.evalResults) {
      for (const f of r.findings ?? []) {
        push(run, r, LEVELS[f.severity], f.message);
      }
      const judged = judgeFailText(r);
      if (judged !== undefined) push(run, r, "error", judged);
      if (r.outcome === "error") push(run, r, "error", errorText(r));
    }
  }

  for (const t of input.traceErrors) {
    declare(TRACE_RULE_ID, "trace", "manni tracevals could not read the trace", "error");
    results.push({
      ruleId: TRACE_RULE_ID,
      level: "error",
      message: { text: traceErrorText(t.error) },
      locations: [
        {
          physicalLocation: {
            artifactLocation: artifactLocation(t.file, input.root),
          },
        },
      ],
    });
  }

  const log = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "manni-tracevals",
            informationUri: "https://hawkeyexl.github.io/manni/tracevals/",
            rules: [...rules.values()],
          },
        },
        originalUriBaseIds: { [URI_BASE_ID]: { uri: fileUri(input.root) } },
        results,
      },
    ],
  };
  return `${JSON.stringify(log, null, 2)}\n`;
}
