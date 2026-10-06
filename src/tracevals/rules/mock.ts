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

const PROHIBITION = /^(?:never|don't|do not|avoid)\b/i;

/**
 * Deterministic turn scores for `--provider mock`, read from the rule's first
 * code span as crudely as `mockRulesResponse` reads a file. A prohibition is
 * not followed when the turn shows its span, and followed otherwise. Any other
 * rule is followed when the turn shows its span. When it does not, every score
 * is 0, which the block bar sends to review. A rule with no code span is
 * followed.
 */
export function mockTurnScores(user: string): Record<string, number> {
  const marker = user.lastIndexOf("# The rule\n\n");
  const turn = user.slice(0, marker);
  const line = user.slice(marker).split("\n")[2] ?? "";
  const text = line.slice(line.indexOf(": ") + 2);
  const span = /`([^`]+)`/.exec(text)?.[1];
  const scores = (followed: number, notFollowed: number) => ({
    followed,
    "not-followed": notFollowed,
    "not-applicable": 0,
  });
  if (span === undefined) return scores(100, 0);
  const shown = turn.includes(span);
  if (PROHIBITION.test(text.trim())) return shown ? scores(0, 100) : scores(100, 0);
  return shown ? scores(100, 0) : scores(0, 0);
}

/** The turn judge under `--provider mock`: scores from `mockTurnScores`. */
export function mockTurnJudge(model: string, name = "mock"): InferenceProvider {
  return {
    provider: () => name,
    modelName: () => model,
    completeJSON: (req) => {
      const json: Record<string, unknown> = mockTurnScores(req.user);
      const properties = req.schema.properties;
      if (typeof properties === "object" && properties !== null && "reasoning" in properties) {
        json.reasoning = "Scored by the mock judge.";
      }
      return Promise.resolve({ json });
    },
  };
}
