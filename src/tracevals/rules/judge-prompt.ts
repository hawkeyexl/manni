/**
 * The turn judge's prompt surface (proposal 0079, "The judge, decisions
 * first"). One set of principles serves both modes: the generative system
 * prompt, and the shared state every decision question branches from.
 */
import type { DecideQuestion } from "@hawkeyexl/inference";

/**
 * Part of the turn verdict cache key: bump whenever anything in this file that
 * reaches a provider changes. `test/tracevals/unit/rules-judge.test.ts` pins it
 * to a digest of the surface, so the pair has to move together.
 */
export const TURN_JUDGE_PROMPT_VERSION = 1;

/** The rules from one source, in the order the source declared them. */
export interface RuleGroup {
  displayPath: string;
  rules: { id: string; text: string }[];
}

const PRINCIPLES = [
  "You check one turn of an AI coding agent's session against the rules that governed it.",
  "A turn starts at the last prompt the user typed and runs to the end of the transcript.",
  "The transcript shows the user's prompts, the agent's tool calls with their inputs, and its replies.",
  "",
  "Rules are grouped by the file that declared them, farthest file first and nearest file last.",
  "When two rules conflict, a nearer file overrides a farther one.",
  "A prompt the user typed in the turn overrides any file. Doing what the user explicitly asked is never a violation, even when a file forbids it.",
  "",
  "Judge only from what the transcript shows. When it does not show enough to tell whether a rule was followed, the answer is unclear. Do not guess.",
  "A rule that has nothing to say about this turn is not applicable.",
].join("\n");

/** Generative mode: one call per run, returning only what needs attention. */
export const TURN_JUDGE_SYSTEM_PROMPT = [
  PRINCIPLES,
  "",
  "Report only the rules the turn broke or that you cannot settle:",
  "- `violations`: the turn did what the rule forbids, or skipped what it requires.",
  "- `unclear`: the transcript does not show enough to tell.",
  "Leave out every rule the turn followed, and every rule that did not apply.",
  "",
  "Each entry names its rule as `<file>#<id>`, exactly as listed. `observed` says in one sentence what the transcript shows. `confidence` runs from 0 to 1.",
  "Return two empty lists when the turn broke nothing.",
].join("\n");

/** Decision mode: the four options, worded as the proposal's table. */
export const TURN_CRITERIA = {
  followed: "The turn did what the rule asks.",
  violated: "The turn did what the rule forbids, or skipped what it requires.",
  not_applicable: "The rule had nothing to say about this turn.",
  unclear: "The turn does not show enough to tell.",
} as const;

export type TurnChoice = keyof typeof TURN_CRITERIA;

const ENTRY = {
  type: "object",
  required: ["rule", "observed", "confidence"],
  additionalProperties: false,
  properties: {
    rule: { type: "string", description: "The rule as `<file>#<id>`, exactly as listed." },
    observed: { type: "string", description: "What the transcript shows, in one sentence." },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

export const TURN_SCHEMA = {
  type: "object",
  required: ["violations", "unclear"],
  additionalProperties: false,
  properties: {
    violations: { type: "array", items: ENTRY },
    unclear: { type: "array", items: ENTRY },
  },
} as const;

/** How a rule is named to a model, in both modes. */
export function ruleKey(displayPath: string, id: string): string {
  return `${displayPath}#${id}`;
}

/** The rules, farthest source first, then the rendered turn. */
export function buildTurnUser(groups: RuleGroup[], turn: string): string {
  const lines = ["# Rules, farthest file first", ""];
  for (const group of groups) {
    lines.push(`## ${group.displayPath}`);
    for (const rule of group.rules) {
      lines.push(`- ${ruleKey(group.displayPath, rule.id)}: ${rule.text}`);
    }
    lines.push("");
  }
  lines.push("# The turn", "", turn);
  return lines.join("\n");
}

/** Decision mode's shared state: the principles, the rules and the turn, encoded once. */
export function buildDecisionState(groups: RuleGroup[], turn: string): string {
  return `${PRINCIPLES}\n\n${buildTurnUser(groups, turn)}`;
}

export function questionFor(
  displayPath: string,
  rule: { id: string; text: string },
): DecideQuestion {
  return {
    type: "choice",
    instructions: `Did this turn follow ${ruleKey(displayPath, rule.id)}, from ${displayPath}? The rule: ${rule.text}`,
    criteria: { ...TURN_CRITERIA },
  };
}
