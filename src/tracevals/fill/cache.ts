/**
 * Fill proposal cache: content-addressed JSON holding the raw, *pre-gating*
 * proposal. Two consequences are the point of the design:
 *
 * - Re-running with a different `--confidence` re-gates from cache, so tuning
 *   the threshold costs no tokens.
 * - The existing eval-id set is part of the key, so a re-run after a
 *   fill misses and asks the model for *additional* coverage rather than
 *   replaying a proposal that has already been applied.
 *
 * Kept in its own directory: the judge cache has a different key scheme and
 * value shape, and the two must never be read into each other.
 *
 * Storage is the inference library's `JsonCache`; the schema re-check on read
 * stays here, because the library's cache deliberately does not know what
 * shape any given consumer stores.
 */
import { JsonCache, buildCacheKey, sha256 } from "@hawkeyexl/inference";
import type { ArtifactType } from "../artifacts/types.js";
import { FILL_PROMPT_VERSION, isValidProposal } from "./prompt.js";

export interface FillCacheKeyParts {
  provider: string;
  model: string;
  temperature: number;
  maxEvals: number;
  artifactType: ArtifactType;
  /** Artifact path — it appears in the prompt, so it belongs in the key. */
  path: string;
  /** Full artifact content, hashed. */
  body: string;
  existingNames: string[];
  /**
   * Project-wide skill names. They are the grounding vocabulary in the
   * prompt, so adding or renaming a skill must invalidate every artifact's
   * cached proposal, not just that skill's own.
   */
  knownSkills: string[];
}

/** JSON-encoded so a name containing a separator cannot forge a boundary. */
function listPart(values: string[]): string {
  return JSON.stringify([...values].sort());
}

export function fillCacheKey(parts: FillCacheKeyParts): string {
  return buildCacheKey([
    parts.provider,
    parts.model,
    `fill-v${FILL_PROMPT_VERSION}`,
    `t${parts.temperature}`,
    `n${parts.maxEvals}`,
    parts.artifactType,
    parts.path,
    sha256(parts.body),
    listPart(parts.existingNames),
    listPart(parts.knownSkills),
  ]);
}

/**
 * A proposal cache over `JsonCache`, adding the one thing the generic cache
 * cannot do: reject an entry written by an older proposal schema. Such an
 * entry parses fine, so only a schema check turns it into a miss.
 */
export class FillCache {
  private readonly store: JsonCache<unknown>;

  constructor(dir: string, enabled: boolean = true) {
    this.store = new JsonCache<unknown>(dir, enabled, "manni-tracevals");
  }

  get(key: string): Record<string, unknown> | undefined {
    const proposal = this.store.get(key);
    if (!isValidProposal(proposal)) return undefined;
    return proposal as Record<string, unknown>;
  }

  set(key: string, proposal: Record<string, unknown>): void {
    this.store.set(key, proposal);
  }
}
