/**
 * The GitHub or GitLab review cache: cross-run, for merged-change answers.
 *
 * A merged pull request is history: its approvals cannot change, so the
 * answer for `host/project/sha` is good forever and there is no TTL. An
 * *open* PR's answer is the opposite — the next approval changes it — so a
 * `null` from the host is never written. `--no-cache` disables both
 * directions for one run.
 *
 * Same shape as `schema-cache.ts`: one file per key under
 * `.manni/meta/review-cache/`, named by a digest so the key (which carries
 * `/`) can never decide where a write lands; a malformed entry is a miss;
 * a failed write is swallowed, because a read-only checkout must cost the
 * next run one `gh` call, not this run its result. Synchronous, because a
 * `set()` the caller does not await must still be on disk when the next
 * process starts.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewClient, RemoteIdentity, MergedChange } from "./types.js";

/** Where the GitHub or GitLab review cache lives, relative to the project root. `.manni/` is gitignored. */
export const REVIEW_CACHE_DIR = ".manni/meta/review-cache";

/** The only entry format this version understands. */
export const REVIEW_CACHE_VERSION = 1;

interface Entry {
  version: number;
  /** `host/project/sha`; re-checked on read. */
  key: string;
  change: MergedChange;
}

/** The GitHub or GitLab review cache: one immutable merged change per `host/project/sha`. */
export class ReviewCache {
  constructor(
    private readonly dir: string,
    private readonly enabled: boolean,
  ) {}

  entryPath(key: string): string {
    const digest = createHash("sha256").update(key).digest("hex");
    return join(this.dir, `${digest}.json`);
  }

  /** The cached change, or `undefined` for a miss. Never `null`: nulls are not stored. */
  get(key: string): MergedChange | undefined {
    if (!this.enabled) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.entryPath(key), "utf8"));
    } catch {
      return undefined;
    }
    if (!isRecord(raw)) return undefined;
    if (raw.version !== REVIEW_CACHE_VERSION || raw.key !== key) return undefined;
    const change = readChange(raw.change);
    return change ?? undefined;
  }

  set(key: string, value: MergedChange): void {
    if (!this.enabled) return;
    const entry: Entry = { version: REVIEW_CACHE_VERSION, key, change: value };
    const path = this.entryPath(key);
    // Temp file beside the target plus rename, so a reader never sees half an
    // entry. Synchronous: see the module comment.
    const tmp = `${path}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
      renameSync(tmp, path);
    } catch {
      // Intentionally silent: see the module comment.
      try {
        rmSync(tmp, { force: true });
      } catch {
        // The temp file was never created, or cannot be removed either.
      }
    }
  }
}

/**
 * `client` with `mergedChangeFor` read through the cache. Only a merged
 * answer is stored. With no identity there is no key, and every call goes
 * straight through — which, for a client with no origin, is a `null`.
 */
export function cachedClient(
  client: ReviewClient,
  cache: ReviewCache,
  identity: RemoteIdentity | null,
): ReviewClient {
  return {
    detect: () => client.detect(),
    status: () => client.status(),
    async mergedChangeFor(sha) {
      if (identity === null) return client.mergedChangeFor(sha);
      const key = `${identity.host}/${identity.project}/${sha}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const change = await client.mergedChangeFor(sha);
      if (change !== null) cache.set(key, change);
      return change;
    },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A stored change, or `null` when the file does not hold one. */
function readChange(v: unknown): MergedChange | null {
  if (!isRecord(v)) return null;
  const { id, mergedAt, approvals } = v;
  if (typeof id !== "number" || typeof mergedAt !== "string") return null;
  if (!Array.isArray(approvals)) return null;
  const read: MergedChange["approvals"] = [];
  for (const a of approvals as unknown[]) {
    if (!isRecord(a)) return null;
    if (typeof a.login !== "string" || typeof a.submittedAt !== "string") return null;
    read.push({ login: a.login, submittedAt: a.submittedAt });
  }
  return { id, mergedAt, approvals: read };
}
