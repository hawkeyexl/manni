/**
 * The derived channel's front door: one call resolves every requested field
 * for every input from the sources the run consults.
 *
 * Three rules live here and nowhere else:
 *
 * 1. **A source is consulted only when a requested field can come from it.**
 *    `FIELD_SOURCES` says which; the run's `sources` list narrows it. A
 *    source nobody asked for is never spawned and never reported.
 * 2. **The forge rides on git.** Its lookups start from the newest
 *    body-changing commit, which only the git walk can name, so `forge`
 *    without `git` is reported unavailable with the fix rather than
 *    silently answering null.
 * 3. **Precedence is per field, first non-null wins.** `reviewed-by` and
 *    `last-reviewed` prefer the forge's approvals over a `Reviewed-by`
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
import { FORGE_CACHE_DIR } from "./cache.js";
import { deriveFromCodeowners } from "./codeowners.js";
import { createForgeClient, deriveFromForge, type ForgeFacts } from "./forge.js";
import { deriveFromGit, type GitFacts } from "./git.js";
import type {
  DerivableField,
  DeriveContext,
  DerivedRecord,
  DerivedValue,
  DeriveInput,
  DeriveSource,
  ForgeClient,
  SourceStatus,
} from "./types.js";

/** Which sources can state each field, in precedence order. */
export const FIELD_SOURCES: Readonly<Record<DerivableField, readonly DeriveSource[]>> = {
  created: ["git"],
  "last-updated": ["git"],
  authors: ["git"],
  owner: ["codeowners"],
  "reviewed-by": ["forge", "git"],
  "last-reviewed": ["forge", "git"],
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

  // forge: one client per repository root, or the injected seam for all.
  let forge: Map<string, ForgeFacts> = new Map();
  if (consulted.has("forge")) {
    if (!consulted.has("git")) {
      sources.forge = {
        available: false,
        reason:
          "the forge source needs the git source to find each document's commits; add git to sources",
      };
    } else if (sources.git?.available === false) {
      // Git already failed the run; every forge lookup starts from a commit
      // git names, so spawning gh/glab now would be wasted calls before the
      // same exit 2.
      sources.forge = {
        available: false,
        reason: "the git source could not answer, so the forge cannot locate any commit",
      };
    } else {
      const result = await deriveForgeByRoot(inputs, git, rootFor, ctx);
      sources.forge = result.status;
      forge = result.records;
    }
  }

  const records = new Map<string, DerivedRecord>();
  for (const input of inputs) {
    const fields: DerivedRecord["fields"] = {};
    const g = git.get(input.label);
    const f = forge.get(input.label);
    for (const field of ctx.fields) {
      let value: DerivedValue | null = null;
      for (const source of FIELD_SOURCES[field]) {
        if (!consulted.has(source)) continue;
        const candidate = valueFrom(source, field, g, f, owners.get(input.label));
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
  forge: ForgeFacts | undefined,
  owner: DerivedValue | null | undefined,
): DerivedValue | null {
  switch (source) {
    case "git":
      if (git === undefined || field === "owner") return null;
      return git[field];
    case "codeowners":
      return field === "owner" ? (owner ?? null) : null;
    case "forge":
      if (forge === undefined) return null;
      return field === "reviewed-by" || field === "last-reviewed" ? forge[field] : null;
  }
}

async function deriveForgeByRoot(
  inputs: readonly DeriveInput[],
  git: ReadonlyMap<string, GitFacts>,
  rootFor: (input: DeriveInput) => string | null,
  ctx: DeriveContext,
): Promise<{ status: SourceStatus; records: Map<string, ForgeFacts> }> {
  const byRoot = new Map<string, DeriveInput[]>();
  for (const input of inputs) {
    const root = rootFor(input);
    if (root === null) continue;
    const bucket = byRoot.get(root) ?? [];
    bucket.push(input);
    byRoot.set(root, bucket);
  }
  const records = new Map<string, ForgeFacts>();
  if (byRoot.size === 0) {
    return {
      status: { available: false, reason: "no git repository contains the documents" },
      records,
    };
  }
  const cacheDir = resolve(ctx.configDir ?? ctx.cwd, FORGE_CACHE_DIR);
  for (const [root, bucket] of byRoot) {
    const client: ForgeClient =
      ctx.forge ?? (await createForgeClient(root, { cwd: ctx.cwd, cache: ctx.cache, cacheDir }));
    const result = await deriveFromForge(
      bucket.map((input) => ({
        label: input.label,
        sha: git.get(input.label)?.lastBodyCommit ?? null,
      })),
      client,
    );
    // One root that cannot answer makes the source unavailable for the run:
    // a half-derived review field would read as "nobody approved", which is
    // the false green the whole channel refuses.
    if (!result.status.available) return { status: result.status, records: new Map() };
    for (const [label, facts] of result.records) records.set(label, facts);
  }
  return { status: { available: true }, records };
}
