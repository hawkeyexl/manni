/**
 * What a page's schemas mark `x-manni-location: external`, for a manifest with
 * no `keys` (proposal 0068). Such a manifest owns those fields for that page,
 * so every command that merges one asks this first, through
 * `mergeWithMarks`.
 *
 * The page's schema set is resolved the way `validate` resolves it: by path,
 * collection and override, and by the page's own `$schema`, which a manifest
 * may never supply. So the set is known before anything is merged, and the
 * marks are read over the page with its keyless manifests' values in place.
 *
 * `pageClaims` reads the same set for what it claims rather than what it
 * marks: the top-level properties that decide which merge-safe fields a
 * `derive:` block with no `fields` manages on the page (proposal 0069).
 */
import { DocmetaError } from "../types.js";
import { loadConfig, schemaTrustRoot, type DocmetaConfig, type SchemaTrustRoot } from "./config.js";
import type { PageMarks } from "./external-metadata.js";
import {
  collectSchemaPins,
  FILE_SCHEMA_KEY,
  rebaseConfigSchemaRefs,
  resolveSchemaSetWithSource,
} from "./resolve-schema.js";
import { schemaLoadOptions } from "./schema-registry.js";
import { Validator } from "./validator.js";

export interface PageMarksOptions {
  /** The run's validator, or a way to build one on first use. */
  validator: Validator | (() => Validator);
  config: DocmetaConfig | null;
  /** The directory a page's own `$schema` is measured from. */
  cwd: string;
  trustRoot: SchemaTrustRoot;
  /** `-s/--schema`: the set every page is judged by, over config. */
  cliSchemas?: readonly string[];
  /**
   * The collections a page belongs to for its schema set, when the command
   * resolves sets over other collections than it merges manifests from.
   * Absent, the merge's own membership is used.
   */
  memberOf?: (label: string) => readonly string[];
}

/**
 * A `PageMarks` over the run's schemas. A page whose set cannot be resolved
 * or loaded gets `undefined`, so its keyless manifests own nothing for it
 * and the command reports the schema the way it always has.
 */
export function pageMarks(opts: PageMarksOptions): PageMarks {
  const validator = lazyValidator(opts);
  return async (label, probe, memberOf) => {
    const refs = pageRefs(opts, label, probe, memberOf);
    if (refs === undefined) return undefined;
    try {
      const preferences = await validator().locationPreferences({ ...probe }, refs);
      const marked = new Set<string>();
      for (const [key, p] of preferences) if (p.location === "external") marked.add(key);
      return marked;
    } catch (err) {
      if (err instanceof DocmetaError) return undefined;
      throw err;
    }
  };
}

/**
 * What a page's schemas claim, for the merge-safe default (proposal 0069):
 * the top-level property names of every schema in its set, resolved the way
 * `pageMarks` resolves it. `undefined` when the set cannot be resolved or
 * loaded, so the page claims nothing and the command reports the schema the
 * way it always has.
 */
export type PageClaims = (
  label: string,
  probe: Readonly<Record<string, unknown>>,
  memberOf: readonly string[],
) => Promise<ReadonlySet<string> | undefined>;

export function pageClaims(opts: PageMarksOptions): PageClaims {
  const validator = lazyValidator(opts);
  return async (label, probe, memberOf) => {
    const refs = pageRefs(opts, label, probe, memberOf);
    if (refs === undefined) return undefined;
    try {
      return await validator().claimedProperties(refs);
    } catch (err) {
      if (err instanceof DocmetaError) return undefined;
      throw err;
    }
  };
}

function lazyValidator(opts: PageMarksOptions): () => Validator {
  let built: Validator | undefined;
  return () => (opts.validator instanceof Validator ? opts.validator : (built ??= opts.validator()));
}

/** The page's schema set, or undefined when it cannot be resolved. */
function pageRefs(
  opts: PageMarksOptions,
  label: string,
  probe: Readonly<Record<string, unknown>>,
  memberOf: readonly string[],
): string[] | undefined {
  try {
    return resolveSchemaSetWithSource({
      filePath: label,
      fileSchema: probe[FILE_SCHEMA_KEY],
      ...(opts.cliSchemas !== undefined ? { cliSchemas: [...opts.cliSchemas] } : {}),
      config: opts.config,
      memberOf: opts.memberOf?.(label) ?? memberOf,
      fileBase: opts.cwd,
      trustRoot: opts.trustRoot,
    }).schemas;
  } catch (err) {
    if (err instanceof DocmetaError) return undefined;
    throw err;
  }
}

/**
 * A validator for a command that validates nothing (`get`, `schemas`, `cite`),
 * built the way `validate` builds its own, for `pageMarks` to build on first
 * use.
 */
export function marksValidator(opts: {
  config: DocmetaConfig | null;
  cwd: string;
  configDir?: string;
  offline?: boolean;
}): () => Validator {
  return () =>
    new Validator(
      schemaLoadOptions({
        root: opts.configDir ?? opts.cwd,
        fileBase: opts.cwd,
        ttlHours: opts.config?.schemaCache?.ttlHours,
        offline: opts.offline ?? opts.config?.offline,
        pins: collectSchemaPins(opts.config),
      }),
    );
}

/**
 * `pageMarks` for a sibling tool (`cite`, `key rotate`) that holds the family
 * file but not meta's config: meta's section is read from `configPath` and
 * rebased the way `resolveRunConfig` rebases it. `undefined` when the file has
 * none to read.
 */
export async function configMarks(configPath: string, cwd: string): Promise<PageMarks | undefined> {
  const loaded = await loadConfig(configPath, cwd);
  if (loaded === null) return undefined;
  const config = rebaseConfigSchemaRefs(loaded.config, loaded.dir, cwd);
  return pageMarks({
    validator: marksValidator({ config, cwd, configDir: loaded.dir }),
    config,
    cwd,
    trustRoot: schemaTrustRoot(cwd, loaded.dir),
  });
}
