/**
 * Extracted-rules cache: content-addressed JSON holding the *gated* rules for
 * one rule-source file (proposal 0079, "Extraction and its cache").
 *
 * The key is the provider, the model, the prompt version and the sha256 of the
 * whole file. The path is deliberately absent: identical content anywhere
 * shares one entry, so a vendored or copied rules file pays once.
 *
 * Reads go through the inference library's `JsonCache`. Writes do not: the
 * library writes in place, so a reader racing a writer could see half an
 * entry. A hook and a `check` run can overlap, so each entry is written to a
 * temporary file and renamed into place.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JsonCache, buildCacheKey } from "@hawkeyexl/inference";
import { warn } from "../../shared/warn.js";
import type { Rule } from "./extract.js";
import { RULES_PROMPT_VERSION } from "./prompt.js";

/** Default location, under the tool's per-project cache directory. */
export const DEFAULT_RULES_CACHE_DIR = ".manni/tracevals/cache/rules";

export interface RulesCacheKeyParts {
  provider: string;
  model: string;
  /** The extraction temperature, `judge.temperature`: another reading of one file. */
  temperature: number;
  /** sha256 of the whole source file. */
  sha256: string;
}

export function rulesCacheKey(parts: RulesCacheKeyParts): string {
  return buildCacheKey([
    parts.provider,
    parts.model,
    `rules-v${RULES_PROMPT_VERSION}`,
    `t${String(parts.temperature)}`,
    parts.sha256,
  ]);
}

function isRule(value: unknown): value is Rule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.text === "string" &&
    (r.when === undefined ||
      (typeof r.when === "object" && r.when !== null && !Array.isArray(r.when)))
  );
}

export class RulesCache {
  private readonly store: JsonCache<unknown>;
  private warned = false;

  constructor(
    private readonly dir: string = DEFAULT_RULES_CACHE_DIR,
    private readonly enabled: boolean = true,
  ) {
    this.store = new JsonCache<unknown>(dir, enabled, "manni-tracevals");
  }

  /** An entry that is not a list of rules, from an older shape, is a miss. */
  get(key: string): Rule[] | undefined {
    const value = this.store.get(key);
    if (!Array.isArray(value) || !value.every(isRule)) return undefined;
    return value;
  }

  set(key: string, rules: Rule[]): void {
    if (!this.enabled) return;
    const tmp = join(this.dir, `${key}.${process.pid}.${Date.now()}.tmp`);
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(rules, null, 2));
      renameSync(tmp, join(this.dir, `${key}.json`));
    } catch (err) {
      rmSync(tmp, { force: true });
      if (!this.warned) {
        this.warned = true;
        warn(
          `could not write the rules cache at ${this.dir} (${err instanceof Error ? err.message : String(err)}). Continuing without caching.`,
        );
      }
    }
  }
}
