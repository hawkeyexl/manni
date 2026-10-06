/**
 * Extract the rules one rule-source file declares for the agent, then gate
 * them (proposal 0079). The model proposes; the gate decides what survives, and
 * a rule it drops is reported with a reason rather than lost.
 */
import {
  completeValidatedJSON,
  type InferenceProvider,
} from "@hawkeyexl/inference";
import { validateWhen } from "../graders/when.js";
import { type RulesCache, rulesCacheKey } from "./cache.js";
import {
  RULES_SCHEMA,
  RULES_SYSTEM_PROMPT,
  buildRulesUser,
  isValidRules,
} from "./prompt.js";

export interface Rule {
  id: string;
  text: string;
  when?: Record<string, unknown>;
}

export interface ExtractSource {
  path: string;
  format: string;
  content: string;
  /** sha256 of `content`; the cache key, so the path never enters it. */
  sha256: string;
}

export interface ExtractDeps {
  provider: InferenceProvider;
  cache?: RulesCache;
  temperature?: number;
}

export interface ExtractedRules {
  rules: Rule[];
  cached: boolean;
  dropped: { id?: string; reason: string }[];
}

const KEBAB = /^[a-z0-9][a-z0-9-]*$/;

/** Gate the model's rules: valid id, text, unique id, grounded `when`. */
export function gateRules(
  proposed: Rule[],
): Pick<ExtractedRules, "rules" | "dropped"> {
  const rules: Rule[] = [];
  const dropped: ExtractedRules["dropped"] = [];
  const seen = new Set<string>();
  for (const rule of proposed) {
    if (!KEBAB.test(rule.id)) {
      dropped.push({ id: rule.id, reason: "id is not kebab-case" });
    } else if (rule.text.trim() === "") {
      dropped.push({ id: rule.id, reason: "text is empty" });
    } else if (seen.has(rule.id)) {
      dropped.push({ id: rule.id, reason: "id repeats an earlier rule" });
    } else {
      const invalid =
        rule.when === undefined ? undefined : validateWhen({ when: rule.when });
      if (invalid !== undefined) {
        dropped.push({ id: rule.id, reason: invalid });
      } else {
        seen.add(rule.id);
        rules.push(rule);
      }
    }
  }
  return { rules, dropped };
}

/**
 * Throws when the provider errors or returns a shape the schema rejects, so a
 * caller can tell "this file yielded no rules" (an empty list) from "the model
 * never answered".
 */
export async function extractRules(
  source: ExtractSource,
  deps: ExtractDeps,
): Promise<ExtractedRules> {
  const { provider, cache } = deps;
  const key = rulesCacheKey({
    provider: provider.provider(),
    model: provider.modelName(),
    temperature: deps.temperature ?? 0,
    sha256: source.sha256,
  });

  const hit = cache?.get(key);
  if (hit !== undefined) return { rules: hit, cached: true, dropped: [] };

  const run = await completeValidatedJSON<{ rules: Rule[] }>({
    provider,
    system: RULES_SYSTEM_PROMPT,
    user: buildRulesUser(source),
    schema: RULES_SCHEMA,
    ...(deps.temperature !== undefined ? { temperature: deps.temperature } : {}),
  });
  if (run.result === undefined || !isValidRules(run.result)) {
    throw new Error(
      run.error ?? "provider returned rules that do not match the schema",
    );
  }

  const gated = gateRules(run.result.rules);
  cache?.set(key, gated.rules);
  return { ...gated, cached: false };
}
