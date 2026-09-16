/**
 * The set of targets a proposed deterministic criterion may name. Anything
 * outside it is a hallucination that would produce a criterion which can never
 * pass, so the gate rejects it regardless of the model's stated confidence.
 */
import type { DiscoveredArtifact } from "../artifacts/discover.js";
import { artifactFacts } from "./facts.js";
import type { Vocabulary } from "./gate.js";

/**
 * Tools Claude Code exposes by default. Project-specific additions arrive via
 * agent `tools:` grants; MCP tools are recognized by their `mcp__` prefix in
 * the gate rather than enumerated here.
 */
export const BUILTIN_TOOLS = [
  "Agent",
  "AskUserQuestion",
  "Bash",
  "BashOutput",
  "Edit",
  "ExitPlanMode",
  "Glob",
  "Grep",
  "KillShell",
  "NotebookEdit",
  "Read",
  "Skill",
  "SlashCommand",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "Write",
] as const;

/** Build the vocabulary from everything the scan found. */
export function buildVocabulary(artifacts: DiscoveredArtifact[]): Vocabulary {
  const tools = new Set<string>(BUILTIN_TOOLS);
  const skills = new Set<string>();

  for (const discovered of artifacts) {
    if (discovered.artifact.type === "skill") {
      skills.add(discovered.artifact.name);
    }
    for (const tool of artifactFacts(discovered.artifact).declaredTools) {
      tools.add(tool);
    }
  }
  return { tools, skills };
}
