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
