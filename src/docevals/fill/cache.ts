/**
 * Fill proposal cache: content-addressed JSON files storing the raw,
 * pre-gating proposal — re-running with a different confidence threshold
 * re-gates from cache with zero API calls. Folding the existing eval-name set
 * into the key means a post-fill re-run misses (the set changed) and asks for
 * additional coverage instead of replaying stale proposals. Separate from the
 * judge cache: different key scheme and value shape.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../judge/cache.js";
import { FILL_PROMPT_VERSION, isValidProposal } from "./prompt.js";

export function fillCacheKey(
  provider: string,
  model: string,
  temperature: number,
  maxEvals: number,
  body: string,
  existingNames: string[],
  chunkChars: number,
): string {
  return sha256(
    [
      provider,
      model,
      `fill-v${FILL_PROMPT_VERSION}`,
      `t${temperature}`,
      `n${maxEvals}`,
      // The chunk budget decides how the page was split, and so which
      // proposals came back. Without it, two runs at different budgets share
      // a key and the second silently replays the first — and halve-and-retry
      // makes that a real collision, not a hypothetical one.
      `chunk${chunkChars}`,
      sha256(body),
      existingNames.join(","),
    ].join("|"),
  );
}

export class FillCache {
  /** Cache-write failures warn once per run, not once per page. */
  private warned = false;

  constructor(
    private readonly dir: string,
    private readonly enabled: boolean = true,
  ) {}

  get(key: string): Record<string, unknown> | undefined {
    if (!this.enabled) return undefined;
    const path = join(this.dir, `${key}.json`);
    if (!existsSync(path)) return undefined;
    try {
      const proposal = JSON.parse(readFileSync(path, "utf8")) as unknown;
      // A schema-invalid entry (older format, corruption) is a miss, not an error.
      if (!isValidProposal(proposal)) return undefined;
      return proposal as Record<string, unknown>;
    } catch {
      return undefined; // Corrupt cache entry — treat as a miss.
    }
  }

  set(key: string, proposal: Record<string, unknown>): void {
    if (!this.enabled) return;
    // The cache is an optimization: a write failure must never abort a run
    // whose proposal already succeeded.
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(
        join(this.dir, `${key}.json`),
        JSON.stringify(proposal, null, 2),
      );
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        console.warn(
          `manni docevals: could not write the fill cache at ${this.dir} (${e instanceof Error ? e.message : String(e)}). Continuing without caching.`,
        );
      }
    }
  }
}
