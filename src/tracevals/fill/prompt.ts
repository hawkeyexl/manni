/**
 * Fill prompt: asks the provider to extract evals that an artifact's
 * own instructions already imply, each with a self-reported 0-1 confidence.
 * Gating happens downstream; the prompt only demands honesty and restraint.
 *
 * Instructions too vague to test are reported under `needsSharpening` rather
 * than turned into a soft assertion — an untestable instruction is a defect in
 * the artifact, and naming it is more useful than papering over it.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ArtifactType, ResolvedArtifact } from "../artifacts/types.js";
import { ALLOWED_GRADERS } from "./gate.js";
import type { ArtifactFacts } from "./facts.js";

/**
 * Part of the cache key: bump whenever the prompt or schema changes.
 *
 * A prompt edit that leaves this alone makes every cached proposal replay the
 * *old* prompt output, silently, for as long as the cache lives.
 * `test/unit/fill-prompt.test.ts` pins this to a digest of the prompt surface
 * so the pair has to move together.
 *
 * 3 — added the `slash-command` type guidance (ADR 01023).
 */
export const FILL_PROMPT_VERSION = 3;

export const MAX_BODY_CHARS = 6000;

/** What each artifact type's instructions look like, in its own vocabulary. */
const TYPE_GUIDANCE: Record<ArtifactType, string> = {
  skill: [
    "This artifact is a skill: a procedure an agent follows on demand.",
    "Its testable claims are entry criteria (what must be true before starting),",
    "process steps (what must actually happen), and output specifications (what",
    "the result must contain or must never contain).",
  ].join("\n"),
  "slash-command": [
    "This artifact is a slash command: a procedure whose body is injected as a",
    "prompt when a person types its name. Its testable claims are the steps it",
    "mandates, the tools it permits or forbids, and the artifact it must leave",
    "behind. Its `argument-hint` and `description` are harness metadata, not",
    "assertions — do not test them.",
  ].join("\n"),
  agent: [
    "This artifact is an agent definition: a role with boundaries.",
    "Its testable claims are constraints (what the agent must never do),",
    "quality criteria (measurable standards its output must meet), and",
    "escalation rules (conditions under which it must stop and hand off).",
    "Its identity and persona are framing, not assertions — do not test them.",
  ].join("\n"),
  "project-rules": [
    "This artifact is a project rules file: standing rules for all work in the",
    "repository. Its testable claims are process gates, quality gates, approval",
    "requirements, and hard limits. These files are assertion-dense; prefer the",
    "rules stated plainly over anything you would have to infer.",
  ].join("\n"),
};

const GRADER_GUIDANCE: Record<string, string> = {
  ai: "judgment a human would have to read the session to make",
  "tool-usage": "a named tool was or was not used (options: tool, expect, min, max)",
  "skill-invoked": "a named skill was or was not invoked (options: skill, expect)",
  "file-access":
    "a file was or was not read/written/edited (options: path, op, expect)",
  regex:
    "a pattern does or does not appear in session text (options: pattern, flags, on, expect)",
};

export function systemPromptFor(artifactType: ArtifactType): string {
  const allowed = ALLOWED_GRADERS[artifactType];
  return [
    "You extract evals from an AI agent instruction artifact.",
    "",
    TYPE_GUIDANCE[artifactType],
    "",
    "An eval is a durable claim about how a session behaved, graded against",
    "a recorded session trace on every future run. You are extracting claims the",
    "artifact already makes — not inventing new policy for it.",
    "",
    "Rules for every eval you propose:",
    "- It must be decidable as a binary pass or fail against session evidence.",
    "  If you cannot say precisely what would make it fail, it does not qualify.",
    "- Quote the artifact's own intent. Never assert incidental phrasing,",
    "  formatting, or wording that is expected to change.",
    "- Prefer a deterministic grader whenever the claim can be checked",
    "  mechanically; fall back to `ai` only for genuine judgment.",
    "- Ids are short kebab-case identifiers, unique within the artifact.",
    "- Provide examples.pass and examples.fail: one sentence each describing a",
    "  session that satisfies or violates the eval.",
    "- Report an honest confidence between 0 and 1 that the criterion is",
    "  correct, checkable, and worth guarding. Do not inflate it.",
    "- Do not restate evals the artifact already declares.",
    "- Propose at most the requested number, fewer when the artifact offers",
    "  little worth guarding, and none at all when nothing qualifies.",
    "",
    "Graders available for this artifact type:",
    ...allowed.map((kind) => `- ${kind}: ${GRADER_GUIDANCE[kind] ?? ""}`),
    "",
    "Deterministic graders only work against targets that really exist. Use tool",
    "and skill names exactly as given below; if the name you want is not listed,",
    "use the `ai` grader instead of guessing.",
    "",
    "Finally, list under `needsSharpening` any instruction in the artifact that",
    "sounds like a requirement but cannot be tested as written — an undefined",
    "quality bar, an unmeasurable adjective, a rule with no observable outcome.",
    "Say what makes it untestable. Do not invent a criterion to cover it.",
  ].join("\n");
}

export const PROPOSAL_SCHEMA = {
  type: "object",
  required: ["evals"],
  additionalProperties: false,
  properties: {
    evals: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "assertion", "grader", "examples", "confidence"],
        additionalProperties: false,
        properties: {
          name: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
          assertion: { type: "string", minLength: 1 },
          grader: { type: "string" },
          options: { type: "object" },
          evidence: { type: "string" },
          examples: {
            type: "object",
            required: ["pass", "fail"],
            additionalProperties: false,
            properties: {
              pass: { type: "string" },
              fail: { type: "string" },
            },
          },
          severity: { enum: ["error", "warning", "info"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
        },
      },
    },
    needsSharpening: {
      type: "array",
      items: {
        type: "object",
        required: ["instruction", "reason"],
        additionalProperties: false,
        properties: {
          instruction: { type: "string" },
          reason: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true });
const validateProposal = ajv.compile(
  PROPOSAL_SCHEMA as unknown as Record<string, unknown>,
);

export function isValidProposal(value: unknown): boolean {
  return validateProposal(value);
}

export interface FillUserOptions {
  artifact: ResolvedArtifact;
  existingNames: string[];
  maxEvals: number;
  facts: ArtifactFacts;
  /** Skill names discovered in the same scan — the vocabulary for skill-invoked. */
  knownSkills: string[];
}

export function buildFillUser(options: FillUserOptions): string {
  const { artifact, existingNames, maxEvals, facts, knownSkills } = options;
  const body =
    artifact.content.length > MAX_BODY_CHARS
      ? `${artifact.content.slice(0, MAX_BODY_CHARS)}\n…(truncated)`
      : artifact.content;

  const lines = [
    "# Artifact",
    `path: ${artifact.path}`,
    `type: ${artifact.type}`,
    `name: ${facts.name ?? artifact.name}`,
  ];
  if (facts.description !== undefined) {
    lines.push(`description: ${facts.description}`);
  }
  lines.push(
    "",
    "# Existing evals (do not restate these)",
    existingNames.length > 0 ? existingNames.join(", ") : "(none)",
    "",
    "# Tools this artifact grants itself",
    facts.declaredTools.length > 0 ? facts.declaredTools.join(", ") : "(none declared)",
    "",
    "# Skills that exist in this project",
    knownSkills.length > 0 ? knownSkills.join(", ") : "(none)",
    "",
    "# Maximum evals to propose",
    String(maxEvals),
    "",
    "# Artifact content",
    "",
    body,
  );
  return lines.join("\n");
}
