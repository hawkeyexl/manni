/**
 * The turn judge's prompt surface (proposal 0079, "The judge, decisions
 * first"). Each rule is judged on its own: the shared part is the rendered
 * turn, and each rule is one item appended to it. A decision-only provider
 * gets the same text as its state and one question per rule.
 */
import type { DecideQuestion } from "@hawkeyexl/inference";

/**
 * Part of the turn verdict cache key: bump whenever anything in this file that
 * reaches a provider changes. `test/tracevals/unit/rules-judge.test.ts` pins it
 * to a digest of the surface, so the pair has to move together.
 */
export const TURN_JUDGE_PROMPT_VERSION = 2;

export const TURN_JUDGE_SYSTEM_PROMPT = [
  "You check one turn of an AI coding agent's session against one rule.",
  "A turn starts at the last prompt the user typed and runs to the end of the transcript.",
  "The transcript shows the user's prompts, the agent's tool calls with their inputs, and its replies.",
  "",
  "A prompt the user typed in the turn overrides any rule. Doing what the user explicitly asked is never a violation.",
  "",
  "Judge only from what the transcript shows. Do not guess.",
].join("\n");

/** The three scores, each independent of the others, 0 to 100. */
export const TURN_SCORES = ["followed", "not-followed", "not-applicable"] as const;
export type TurnScore = (typeof TURN_SCORES)[number];

const SCORE = { type: "integer", minimum: 0, maximum: 100 } as const;

const SCORES_SCHEMA = {
  type: "object",
  required: [...TURN_SCORES],
  additionalProperties: false,
  properties: { followed: SCORE, "not-followed": SCORE, "not-applicable": SCORE },
};

// `reasoning` is declared last, so a model writing the object in order has
// already committed to its scores when it reaches it.
const REASONING_SCHEMA = {
  ...SCORES_SCHEMA,
  required: [...TURN_SCORES, "reasoning"],
  properties: { ...SCORES_SCHEMA.properties, reasoning: { type: "string" } },
};

/** One schema object per flag, so the library compiles each once. */
export function turnSchema(reasoning: boolean): Record<string, unknown> {
  return reasoning ? REASONING_SCHEMA : SCORES_SCHEMA;
}

/** Decision-only providers: the three options, one per score. */
export const TURN_CRITERIA: Record<TurnScore, string> = {
  followed: "The turn did what the rule asks.",
  "not-followed": "The turn did what the rule forbids, or skipped what it requires.",
  "not-applicable": "The rule had nothing to say about this turn.",
};

/** How a rule is named to a model. */
export function ruleKey(displayPath: string, id: string): string {
  return `${displayPath}#${id}`;
}

/** The part every rule's call shares. */
export function buildTurnShared(turn: string): string {
  return `# The turn\n\n${turn}\n\n`;
}

/** One rule's item, appended to the shared part as it is. */
export function buildRuleItem(displayPath: string, rule: { id: string; text: string }): string {
  return [
    "# The rule",
    "",
    `${ruleKey(displayPath, rule.id)}: ${rule.text}`,
    "",
    "Score how strongly the transcript shows each: the turn followed the rule, the turn did not follow it, or the rule does not apply to this turn. Each score is a whole number from 0 to 100.",
  ].join("\n");
}

/** A decision-only provider's state: the system prompt, then the turn. */
export function buildDecisionState(turn: string): string {
  return `${TURN_JUDGE_SYSTEM_PROMPT}\n\n${buildTurnShared(turn)}`;
}

export function questionFor(
  displayPath: string,
  rule: { id: string; text: string },
): DecideQuestion {
  return {
    type: "choice",
    instructions: `Did this turn follow ${ruleKey(displayPath, rule.id)}? The rule: ${rule.text}`,
    criteria: { ...TURN_CRITERIA },
  };
}
