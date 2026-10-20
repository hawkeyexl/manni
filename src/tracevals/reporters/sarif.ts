/**
 * SARIF 2.1.0 reporter.
 *
 * docevals' shape: one run, every reported rule declared in
 * `tool.driver.rules`, findings at error/warning/note, a judged failure and an
 * errored eval reported rather than left to read as "all clear", and a review
 * queue as a warning.
 *
 * Two things are tracevals' own:
 *
 *   - **Rules are graders.** The id is `tracevals/<grader>`, so a dashboard
 *     groups by what checked the session (`tracevals/tool-usage`,
 *     `tracevals/ai`); the eval's own name is in `properties.eval`.
 *   - **Locations are declaring entries, often outside the checkout.** A
 *     finding points at the entry that declares the eval, in the skill or
 *     instruction file or in the manifest that supplied it, with its line as
 *     the region. Under the run root that is a relative URI against `SRCROOT`.
 *     A user-level skill in `~/.claude` gets an absolute `file:` URI, since no
 *     relative one reaches it, and a hosted manifest keeps its URL. The trace
 *     graded is `properties.trace`.
 */
import type { Severity } from "../../shared/severity.js";
import { guidanceLines } from "../../shared/guidance.js";
import {
  artifactLocation,
  fileUri,
  URI_BASE_ID,
  type ArtifactLocation,
} from "../../shared/sarif-location.js";
import { classifyRef } from "../../meta/index.js";
import { TRIAGE_GUIDE, type EvalResult, type RunReport } from "../types.js";
import {
  displayPath,
  errorText,
  judgedLines,
  locationPath,
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
  fullDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration: { level: SarifLevel };
}

/** Where a built-in grader's rule sends the reader. */

/** What each built-in grader checks. A plugin grader's rule carries none. */
const GRADER_DESCRIPTIONS = new Map<string, string>([
  ["tool-usage", "Checks whether the session used a tool, and how often."],
  ["tool-order", "Checks that the session used one tool before another."],
  ["skill-invoked", "Checks whether the session invoked a skill."],
  ["file-access", "Checks whether the session read, wrote or edited a file."],
  ["turn-count", "Checks that the session's turn count stays within its bounds."],
  ["cost", "Checks that the session's recorded cost and tokens stay within their limits."],
  ["regex", "Checks whether a pattern matches the session's text."],
  ["json-output", "Checks that the session's final output is JSON that matches a schema."],
  ["command", "Runs a command over the session and checks its exit code."],
  ["ai", "The AI judge reads the session against the eval's assertion."],
  ["human", "A person reads the session against the eval's assertion and decides."],
]);

/** The declaring file as a SARIF artifact location. A hosted manifest is its URL. */
function declaringLocation(r: EvalResult, root: string): ArtifactLocation {
  if (classifyRef(r.location.file).kind === "url") return { uri: r.location.file };
  return artifactLocation(locationPath(r.location, root), root);
}

export function renderSarif(input: CiInput): string {
  const rules = new Map<string, SarifRule>();
  const results: unknown[] = [];

  // The first result filed under a rule sets its default level.
  const declare = (
    id: string,
    name: string,
    text: string,
    level: SarifLevel,
    full?: string,
  ) => {
    if (!rules.has(id)) {
      rules.set(id, {
        id,
        name,
        shortDescription: { text },
        ...(full === undefined
          ? {}
          : { fullDescription: { text: full }, helpUri: TRIAGE_GUIDE }),
        defaultConfiguration: { level },
      });
    }
  };

  const push = (
    run: RunReport,
    r: EvalResult,
    level: SarifLevel,
    lines: string[],
  ) => {
    const id = ruleIdFor(r.grader);
    declare(
      id,
      r.grader,
      r.grader === "ai"
        ? "manni tracevals AI judge"
        : `manni tracevals ${r.grader} grader`,
      level,
      GRADER_DESCRIPTIONS.get(r.grader),
    );
    results.push({
      ruleId: id,
      level,
      message: { text: [...lines, ...guidanceLines(r.guidance)].join("\n") },
      locations: [
        {
          physicalLocation: {
            artifactLocation: declaringLocation(r, input.root),
            // SARIF regions are 1-based and need `startLine`, so a location
            // with no line has no region rather than an invented line 1.
            ...(r.location.line === undefined
              ? {}
              : { region: { startLine: r.location.line } }),
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
        ...(r.guidance == null ? {} : { guidance: r.guidance }),
      },
    });
  };

  for (const run of input.runs) {
    for (const r of run.evalResults) {
      for (const f of r.findings ?? []) {
        push(run, r, LEVELS[f.severity], [f.message]);
      }
      const judged = judgedLines(r);
      if (judged.length > 0) {
        // A review queue is a warning: nobody has decided yet.
        push(run, r, r.outcome === "fail" ? "error" : "warning", judged);
      }
      if (r.outcome === "error") push(run, r, "error", [errorText(r)]);
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
