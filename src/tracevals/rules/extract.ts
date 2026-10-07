/**
 * Extract the rules one rule-source file declares for the agent, then gate
 * them (proposal 0079). The model proposes; the gate decides what survives, and
 * a rule it drops is reported with a reason rather than lost.
 *
 * A source that says what the session was asked, such as the typed prompts, a
 * plan or a spec, is read by the requirements prompt instead (proposal 0080).
 * Its gate keeps a spec's own ids as written, so `T014` and `1.2` survive.
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
import {
  REQUIREMENTS_SYSTEM_PROMPT,
  buildRequirementsUser,
  isRequestFormat,
} from "./requests-prompt.js";

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
/** A spec's own id, such as `FR-001`, `T014` or `1.2`, or a kebab-case one. */
const SPEC_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** Each extraction prompt, and the ids its gate accepts. */
const PROMPTS = {
  rules: {
    system: RULES_SYSTEM_PROMPT,
    user: buildRulesUser,
    id: KEBAB,
    idReason: "id is not kebab-case",
  },
  requests: {
    system: REQUIREMENTS_SYSTEM_PROMPT,
    user: buildRequirementsUser,
    id: SPEC_ID,
    idReason: "id is neither a spec's own id nor kebab-case",
  },
} as const;

export type ExtractionPrompt = keyof typeof PROMPTS;

/** The prompt a source of this format is read with. */
export function promptFor(format: string): ExtractionPrompt {
  return isRequestFormat(format) ? "requests" : "rules";
}

/** Gate the model's rules: valid id, text, unique id, grounded `when`. */
export function gateRules(
  proposed: Rule[],
  prompt: ExtractionPrompt = "rules",
): Pick<ExtractedRules, "rules" | "dropped"> {
  const { id: idPattern, idReason } = PROMPTS[prompt];
  const rules: Rule[] = [];
  const dropped: ExtractedRules["dropped"] = [];
  const seen = new Set<string>();
  for (const proposedRule of proposed) {
    // An empty `when` names no condition, which is what an absent one means.
    // Local models write it that way, so it is read as absent, not refused.
    const { when, ...bare } = proposedRule;
    const rule: Rule = when === undefined || Object.keys(when).length === 0 ? bare : proposedRule;
    if (!idPattern.test(rule.id)) {
      dropped.push({ id: rule.id, reason: idReason });
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
  const prompt = promptFor(source.format);
  const key = rulesCacheKey({
    provider: provider.provider(),
    model: provider.modelName(),
    prompt,
    temperature: deps.temperature ?? 0,
    sha256: source.sha256,
  });

  const hit = cache?.get(key);
  if (hit !== undefined) return { rules: hit, cached: true, dropped: [] };

  const run = await completeValidatedJSON<{ rules: Rule[] }>({
    provider,
    system: PROMPTS[prompt].system,
    user: PROMPTS[prompt].user(source),
    schema: RULES_SCHEMA,
    ...(deps.temperature !== undefined ? { temperature: deps.temperature } : {}),
  });
  if (run.result === undefined || !isValidRules(run.result)) {
    throw new Error(
      run.error ?? "provider returned rules that do not match the schema",
    );
  }

  const gated = gateRules(run.result.rules, prompt);
  cache?.set(key, gated.rules);
  return { ...gated, cached: false };
}
