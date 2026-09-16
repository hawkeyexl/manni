/**
 * Static facts an artifact states about itself in structured frontmatter the
 * host tool already treats as schema — an agent's `tools:` grant, a skill's
 * `name`/`description`.
 *
 * These are grounding inputs, not evals. Minting an eval directly from
 * them produces evals that cannot fail: a `tools:` list is an allowlist rather
 * than a requirement, and a skill asserting its own invocation is only ever
 * graded in sessions that invoked it (ADR 01005).
 */
import { extractFrontmatter } from "../../meta/index.js";
import type { ResolvedArtifact } from "../artifacts/types.js";

export interface ArtifactFacts {
  name?: string;
  description?: string;
  /** Tools an agent definition grants itself, normalized to a list. */
  declaredTools: string[];
}

/** `tools: Read, Grep` and `tools: [Read, Grep]` are both in the wild. */
function toolList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tool) => tool.trim())
      .filter((tool) => tool.length > 0);
  }
  return [];
}

export function artifactFacts(artifact: ResolvedArtifact): ArtifactFacts {
  try {
    const { data } = extractFrontmatter(artifact.content, "markdown");
    const facts: ArtifactFacts = { declaredTools: toolList(data?.tools) };
    if (typeof data?.name === "string") facts.name = data.name;
    if (typeof data?.description === "string") {
      facts.description = data.description;
    }
    return facts;
  } catch {
    // Malformed frontmatter yields no facts; discovery already reported it.
    // This runs during vocabulary building, outside any per-artifact handler,
    // so it must not throw.
    return { declaredTools: [] };
  }
}
