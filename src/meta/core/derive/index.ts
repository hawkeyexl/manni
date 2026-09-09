/**
 * The derived channel's front door: one call resolves every requested field
 * for every input from the sources the run consults.
 *
 * Three rules live here and nowhere else:
 *
 * 1. **A source is consulted only when a requested field can come from it.**
 *    `FIELD_SOURCES` says which; the run's `sources` list narrows it. A
 *    source nobody asked for is never spawned and never reported.
 * 2. **The review sources ride on git, and the origin remote picks one.**
 *    `github` and `gitlab` both read the merged change behind a document's
 *    newest body-changing commit, which only the git walk can name, so
 *    either without `git` is reported unavailable with the fix rather than
 *    silently answering null. Per repository root, the origin remote says
 *    which host the repository lives on, and only the review source of that
 *    name is consulted and reported: a run that allows both on a GitHub
 *    repository reports `github` alone. A run that allows only the other
 *    one is told which host the origin is, and what to change.
 * 3. **Precedence is per field, first non-null wins.** `reviewed-by` and
 *    `last-reviewed` prefer the host's approvals over a `Reviewed-by`
 *    trailer; every other field has one source.
 *
 * Availability is reported, not thrown: a caller decides what an
 * unavailable source means for its run through `assertSourcesAvailable`,
 * because the hint differs per command (`--no-derive` on validate,
 * `--sources` on derive).
 */
import { dirname, resolve } from "node:path";
import { findGitRoot } from "../../../shared/git-root.js";
import { DocmetaError } from "../../types.js";
import { REVIEW_CACHE_DIR } from "./cache.js";
import { deriveFromCodeowners } from "./codeowners.js";
import { createReviewClient, deriveFromReviews, type ReviewFacts } from "./reviews.js";
import { deriveFromGit, type GitFacts } from "./git.js";
import type {
  DerivableField,
  DeriveContext,
  DerivedRecord,
  DerivedValue,
  DeriveInput,
  DeriveSource,
  RemoteIdentity,
  ReviewClient,
  SourceStatus,
} from "./types.js";

/** Which sources can state each field, in precedence order. */
export const FIELD_SOURCES: Readonly<Record<DerivableField, readonly DeriveSource[]>> = {
  created: ["git"],
  "last-updated": ["git"],
  authors: ["git"],
  owner: ["codeowners"],
  "reviewed-by": ["github", "gitlab", "git"],
  "last-reviewed": ["github", "gitlab", "git"],
};

/** The sources that read a host's review record; one per host, named for it. */
type ReviewSource = RemoteIdentity["kind"];

const REVIEW_SOURCES: readonly ReviewSource[] = ["github", "gitlab"];

/** How the host is spelled to a person, as opposed to as a source name. */
const HOST_NAME: Readonly<Record<ReviewSource, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
};

export interface DeriveResult {
  /** Keyed by `DeriveInput.label`; every input has a record. */
  records: Map<string, DerivedRecord>;
  /** One status per source the run consulted. A source nobody asked for is absent. */
  sources: Partial<Record<DeriveSource, SourceStatus>>;
}

/** The sources a run consults: requested, and able to state a requested field. */
export function consultedSources(
  fields: readonly DerivableField[],
  sources: readonly DeriveSource[],
): DeriveSource[] {
  const needed = new Set<DeriveSource>();
  for (const field of fields) for (const s of FIELD_SOURCES[field]) needed.add(s);
  return sources.filter((s) => needed.has(s));
}

/**
 * Throw the exit-2 error for the first consulted source that could not
 * answer. `hint` is the command's own way out, appended after a semicolon.
 */
export function assertSourcesAvailable(
  sources: Partial<Record<DeriveSource, SourceStatus>>,
  hint?: string,
): void {
  for (const name of Object.keys(sources) as DeriveSource[]) {
    const status = sources[name];
    if (status === undefined || status.available) continue;
    const reason = status.reason ?? "it could not answer";
    throw new DocmetaError(
      `${name} source unavailable: ${reason}${hint === undefined ? "" : `; ${hint}`}`,
    );
  }
}

export async function deriveMetadata(
  inputs: readonly DeriveInput[],
  ctx: DeriveContext,
): Promise<DeriveResult> {
  const consulted = new Set(consultedSources(ctx.fields, ctx.sources));
  const sources: Partial<Record<DeriveSource, SourceStatus>> = {};

  // git: the walk every other source builds on.
  let git: Map<string, GitFacts> = new Map();
  if (consulted.has("git")) {
    const result = await deriveFromGit(inputs, { cwd: ctx.cwd, now: ctx.now });
    sources.git = result.status;
    git = result.records;
  }

  // Repository root per input: git's answer where it gave one, the .git walk otherwise.
  const rootCache = new Map<string, string | null>();
  const rootOf = (absPath: string): string | null => {
    const dir = dirname(absPath);
    let root = rootCache.get(dir);
    if (root === undefined) {
      root = findGitRoot(dir);
      rootCache.set(dir, root);
    }
    return root;
  };
  const rootFor = (input: DeriveInput): string | null =>
    git.get(input.label)?.root ?? rootOf(input.absPath);

  // codeowners
  let owners: Map<string, DerivedValue | null> = new Map();
  if (consulted.has("codeowners")) {
    const result = await deriveFromCodeowners(inputs, {
      explicit: ctx.codeowners,
      configDir: ctx.configDir,
      rootOf,
    });
    sources.codeowners = result.status;
    owners = result.records;
  }

  // github / gitlab: one client per repository root, or the injected seam
  // for all. Which of the two a root uses is the origin remote's call.
  const requested = REVIEW_SOURCES.filter((s) => consulted.has(s));
  let reviews: Map<string, ReviewFacts> = new Map();
  if (requested.length > 0) {
    if (!consulted.has("git")) {
      for (const s of requested) {
        sources[s] = {
          available: false,
          reason: `the ${s} source needs the git source to find each document's commits; add git to sources`,
        };
      }
    } else if (sources.git?.available === false) {
      // Git already failed the run; every review lookup starts from a commit
      // git names, so spawning gh/glab now would be wasted calls before the
      // same exit 2.
      for (const s of requested) {
        sources[s] = {
          available: false,
          reason: `the git source could not answer, so the ${s} source cannot locate any commit`,
        };
      }
    } else {
      const result = await deriveReviewsByRoot(inputs, git, rootFor, ctx, requested);
      Object.assign(sources, result.status);
      reviews = result.records;
    }
  }

  const records = new Map<string, DerivedRecord>();
  for (const input of inputs) {
    const fields: DerivedRecord["fields"] = {};
    const g = git.get(input.label);
    const r = reviews.get(input.label);
    for (const field of ctx.fields) {
      let value: DerivedValue | null = null;
      for (const source of FIELD_SOURCES[field]) {
        if (!consulted.has(source)) continue;
        const candidate = valueFrom(source, field, g, r, owners.get(input.label));
        if (candidate !== null) {
          value = candidate;
          break;
        }
      }
      fields[field] = value;
    }
    records.set(input.label, { file: input.label, fields });
  }
  return { records, sources };
}

function valueFrom(
  source: DeriveSource,
  field: DerivableField,
  git: GitFacts | undefined,
  reviews: ReviewFacts | undefined,
  owner: DerivedValue | null | undefined,
): DerivedValue | null {
  switch (source) {
    case "git":
      if (git === undefined || field === "owner") return null;
      return git[field];
    case "codeowners":
      return field === "owner" ? (owner ?? null) : null;
    case "github":
    case "gitlab": {
      if (reviews === undefined) return null;
      if (field !== "reviewed-by" && field !== "last-reviewed") return null;
      // A fact answers for the source of the host it came from, and no other.
      const fact = reviews[field];
      return fact !== null && fact.source === source ? fact : null;
    }
  }
}

/**
 * Consult the review record for each repository root that holds an input.
 *
 * The root's origin remote picks the source: a GitHub origin uses `github`,
 * a GitLab origin `gitlab`, and only the one used is reported. When the
 * origin names a host whose source was not requested, that requested source
 * is reported unavailable with the host named and the fix spelled out. With
 * no origin at all, every requested review source is unavailable, because
 * nothing tells the two apart.
 */
async function deriveReviewsByRoot(
  inputs: readonly DeriveInput[],
  git: ReadonlyMap<string, GitFacts>,
  rootFor: (input: DeriveInput) => string | null,
  ctx: DeriveContext,
  requested: readonly ReviewSource[],
): Promise<{ status: Partial<Record<ReviewSource, SourceStatus>>; records: Map<string, ReviewFacts> }> {
  const byRoot = new Map<string, DeriveInput[]>();
  for (const input of inputs) {
    const root = rootFor(input);
    if (root === null) continue;
    const bucket = byRoot.get(root) ?? [];
    bucket.push(input);
    byRoot.set(root, bucket);
  }
  const status: Partial<Record<ReviewSource, SourceStatus>> = {};
  const records = new Map<string, ReviewFacts>();
  const unavailable = (
    which: readonly ReviewSource[],
    reason: string,
  ): { status: Partial<Record<ReviewSource, SourceStatus>>; records: Map<string, ReviewFacts> } => {
    for (const s of which) status[s] = { available: false, reason };
    return { status, records: new Map() };
  };
  if (byRoot.size === 0) {
    return unavailable(requested, "no git repository contains the documents");
  }
  const cacheDir = resolve(ctx.configDir ?? ctx.cwd, REVIEW_CACHE_DIR);
  for (const [root, bucket] of byRoot) {
    const client: ReviewClient =
      ctx.reviews ??
      (await createReviewClient(root, { cwd: ctx.cwd, cache: ctx.cache, cacheDir, requested }));
    const identity = await client.detect();
    if (identity === null) {
      // No origin, or a host that names neither platform: the client's own
      // status says which, and names the fix.
      const s = await client.status();
      return unavailable(requested, s.reason ?? "no origin remote to tell GitHub from GitLab");
    }
    const source = identity.kind;
    if (!requested.includes(source)) {
      return unavailable(
        requested,
        `the origin remote is ${identity.host}, which is ${HOST_NAME[source]}; add ${source} to sources, or drop reviewed-by and last-reviewed from the managed fields`,
      );
    }
    const result = await deriveFromReviews(
      bucket.map((input) => ({
        label: input.label,
        sha: git.get(input.label)?.lastBodyCommit ?? null,
      })),
      client,
    );
    // One root that cannot answer makes the source unavailable for the run:
    // a half-derived review field would read as "nobody approved", which is
    // the false green the whole channel refuses.
    if (!result.status.available) {
      status[source] = result.status;
      return { status, records: new Map() };
    }
    status[source] = result.status;
    for (const [label, facts] of result.records) records.set(label, facts);
  }
  return { status, records };
}

