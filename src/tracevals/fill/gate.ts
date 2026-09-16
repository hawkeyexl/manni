/**
 * Proposal gate: everything between "the model said so" and "this is written
 * to a file the user maintains".
 *
 * Self-reported confidence is a weak signal on its own, so it is the *last*
 * filter, not the only one. Mechanical checks run first — grader scope, the
 * grader's own option validation (ADR 01004), and whether the target the
 * eval targets actually exist in the project.
 */
import { graderFor } from "../graders/registry.js";
import type { ArtifactType } from "../artifacts/types.js";
import type { Severity } from "../evals/extract.js";

export interface ProposedEval {
  name: string;
  assertion: string;
  grader: string;
  options?: Record<string, unknown>;
  evidence?: string;
  examples: { pass: string; fail: string };
  severity?: Severity;
  confidence: number;
  rationale?: string;
}

export type RejectionReason =
  | "low-confidence"
  | "invalid-options"
  | "grader-not-allowed"
  | "ungrounded-target"
  | "duplicate-name";

export interface Rejection {
  proposal: ProposedEval;
  reason: RejectionReason;
  detail?: string;
}

export interface Vocabulary {
  /** Tool names the project can actually produce in a trace. */
  tools: Set<string>;
  /** Skill names discovered in the same scan. */
  skills: Set<string>;
}

export interface GateOptions {
  artifactType: ArtifactType;
  threshold: number;
  existingNames: string[];
  maxEvals: number;
  vocabulary: Vocabulary;
}

export interface GateResult {
  accepted: ProposedEval[];
  rejected: Rejection[];
  /** Survivors dropped for exceeding the per-artifact cap, most confident first. */
  capped: ProposedEval[];
}

/**
 * Which graders may be proposed for each artifact type.
 *
 * `cost`, `turn-count`, and `json-output` are whole-session graders: a budget
 * declared inside one skill silently constrains the entire session and
 * double-counts when several artifacts declare it. `skill-invoked` is excluded
 * from skills, slash commands, and agents because an eval asserting its own
 * artifact was used can only be graded in sessions that used it — permanently
 * green.
 *
 * A slash command carries the skill list unchanged: both are an injected
 * procedure graded over the span they governed (ADR 01023), so the same
 * graders make sense and the same whole-session ones do not.
 */
export const ALLOWED_GRADERS: Record<ArtifactType, readonly string[]> = {
  skill: ["ai", "tool-usage", "file-access", "regex"],
  "slash-command": ["ai", "tool-usage", "file-access", "regex"],
  agent: ["ai", "tool-usage", "file-access"],
  "project-rules": ["ai", "skill-invoked", "tool-usage"],
};

/** Absolute paths are machine-specific; file-access matches on a suffix. */
function isAbsoluteish(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Does the eval name something that can exist in a trace? Rejects
 * hallucinated tool names and skills, however confident the model claims to be.
 */
function groundingError(
  proposal: ProposedEval,
  vocabulary: Vocabulary,
): string | undefined {
  const options = proposal.options ?? {};
  if (proposal.grader === "tool-usage") {
    const tool = options.tool;
    // MCP tools are named at connect time, so they cannot be enumerated ahead
    // of a session; the prefix is the only available signal.
    if (
      typeof tool === "string" &&
      !tool.startsWith("mcp__") &&
      !vocabulary.tools.has(tool)
    ) {
      return `no tool named "${tool}" is available in this project`;
    }
  }
  if (proposal.grader === "skill-invoked") {
    const skill = options.skill;
    if (typeof skill === "string" && !vocabulary.skills.has(skill)) {
      return `no skill named "${skill}" was found in this project`;
    }
  }
  if (proposal.grader === "file-access") {
    const path = options.path;
    if (typeof path === "string" && isAbsoluteish(path)) {
      return `options.path must be a repository-relative suffix, not "${path}"`;
    }
  }
  return undefined;
}

/**
 * An eval in an agent definition describes what the *subagent* did, and
 * subagent tool calls are recorded as sidechain calls — which tool-usage
 * excludes by default. Left alone, such an eval silently measures the
 * main thread instead.
 */
function normalize(
  proposal: ProposedEval,
  artifactType: ArtifactType,
): ProposedEval {
  if (artifactType !== "agent" || proposal.grader !== "tool-usage") {
    return proposal;
  }
  return {
    ...proposal,
    options: { ...(proposal.options ?? {}), includeSidechains: true },
  };
}

export function gateProposals(
  proposals: ProposedEval[],
  options: GateOptions,
): GateResult {
  const { artifactType, threshold, maxEvals, vocabulary } = options;
  const allowed = new Set(ALLOWED_GRADERS[artifactType]);
  const taken = new Set(options.existingNames);
  const rejected: Rejection[] = [];
  const survivors: ProposedEval[] = [];

  for (const raw of proposals) {
    // Names first: a duplicate is rejected on its own terms rather than
    // competing for a slot under the cap.
    if (taken.has(raw.name)) {
      rejected.push({ proposal: raw, reason: "duplicate-name" });
      continue;
    }
    if (!allowed.has(raw.grader)) {
      rejected.push({
        proposal: raw,
        reason: "grader-not-allowed",
        detail: `${raw.grader} may not be declared on a ${artifactType} artifact`,
      });
      continue;
    }

    const proposal = normalize(raw, artifactType);

    if (proposal.grader !== "ai") {
      const grader = graderFor(proposal.grader);
      const validate = grader?.validateOptions;
      if (validate === undefined) {
        // Without a ground-check there is no way to know the options are
        // usable, and an unusable eval errors on every future run.
        rejected.push({
          proposal,
          reason: "invalid-options",
          detail: `grader ${proposal.grader} cannot validate its options`,
        });
        continue;
      }
      const invalid = validate(proposal.options ?? {});
      if (invalid !== undefined) {
        rejected.push({ proposal, reason: "invalid-options", detail: invalid });
        continue;
      }
      const ungrounded = groundingError(proposal, vocabulary);
      if (ungrounded !== undefined) {
        rejected.push({
          proposal,
          reason: "ungrounded-target",
          detail: ungrounded,
        });
        continue;
      }
    }

    taken.add(proposal.name);
    survivors.push(proposal);
  }

  // Confidence last, then the cap — so the cap drops the least confident of
  // the evals that were otherwise acceptable, and the two reasons stay
  // distinguishable in the report.
  const confident: ProposedEval[] = [];
  for (const proposal of survivors) {
    if (proposal.confidence >= threshold) confident.push(proposal);
    else rejected.push({ proposal, reason: "low-confidence" });
  }
  confident.sort((a, b) => b.confidence - a.confidence);

  return {
    accepted: confident.slice(0, maxEvals),
    capped: confident.slice(maxEvals),
    rejected,
  };
}
