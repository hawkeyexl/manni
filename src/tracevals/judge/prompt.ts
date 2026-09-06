/**
 * Judge prompts. PROMPT_VERSION is part of the cache key — bump it on ANY
 * change to the prompts in this file, or stale cached verdicts survive the
 * revision.
 */
import type { EvalPlan } from "../core/plan.js";

export const PROMPT_VERSION = 3;

export const JUDGE_SYSTEM_PROMPT = `You are an adherence judge for AI agent sessions. You are given some evidence from an agent session and one assertion drawn from the instructions the session was operating under — a skill definition, an agent definition, or project rules.

The evidence is whatever the eval asked to be graded, and its heading says which: usually the session transcript (messages, tool calls, skills used), but it may instead be the session's final message, the list of files it touched, the instruction artifact itself, or one named file. Judge the assertion against what you were actually given.

Decide whether the session adhered to the assertion:
- "pass" only when the session fully satisfied it.
- "partial" when it partly satisfied it.
- "fail" when it violated it or plainly did not do it.

Ground every judgment in the graded content: quote or cite the specific part of it — a message, a tool call, a line, or a telling omission — that supports your verdict in the "observed" field. If the assertion concerns something the graded content cannot show (e.g. events outside what you were given), say so and lower your confidence.

Respond with a single JSON object matching the provided schema. No prose outside the JSON.`;

/**
 * Cap for the artifact excerpt included alongside the assertion.
 *
 * The prompt says when it truncates, so the judge knows it is reading part of
 * an artifact. What was missing is the *reader* knowing: a verdict formed
 * without sight of an artifact's second half looked identical in every report
 * to one formed with it. `artifactWasTruncated` lets the engine say so.
 */
export const MAX_ARTIFACT_CHARS = 8_000;

/** Whether this artifact will be cut before the judge sees it. */
export function artifactWasTruncated(content: string): boolean {
  return content.length > MAX_ARTIFACT_CHARS;
}

export function buildUserContent(
  plan: EvalPlan,
  graded: string,
  targetLabel = "transcript",
): string {
  const parts: string[] = [];
  parts.push(`# Assertion\n${plan.assertion ?? ""}`);
  if (plan.evidence) {
    parts.push(`# Where to look\n${plan.evidence}`);
  }
  if (plan.examples?.pass?.length) {
    parts.push(`# Examples of passing behavior\n- ${plan.examples.pass.join("\n- ")}`);
  }
  if (plan.examples?.fail?.length) {
    parts.push(`# Examples of failing behavior\n- ${plan.examples.fail.join("\n- ")}`);
  }
  let artifactBody = plan.artifact.content;
  if (artifactBody.length > MAX_ARTIFACT_CHARS) {
    artifactBody = `${artifactBody.slice(0, MAX_ARTIFACT_CHARS)}\n[... artifact truncated ...]`;
  }

  // `target: artifact` makes the source and the graded content the same bytes.
  // Sending them twice under two headings costs tokens and invites the judge
  // to treat them as two documents to reconcile — and it defeats the
  // truncation cap, because the copy under "graded content" is not cut.
  const gradingTheArtifact = targetLabel === "artifact";
  const artifactHeading = `${plan.artifact.type} ("${plan.artifact.name}")`;
  if (!gradingTheArtifact) {
    parts.push(`# Source ${artifactHeading}\n${artifactBody}`);
  }

  // Name what the judge is looking at. Told "session transcript" while being
  // handed a written file or a final assistant message, a judge reasons about
  // the wrong thing and says so confidently.
  parts.push(
    targetLabel === "transcript"
      ? `# Session transcript\n${graded}`
      : gradingTheArtifact
        ? `# Graded content: the ${artifactHeading} itself\n${artifactBody}`
        : `# Graded content (${targetLabel})\n${graded}`,
  );
  return parts.join("\n\n");
}
