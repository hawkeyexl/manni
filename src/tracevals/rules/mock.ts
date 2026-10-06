/**
 * A deterministic, schema-valid extraction for `--provider mock`.
 *
 * It reads the file the way the real prompt asks a model to, crudely: a bullet
 * that opens with an imperative verb is a rule, everything else is not. That
 * gives offline tests and the CI dogfood path rules they can predict from the
 * fixture alone.
 */
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
 * Deterministic turn decisions for `--provider mock`, read from the rule's
 * first code span as crudely as `mockRulesResponse` reads a file. A
 * prohibition is `violated` when the turn shows its span and `followed`
 * otherwise. Any other rule is `followed` when the turn shows its span and
 * `unclear` when it does not. A rule with no code span is `followed`.
 */
export function mockTurnDecisions(
  _id: string,
  question: { instructions: string },
  state: unknown,
): "followed" | "violated" | "unclear" {
  const shared = typeof state === "string" ? state : JSON.stringify(state);
  const text = question.instructions.split("The rule: ").at(-1) ?? "";
  const span = /`([^`]+)`/.exec(text)?.[1];
  if (span === undefined) return "followed";
  const shown = shared.slice(shared.lastIndexOf("# The turn")).includes(span);
  if (PROHIBITION.test(text.trim())) return shown ? "violated" : "followed";
  return shown ? "followed" : "unclear";
}
