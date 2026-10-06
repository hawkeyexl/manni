/**
 * The turn judge's prompt surface (proposal 0079, "The judge, decisions
 * first"). Each rule is judged on its own: the shared part is what earlier
 * turns did and the rendered turn, and each rule is one item appended to it. A decision-only provider
 * gets the same text as its state and one question per rule.
 */
import type { DecideQuestion } from "@hawkeyexl/inference";

/**
 * Part of the turn verdict cache key: bump whenever anything in this file that
 * reaches a provider changes. `test/tracevals/unit/rules-judge.test.ts` pins it
 * to a digest of the surface, so the pair has to move together.
 */
export const TURN_JUDGE_PROMPT_VERSION = 5;

export const TURN_JUDGE_SYSTEM_PROMPT = [
  "You check one turn of an AI coding agent's session against one rule.",
  "A turn starts at the last prompt the user typed and runs to the end of the transcript.",
  "The transcript shows the user's prompts, the agent's tool calls with their inputs, and its replies.",
  "",
  "A prompt the user typed in the turn overrides any rule. Doing what the user explicitly asked is never a violation.",
  "",
  "Judge only from what the transcript shows. Do not guess.",
  "A rule applies only when the turn did the kind of work it covers. A rule about work the turn never did does not apply, so it was neither followed nor broken.",
].join("\n");

/** The three scores, each independent of the others, 0 to 100. */
export const TURN_SCORES = ["not-applicable", "followed", "not-followed"] as const;
export type TurnScore = (typeof TURN_SCORES)[number];

const SCORE = { type: "integer", minimum: 0, maximum: 100 } as const;

/**
 * `reasoning` is declared first and always required, so a model writing the
 * object in order says what it saw before it commits to a score. It is capped
 * at 240 characters, which a sentence of 30 words fits, because every word of
 * it is generated before the scores are.
 */
export const TURN_SCHEMA = {
  type: "object",
  required: ["reasoning", ...TURN_SCORES],
  additionalProperties: false,
  properties: {
    reasoning: { type: "string", maxLength: 240 },
    "not-applicable": SCORE,
    followed: SCORE,
    "not-followed": SCORE,
  },
};

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

/**
 * The part every rule's call shares: what earlier turns did, when the ledger
 * holds any, then the turn.
 */
export function buildTurnShared(turn: string, earlier = ""): string {
  return `${earlier !== "" ? `${earlier}\n\n` : ""}# The turn\n\n${turn}\n\n`;
}

/**
 * One rule's item, appended to the shared part as it is. `history` is the
 * ledger's block for the rule, or "" when earlier turns have nothing to say.
 */
export function buildRuleItem(
  displayPath: string,
  rule: { id: string; text: string },
  history = "",
): string {
  return [
    "# The rule",
    "",
    `${ruleKey(displayPath, rule.id)}: ${rule.text}`,
    "",
    ...(history !== "" ? [history, ""] : []),
    "First say in one sentence of at most 30 words what the transcript shows about this rule. Then score. " +
      "Score how strongly the transcript shows each, as a whole number from 0 to 100: the rule does not apply to this turn; the rule applies and the turn followed it; the rule applies and the turn broke it.",
  ].join("\n");
}

/** A decision-only provider's state: the system prompt, then the shared part. */
export function buildDecisionState(turn: string, earlier = ""): string {
  return `${TURN_JUDGE_SYSTEM_PROMPT}\n\n${buildTurnShared(turn, earlier)}`;
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
