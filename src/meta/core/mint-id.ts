/**
 * Minting a page's `id` (proposal 0126): what a writer does before it puts a
 * value in an `{id}` manifest for a page that carries no id.
 *
 * The id is a frozen slug of the page's path, minted once and never
 * rewritten, so a later rename leaves it, and the manifest it names, where
 * they are:
 *  1. The path is measured from a base: the literal prefix (picomatch `scan`)
 *     of the first `paths:` entry that claims the page, of the first
 *     collection in config order that does. A plain file entry's base is its
 *     directory, and the `default` collection's is the config directory.
 *  2. The extension goes, and so does a trailing `/index`. A page that is its
 *     base's own index takes the base's last segment, or `index` at the
 *     config directory.
 *  3. Lowercased, each run of characters outside `a-z0-9` becomes `-`, and
 *     `-` is trimmed. Nothing left is `page`.
 *  4. A slug another page carries, one already minted for a page before it,
 *     or one whose `<dir>/<slug>.yaml` exists takes `-2`, `-3`, and so on.
 *
 * Step 4 reads the id of every page of every collection that reads the
 * directory first, and assigns every page that has none in sorted path
 * order. So a run that mints for one page mints what a run over the whole
 * corpus would, whichever order its writer reached the pages in.
 *
 * A writer does not mint, and the value stays in the page, when the page's
 * schemas reject `id`, when a schema other than `manni:core` gives `id` a
 * meaning of its own, or when the format's writer cannot write the page.
 * Writing is the format's own `apply`, as every other page write is.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, posix, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import {
  isMember,
  matchesCollectionPaths,
  type CollectionConfig,
} from "../../shared/collections.js";
import { errorMessage } from "../../shared/errors.js";
import { isMissing } from "../../shared/manifest-cas.js";
import { idManifestPath, isSafeManifestId, normalizeManifestPattern } from "../../shared/page-manifest.js";
import { DocmetaError, type FieldError, type MetadataExtractor } from "../types.js";
import { extractorByName, extractorForExtension } from "../extractors/index.js";
import { deepEqual } from "../extractors/patch-util.js";
import { memberOf } from "./collections.js";
import { schemaTrustRoot } from "./config.js";
import { manifestIdOf } from "./external-metadata.js";
import { gitignoreOptions, resolveTargetSet, STDIN_LABEL } from "./load-files.js";
import { FILE_SCHEMA_KEY, resolveElements, resolveSchemaSetWithSource } from "./resolve-schema.js";
import type { RelocationContext } from "./relocation.js";

/** The page field an `{id}` manifest is named and keyed by. */
const ID = "id";

/** A minted id, and the page's text with it written in. */
export interface MintedId {
  id: string;
  text: string;
}

/** What minting gives a writer: an id, or why there is none. */
export type MintOutcome = { minted: string; text: string } | { stay: string };

/** One `{id}` manifest pattern, and the collections that read it. */
export interface MintRequest {
  /** The page, as the run labels it. */
  label: string;
  /** The `{id}` pattern as the config writes it, resolved from `configDir`. */
  pattern: string;
  configDir: string;
  /** Every collection that reads the pattern: each one's pages may carry an id. */
  readers: readonly CollectionConfig[];
  /** Every declared collection, in config order, for the base of step 1. */
  collections: readonly CollectionConfig[];
}

/** The notice a writer prints once it has written a minted id into a page. Without the prefix. */
export function mintedNotice(label: string, id: string, file: string): string {
  return `minted id "${id}" in ${label}, for ${file}.`;
}

/** The notice for a value that stays in the page because no id could be minted. Without the prefix. */
export function mintStayNotice(label: string, key: string, reason: string): string {
  return `${label}: no id could be minted (${reason}), so ${key} stays in the page.`;
}

const toPosix = (p: string): string => p.split(sep).join("/");

/** A `paths:` entry as a posix path with no `./` prefix and no trailing `/`, as `isMember` reads one. */
function normalizeEntry(entry: string): string {
  const forward = entry.replace(/\\/g, "/").replace(/^\.\//, "");
  return forward.endsWith("/") ? forward.slice(0, -1) : forward;
}

/**
 * Step 1: the directory a page's slug is measured from, posix and relative
 * to the config directory, `""` for the config directory itself. `rel` is
 * the page from the config directory. `collections` in config order.
 */
export function slugBase(collections: readonly CollectionConfig[], rel: string): string {
  const collection = collections.find((c) => isMember(c, rel));
  if (collection === undefined || collection.name === "default") return "";
  for (const entry of collection.paths) {
    if (!matchesCollectionPaths({ ...collection, paths: [entry], exclude: [] }, rel)) continue;
    const normalized = normalizeEntry(entry);
    const scanned = picomatch.scan(normalized);
    if (scanned.isGlob) return scanned.base;
    // A plain entry is a file the page is, or a directory it is under.
    if (normalized !== rel) return normalized;
    const dir = posix.dirname(normalized);
    return dir === "." ? "" : dir;
  }
  return "";
}

/** Steps 2 and 3: the slug of `rel`, a page measured from `base` (both posix, from the config directory). */
export function frozenSlug(rel: string, base: string): string {
  let path = base !== "" && rel.startsWith(`${base}/`) ? rel.slice(base.length + 1) : rel;
  const ext = posix.extname(path);
  if (ext !== "") path = path.slice(0, -ext.length);
  if (path === "index") path = base === "" ? "index" : posix.basename(base);
  else if (path.endsWith("/index")) path = path.slice(0, -"/index".length);
  const slug = path
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "page" : slug;
}

/** Every id the pages reading one directory carry, and the slug each page with none is given. */
interface IdScan {
  carried: Set<string>;
  /** Page (absolute) to its slug, for every page with no id. */
  assigned: Map<string, string>;
  /** Every slug `assigned` holds. */
  minted: Set<string>;
  pattern: string;
  configDir: string;
  collections: readonly CollectionConfig[];
}

/** One run's scans and outcomes, kept beside its context so a run reads each page once. */
interface MintCache {
  scans: Map<string, Promise<IdScan>>;
  outcomes: Map<string, Promise<MintOutcome>>;
}

const caches = new WeakMap<RelocationContext, MintCache>();

function cacheOf(ctx: RelocationContext): MintCache {
  let cache = caches.get(ctx);
  if (cache === undefined) {
    cache = { scans: new Map(), outcomes: new Map() };
    caches.set(ctx, cache);
  }
  return cache;
}

/** The next free slug for `rel`: step 4 over what `scan` already holds. Held in `scan` when `claim`. */
function assign(scan: IdScan, abs: string, rel: string, claim = true): string {
  const have = scan.assigned.get(abs);
  if (have !== undefined) return have;
  const slug = frozenSlug(rel, slugBase(scan.collections, rel));
  // A Windows device name passes core-strict but names no file, so it is taken too.
  const taken = (s: string): boolean =>
    !isSafeManifestId(s) ||
    scan.carried.has(s) ||
    scan.minted.has(s) ||
    existsSync(idManifestPath(scan.pattern, scan.configDir, s).abs);
  let candidate = slug;
  for (let n = 2; taken(candidate); n++) candidate = `${slug}-${String(n)}`;
  if (claim) {
    scan.assigned.set(abs, candidate);
    scan.minted.add(candidate);
  }
  return candidate;
}

/**
 * Read the id of every page of `readers`, then assign every page with none
 * its slug, in sorted path order. A page that will not read is neither: its
 * id is unknown, and it is not one this scan mints for.
 */
async function scanIds(ctx: RelocationContext, request: MintRequest): Promise<IdScan> {
  const { configDir } = request;
  const pages = new Map<string, string>();
  for (const reader of request.readers) {
    const walked = await resolveTargetSet({
      inputs: [...reader.paths],
      cwd: configDir,
      allowEmpty: true,
      ...gitignoreOptions({
        ...(ctx.respectGitignore !== undefined ? { flag: ctx.respectGitignore } : {}),
        ...(ctx.config?.respectGitignore !== undefined ? { configured: ctx.config.respectGitignore } : {}),
      }),
    });
    for (const file of walked.files) {
      const abs = resolve(configDir, file);
      const rel = toPosix(relative(configDir, abs));
      if (isMember(reader, rel)) pages.set(abs, rel);
    }
  }
  const scan: IdScan = {
    carried: new Set(),
    assigned: new Map(),
    minted: new Set(),
    pattern: request.pattern,
    configDir,
    collections: request.collections,
  };
  const sorted = [...pages].sort(([, a], [, b]) => (a < b ? -1 : a > b ? 1 : 0));
  const idless: [string, string][] = [];
  for (const [abs, rel] of sorted) {
    const extractor = extractorForExtension(extname(abs));
    if (extractor === undefined) continue;
    const label = toPosix(relative(ctx.base, abs));
    let data: Record<string, unknown>;
    try {
      const content = await readFile(abs, "utf8");
      const elements = resolveElements(label, ctx.config, memberOf(request.collections, configDir, ctx.base, label));
      data = extractor.extract(content, label, { elements }).data;
    } catch {
      continue;
    }
    const own = manifestIdOf(data[ID]);
    if (own === undefined) idless.push([abs, rel]);
    else if ("id" in own) scan.carried.add(own.id);
  }
  for (const [abs, rel] of idless) assign(scan, abs, rel);
  return scan;
}

/** The first line of a writer's refusal, without its closing period, to sit inside a sentence. */
function reasonOf(err: unknown): string {
  return (errorMessage(err).split("\n")[0] ?? "").replace(/[.:\s]+$/, "");
}

/** Does `withId` hold a finding `without` does not? Compared as multisets, by identity. */
function addsFindings(without: readonly FieldError[], withId: readonly FieldError[]): boolean {
  const identity = (e: FieldError): string =>
    JSON.stringify([e.schema, e.instancePath, e.keyword, e.subject ?? null, e.message]);
  const before = new Map<string, number>();
  for (const e of without) before.set(identity(e), (before.get(identity(e)) ?? 0) + 1);
  for (const e of withId) {
    const left = before.get(identity(e)) ?? 0;
    if (left === 0) return true;
    before.set(identity(e), left - 1);
  }
  return false;
}

/** The core vocabulary and its overlay, the schemas whose `id` is the one 0126 mints. */
const CORE_ID = /^manni:core(?:-strict)?:/;

/**
 * Mint an id for the page `label`, or say why none can be minted. Reads the
 * page from disk; a page not there yet (an INSERT's) is minted into an
 * empty one. One answer per page per run, whichever writer asks.
 *
 * The page must carry no id: the caller checks first, and reads a page that
 * carries one through `manifestIdOf`.
 */
export function mintId(ctx: RelocationContext, request: MintRequest): Promise<MintOutcome> {
  const cache = cacheOf(ctx);
  const key = JSON.stringify([request.label, resolve(request.configDir, normalizeManifestPattern(request.pattern))]);
  let outcome = cache.outcomes.get(key);
  if (outcome === undefined) {
    outcome = decide(ctx, request, cache);
    cache.outcomes.set(key, outcome);
  }
  return outcome;
}

async function decide(ctx: RelocationContext, request: MintRequest, cache: MintCache): Promise<MintOutcome> {
  const { label, configDir } = request;
  const unwritable = (why: string): MintOutcome => ({ stay: `the page cannot be written: ${why}` });
  if (label === STDIN_LABEL) return unwritable("stdin is not a document on disk");
  const abs = resolve(ctx.base, label);
  const forced = ctx.as !== undefined ? extractorByName(ctx.as) : undefined;
  const extractor: MetadataExtractor | undefined = forced ?? extractorForExtension(extname(label));
  if (extractor === undefined) return unwritable(`"${extname(label)}" is not a format manni reads`);
  let content: string;
  try {
    content = await readFile(abs, "utf8");
  } catch (err) {
    if (!isMissing(err)) return unwritable(reasonOf(err));
    content = "";
  }
  const members = memberOf(request.collections, configDir, ctx.base, label);
  const elements = resolveElements(label, ctx.config, members);
  let data: Record<string, unknown>;
  try {
    data = extractor.extract(content, label, { elements }).data;
  } catch (err) {
    return unwritable(reasonOf(err));
  }

  const scanKey = JSON.stringify([
    resolve(configDir, normalizeManifestPattern(request.pattern)),
    request.readers.map((c) => c.name),
  ]);
  let scanning = cache.scans.get(scanKey);
  if (scanning === undefined) {
    scanning = scanIds(ctx, request);
    cache.scans.set(scanKey, scanning);
  }
  // Claimed only once every check below passes, so a page the scan skipped
  // that stays holds no slug from the page after it.
  const scan = await scanning;
  const rel = toPosix(relative(configDir, abs));
  const slug = assign(scan, abs, rel, false);

  // (a) and (b): what the page's schemas make of an id.
  const refs = resolveSchemaSetWithSource({
    filePath: label,
    fileSchema: data[FILE_SCHEMA_KEY],
    ...(ctx.cliSchemas !== undefined ? { cliSchemas: [...ctx.cliSchemas] } : {}),
    config: ctx.config,
    memberOf: members,
    fileBase: ctx.cwd,
    trustRoot: schemaTrustRoot(ctx.cwd, ctx.configDir),
    ...(ctx.onNotice !== undefined ? { onNotice: ctx.onNotice } : {}),
  }).schemas;
  const none = (): undefined => undefined;
  const without = await ctx.validator.validate(data, refs, none);
  const withId = await ctx.validator.validate({ ...data, [ID]: slug }, refs, none);
  if (addsFindings(without, withId)) return { stay: "its schemas do not allow id" };
  for (const ref of refs) {
    if (CORE_ID.test(ref)) continue;
    if ((await ctx.validator.claimedProperties([ref])).has(ID)) {
      return { stay: `${ref} gives id a meaning of its own; set one by hand` };
    }
  }

  // (c): the format's own writer, read back.
  const apply = extractor.apply;
  if (typeof apply !== "function") return unwritable(`the ${extractor.name} format cannot write this document's metadata`);
  let text: string;
  try {
    text = apply(content, { [ID]: slug }, { filePath: label, elements });
    if (!deepEqual(extractor.extract(text, label, { elements }).data[ID], slug)) {
      return unwritable(`the ${extractor.name} writer did not keep the id`);
    }
  } catch (err) {
    if (!(err instanceof DocmetaError)) throw err;
    return unwritable(reasonOf(err));
  }
  // Another page minted while this one was checked, and took the slug: check again.
  if (assign(scan, abs, rel, false) !== slug) return decide(ctx, request, cache);
  assign(scan, abs, rel);
  return { minted: slug, text };
}
