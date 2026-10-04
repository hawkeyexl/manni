/**
 * A page as `manni meta validate` reads it, for a sibling tool that reads
 * pages without validating them (proposals 0074 and 0051: `manni graph`).
 *
 * Three answers come from one load of meta's section of the run's config:
 *
 *  - the schema set meta resolves for each page, which is where
 *    `x-manni-graph-output` is read from;
 *  - the page's metadata with every key an external-metadata manifest of its
 *    collections owns merged in (proposals 0037, 0041, 0058 and 0068), through
 *    `mergeWithMarks`, the merge every meta command uses;
 *  - where one key of one page is written (proposal 0047), through `keyHome`,
 *    the rule `manni meta fill` follows.
 *
 * `noConfig` is meta's `--no-config`: the default schema set, no collections,
 * and so no manifest. A `{page}` manifest is declared in a collection like any
 * other, so it is not read without a config either, exactly as meta reads it.
 */
import type { ExtractedMetadata } from "../types.js";
import { memberOf } from "./collections.js";
import { loadMetaSection, schemaTrustRoot } from "./config.js";
import { lazyKey } from "./encrypted.js";
import {
  loadExternalMetadata,
  mergeWithMarks,
  type MarkedMerge,
} from "./external-metadata.js";
import {
  marksValidator,
  pageMarks,
  pageSchemaSet,
  type PageMarksOptions,
} from "./page-marks.js";
import { keyHome, type KeyHome, type RelocationContext } from "./relocation.js";
import { rebaseConfigSchemaRefs } from "./resolve-schema.js";
import type { Validator } from "./validator.js";

/** What a sibling run reads a page through. Labels are relative to `cwd`. */
export interface MetaPageView {
  /** Built the way `validate` builds its own, over the same config. */
  validator: Validator;
  /**
   * The set for one page, by `$schema`, override, `schemas:`, `strict` and
   * the default set. Throws a `DocmetaError` when the page's own `$schema` is
   * refused.
   */
  refsFor(label: string, data: Readonly<Record<string, unknown>>): string[];
  /**
   * The page's metadata with every value its manifests supply, merged the
   * way `validate` merges it. A page in no collection, and every page of a
   * run with no manifest, comes back as it went in. Throws a `DocmetaError`
   * for a manifest meta refuses.
   */
  merge(label: string, extracted: ExtractedMetadata): Promise<MarkedMerge>;
  /**
   * Where `key` of the page is written: the owning manifest with the page's
   * entry, a URL manifest, or the page itself (`unowned`). `data` is the
   * page's own metadata, for a field join.
   */
  home(label: string, data: Readonly<Record<string, unknown>>, key: string): Promise<KeyHome>;
}

/**
 * A `MetaPageView` over meta's section of the config a sibling run is under.
 * `configPath` reads meta's section of that file, which a file with no family
 * key does not have. With neither it nor `noConfig`, meta's own discovery
 * finds the config, as `manni meta validate` would.
 *
 * `pages` are the run's documents as absolute paths. A `{page}` manifest
 * (proposal 0058) is read for exactly these.
 */
export async function metaPageView(opts: {
  cwd: string;
  configPath?: string;
  noConfig?: boolean;
  pages?: readonly string[];
}): Promise<MetaPageView> {
  const { cwd } = opts;
  const loaded = opts.noConfig === true ? null : await loadMetaSection(opts.configPath, cwd);
  const config = loaded ? rebaseConfigSchemaRefs(loaded.config, loaded.dir, cwd) : null;
  const configDir = loaded?.dir ?? cwd;
  const collections = loaded?.collections ?? [];
  const validator = marksValidator({
    config,
    cwd,
    ...(loaded ? { configDir: loaded.dir } : {}),
  })();
  const marksOptions: PageMarksOptions = {
    validator,
    config,
    cwd,
    trustRoot: schemaTrustRoot(cwd, loaded?.dir),
  };
  const membersOf = (label: string): string[] => memberOf(collections, configDir, cwd, label);

  const index = await loadExternalMetadata(collections, {
    configDir,
    base: cwd,
    offline: config?.offline ?? false,
    ...(opts.pages === undefined ? {} : { pages: opts.pages }),
  });
  // Only an encrypted join field is decrypted, to match its manifest entry
  // (proposal 0045). Every other value is merged as the page holds it.
  const joinKey = lazyKey(loaded?.configFile, undefined);
  const marks = pageMarks(marksOptions);

  const ctx: RelocationContext = {
    cwd,
    base: cwd,
    noConfig: loaded === null,
    config,
    ...(loaded ? { configDir: loaded.dir, configPath: loaded.path } : {}),
    ...(loaded?.configFile !== undefined ? { configFile: loaded.configFile } : {}),
    collections,
    declaredCollections: collections,
    targets: [],
    validator,
  };

  return {
    validator,
    refsFor: (label, data) => pageSchemaSet(marksOptions, label, data, membersOf(label)),
    merge: (label, extracted) =>
      mergeWithMarks(label, extracted, index, membersOf(label), cwd, {
        encryptionKey: joinKey,
        marks,
      }),
    home: (label, data, key) => keyHome(ctx, label, data, key),
  };
}
