/**
 * A deterministic, schema-valid extraction for `--provider mock`.
 *
 * It reads the file the way the real prompt asks a model to, crudely: a bullet
 * that opens with an imperative verb is a rule, everything else is not. That
 * gives offline tests and the CI dogfood path rules they can predict from the
 * fixture alone.
 */
import type { InferenceProvider } from "@hawkeyexl/inference";

const IMPERATIVE =
  /^(?:run|use|never|always|do|don't|keep|write|read|prefer|add|avoid|ask|check|make|follow|commit|test|update|stop|ensure)\b/i;

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .split("-")
    .filter((w) => w !== "")
    .slice(0, 5)
    .join("-");
}

export function mockRulesResponse(content: string): {
  json: { rules: { id: string; text: string }[] };
} {
  const rules: { id: string; text: string }[] = [];
  for (const line of content.split(/\r?\n/)) {
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const text = bullet?.[1]?.trim();
    if (text === undefined || !IMPERATIVE.test(text)) continue;
    const id = kebab(text);
    if (id !== "") rules.push({ id, text });
  }
  return { json: { rules } };
}

const ITEM = /^\s*(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/;
const SPEC_ITEM = /^(?:\*\*)?([A-Z]+-\d+|T\d+|\d+(?:\.\d+)+)(?:\*\*)?:?\s+(.+)$/;

/**
 * The same crude reading for a source that says what the session was asked.
 * A bullet, a numbered prompt or a task checkbox is an item. One that opens
 * with a spec's own id (`FR-001`, `T014`, `1.2`) keeps that id, and any other
 * is a rule only when it opens with an imperative verb.
 */
export function mockRequestsResponse(content: string): {
  json: { rules: { id: string; text: string }[] };
} {
  const rules: { id: string; text: string }[] = [];
  for (const line of content.split(/\r?\n/)) {
    const item = ITEM.exec(line)?.[1]?.trim();
    if (item === undefined) continue;
    const spec = SPEC_ITEM.exec(item);
    const specId = spec?.[1];
    const specText = spec?.[2]?.trim();
    if (specId !== undefined && specText !== undefined) {
      rules.push({ id: specId, text: specText });
    } else if (IMPERATIVE.test(item)) {
      const id = kebab(item);
      if (id !== "") rules.push({ id, text: item });
    }
  }
  return { json: { rules } };
}

const PROHIBITION =/^(?:never|don't|do not|avoid)\b/i;

/**
 * A deterministic turn answer for `--provider mock`, read from the rule's
 * first code span as crudely as `mockRulesResponse` reads a file. A
 * prohibition is not followed when the turn shows its span, and followed
 * otherwise. Any other rule is followed when the turn shows its span. When it
 * does not, every score is 0, which the block bar sends to review. A rule with
 * no code span is followed. The reasoning says which it found.
 */
export function mockTurnScores(user: string): Record<string, string | number> {
  const marker = user.lastIndexOf("# The rule\n\n");
  // The turn alone: what earlier turns did is not this turn's evidence.
  const turn = user.slice(Math.max(0, user.indexOf("# The turn\n\n")), marker);
  const line = user.slice(marker).split("\n")[2] ?? "";
  const text = line.slice(line.indexOf(": ") + 2);
  const span = /`([^`]+)`/.exec(text)?.[1];
  const answer = (reasoning: string, followed: number, notFollowed: number) => ({
    reasoning,
    "not-applicable": 0,
    followed,
    "not-followed": notFollowed,
  });
  if (span === undefined) return answer("The rule names nothing to look for.", 100, 0);
  const shown = turn.includes(span);
  const reasoning = shown ? `The turn shows \`${span}\`.` : `The turn does not show \`${span}\`.`;
  if (PROHIBITION.test(text.trim())) return shown ? answer(reasoning, 0, 100) : answer(reasoning, 100, 0);
  return shown ? answer(reasoning, 100, 0) : answer(reasoning, 0, 0);
}

/** The turn judge under `--provider mock`: answers from `mockTurnScores`. */
export function mockTurnJudge(model: string, name = "mock"): InferenceProvider {
  return {
    provider: () => name,
    modelName: () => model,
    completeJSON: (req) => Promise.resolve({ json: mockTurnScores(req.user) }),
  };
}
