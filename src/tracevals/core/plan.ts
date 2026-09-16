/**
 * Eval planning: turn resolved artifacts + extracted evals into a flat list of
 * evals to run. Artifacts without declared evals get one implicit
 * whole-artifact adherence eval (ADR 01002).
 */
import type { ResolvedArtifact } from "../artifacts/types.js";
import {
  extractEvals,
  type EvalEntry,
  type Severity,
} from "../evals/extract.js";
import type { TraceTarget } from "./target.js";

export interface EvalPlan {
  artifact: ResolvedArtifact;
  evalName: string;
  /** Absent on graders whose options say everything (artifact-evals proposal.2). */
  assertion?: string;
  /** "ai", "human", "command", or a deterministic grader kind. */
  grader: string;
  options?: Record<string, unknown>;
  severity: Severity;
  evidence?: string;
  examples?: EvalEntry["examples"];
  /** Overrides the configured judge provider for this eval only. */
  provider?: string;
  /** Overrides the judge model for this eval only; a CLI --model still wins. */
  model?: string;
  /** Ensemble runs for this eval only; a CLI --runs still wins. */
  runs?: number;
  /** Which bytes the grader receives. Absent means the whole transcript. */
  target?: TraceTarget;
  /**
   * Relative contribution to the run's pass rate. Defaults to 1, which is what
   * makes weighting inert until someone asks for it.
   */
  weight?: number;
  /** Command-graded evals: argv, with `{trace}` substituted at grade time. */
  command?: string[];
  successExitCodes?: number[];
  timeoutMs?: number;
  /** sha256 of `assertion` when the check script was generated. */
  generatedAssertionHash?: string;
  /**
   * Models that proposed this assertion, from `metadata.eval-provenance`.
   * A judge whose model appears here is grading a criterion it wrote.
   */
  proposedBy?: string[];
  /** True for the zero-config whole-artifact adherence eval. */
  implicit: boolean;
  /** Set when the artifact's evals block failed schema validation. */
  error?: string;
  /** Set when the artifact or the entry opted out. */
  skipped?: boolean;
  /** Why it was skipped, when it was. */
  skipReason?: string;
}

export const IMPLICIT_EVAL_NAME = "adheres-to-artifact";

export async function planEvals(
  artifacts: ResolvedArtifact[],
): Promise<EvalPlan[]> {
  const plans: EvalPlan[] = [];
  for (const artifact of artifacts) {
    const extracted = await extractEvals(artifact);

    if (extracted.errors.length > 0) {
      const detail = extracted.errors
        .map(
          (e) =>
            `${e.instancePath || "/"}${e.line !== undefined ? ` (line ${e.line})` : ""}: ${e.message}`,
        )
        .join("; ");
      plans.push({
        artifact,
        evalName: "evals-block-valid",
        assertion: "The artifact's metadata.evals block matches the schema.",
        grader: "ai",
        severity: "error",
        implicit: false,
        error: `invalid metadata.evals block: ${detail}`,
      });
      continue;
    }

    if (extracted.skip) {
      plans.push({
        artifact,
        evalName: IMPLICIT_EVAL_NAME,
        assertion: "Artifact skipped via metadata.eval-skip.",
        grader: "ai",
        severity: "error",
        implicit: true,
        skipped: true,
        skipReason: "artifact skipped via metadata.eval-skip",
      });
      continue;
    }

    if (extracted.evals.length === 0) {
      plans.push({
        artifact,
        evalName: IMPLICIT_EVAL_NAME,
        assertion:
          `The session adhered to the instructions in this ${artifact.type} ` +
          `("${artifact.name}"). Cite the specific instructions followed or violated.`,
        grader: "ai",
        severity: "error",
        implicit: true,
      });
      continue;
    }

    for (const entry of extracted.evals) {
      const plan: EvalPlan = {
        artifact,
        evalName: entry.id,
        assertion: entry.assertion,
        grader: entry.grader,
        ...(entry.model !== undefined ? { model: entry.model } : {}),
        ...(entry.runs !== undefined ? { runs: entry.runs } : {}),
        ...(entry.target !== undefined ? { target: entry.target } : {}),
        ...(entry.weight !== undefined ? { weight: entry.weight } : {}),
        severity: entry.severity,
        implicit: false,
      };
      if (entry.options) plan.options = entry.options;
      if (entry.evidence) plan.evidence = entry.evidence;
      if (entry.examples) plan.examples = entry.examples;
      if (entry.provider) plan.provider = entry.provider;
      if (entry.command) plan.command = entry.command;
      if (entry.successExitCodes) plan.successExitCodes = entry.successExitCodes;
      if (entry.timeoutMs !== undefined) plan.timeoutMs = entry.timeoutMs;
      if (entry.generatedAssertionHash !== undefined) {
        plan.generatedAssertionHash = entry.generatedAssertionHash;
      }
      const proposedBy = extracted.proposedBy.get(entry.id);
      if (proposedBy !== undefined && proposedBy.length > 0) {
        plan.proposedBy = proposedBy;
      }
      if (entry.skip) {
        plan.skipped = true;
        plan.skipReason = "eval skipped via its own skip: true";
      }
      plans.push(plan);
    }
  }
  return plans;
}
