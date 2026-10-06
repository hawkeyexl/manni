/**
 * Rule extraction prompt: asks the provider to read ONE rule-source file and
 * return only the directives a session transcript could show followed or
 * broken (proposal 0079, "Only files that govern an agent").
 *
 * The whole file goes in, uncapped. A cache keyed on slices would rarely hit,
 * and a partial read would let the agent off for sentences it never saw.
 */
import { Ajv2020 } from "ajv/dist/2020.js";

/**
 * Part of the cache key: bump whenever the prompt or schema changes.
 *
 * A prompt edit that leaves this alone makes every cached extraction replay the
 * *old* prompt's output, silently, for as long as the cache lives.
 * `test/tracevals/unit/rules-prompt.test.ts` pins this to a digest of the
 * prompt surface so the pair has to move together.
 */
export const RULES_PROMPT_VERSION = 2;

export const RULES_SYSTEM_PROMPT = [
  "You extract rules from a file that governs an AI agent working in a repository.",
  "",
  "A rule is a directive addressed to the AI agent, which a recorded session",
  "transcript could show it following or breaking. The transcript holds the",
  "agent's prompts, its tool calls (with their inputs), the files it read or",
  "wrote, and its replies. Nothing else is observable.",
  "",
  "Return a rule only when the file tells the agent to do, or not to do,",
  "something. Return nothing for:",
  "- descriptions of how a system, tool or codebase behaves;",
  "- instructions written for end users or readers rather than the agent;",
  "- examples, sample output and code listings;",
  "- rules the file quotes from somewhere else, or reports as another party's.",
  "",
  "Keep a procedure's rules too, which a session shows across many turns:",
  "the order of steps, a gate that one step must pass before another, a route",
  "that a step's result chooses, a condition that calls for a step, a required",
  "step, and the step that comes last. Write each as its own rule.",
  "",
  'Drop a directive a transcript cannot show, such as "prefer boring code" or',
  '"keep things simple". If you cannot say what a violation would look like in',
  "a transcript, it does not qualify.",
  "",
  "Each rule has:",
  "- `id`: a short kebab-case identifier, unique within this file.",
  "- `text`: one imperative sentence, faithful to the file. Do not strengthen,",
  "  soften or merge directives, and do not invent ones the file lacks.",
  "- `when` (optional): a trigger saying which turns the rule concerns. Every",
  "  listed condition must hold. The only conditions are:",
  "  - `file-access`: a glob. The turn read, wrote or edited a matching file.",
  "  - `tool-used`: a tool name. The turn called that tool.",
  "  - `prompt-matches`: a regular expression. A prompt the user typed matches.",
  "  - `turn-count-above`: a whole number. The session has more turns than that.",
  "  - `command-matches`: a regular expression. A Bash command in the turn matches.",
  "",
  "Omit `when` unless the rule clearly concerns only certain files, tools or",
  "commands. A trigger that is too narrow hides violations, and a rule with no",
  "`when` is simply checked on every turn. When in doubt, leave it out.",
  "",
  "Return none at all when nothing qualifies.",
].join("\n");

export const RULES_SCHEMA = {
  type: "object",
  required: ["rules"],
  additionalProperties: false,
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "text"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          text: { type: "string", minLength: 1 },
          // Open on purpose: `extractRules` gates each `when` with `validateWhen`
          // and drops the one rule, where a schema miss would void the whole file.
          when: { type: "object" },
        },
      },
    },
  },
} as const;

const ajv = new Ajv2020({ allErrors: true });
const validateRules = ajv.compile(
  RULES_SCHEMA as unknown as Record<string, unknown>,
);

export function isValidRules(value: unknown): boolean {
  return validateRules(value);
}

export interface RulesUserOptions {
  path: string;
  format: string;
  content: string;
}

export function buildRulesUser(options: RulesUserOptions): string {
  return [
    "# Rule source",
    `path: ${options.path}`,
    `format: ${options.format}`,
    "",
    "# File content",
    "",
    options.content,
  ].join("\n");
}
