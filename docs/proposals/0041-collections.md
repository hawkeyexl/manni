# 0041: `collections:`, the family-level home for document sets and their external metadata

- **Status:** Implemented
- **Serves:** Maya · M1, M2 · Devin · D1, D4 · Sara · S1
- **Depends on:** Four earlier proposals.
  - [0033](0033-manni-monorepo.md) put every tool's config in one file, one
    top-level key per tool. This proposal adds the one key that is nobody's.
  - [0037](0037-sidecar-metadata.md), [0038](0038-sidecar-url-manifests.md)
    and [0039](0039-sidecar-join.md) define the manifest, its URL form and its
    field join. Every rule they set survives here under a new name and in a
    new place.
  - [0027](0027-named-collections.md) gave override groups names and made them
    SQL views, and recorded `--collection <name>` as the follow-up it did not
    design. This proposal supersedes 0027: the views now come from the
    collections defined here, and the flag is designed.
  - [0004](0004-config-upward-discovery.md) makes config paths resolve from the
    config file's directory. A collection's globs resolve the same way.
- **Relates to:** [0005](0005-command-parity.md) and
  [0034](0034-command-grammar.md), whose parity and separator rules the new
  flag follows; [0014](0014-empty-input-is-not-success.md), for the empty
  collection; [0020](0020-element-metadata.md) and
  [0015](0015-schema-trust-boundary.md), whose no-tiebreak and no-schema rules
  carry over unchanged; [0026](0026-corpus-checks-are-findings.md), whose
  `scoped` invariant decides when an orphan check runs.
- **Supersedes:** [0027](0027-named-collections.md). The `name:` key on
  `overrides[]` is removed; a collection is the thing that has a name.
- **Touches (planned):** `src/shared/{config-file,collections,globs}.ts`,
  `src/meta/core/{config,collections,external-metadata,external-metadata-fetch,load-files,resolve-schema,schema-registry}.ts`,
  `src/meta/commands/{validate,get,query,fill,schemas}.ts`, `src/meta/cli.ts`,
  `src/a11y/{cli,core/config,commands/check}.ts`,
  `src/meta/index.ts`, `src/meta/reporters/{rule-id,sarif}.ts`, `action.yml`,
  `manni.config.yaml`, `reference/{configuration,cli,api,action,output-and-exit-codes,query}.mdx`,
  `set-up/{config,external-metadata}.mdx` (the latter renamed from
  `sidecar-metadata.mdx`), `docs/astro.config.mjs` (one redirect),
  `docs/content-strategy/information-architecture.md`,
  `test/{collections,external-metadata,external-metadata-join,external-metadata-fetch,config,config-file,query-collections,cli.integration}.test.ts`,
  `test/fixtures/{collections,external-metadata,external-metadata-join}/`

## Problem

Two problems, one cause.

**The document set is declared per tool.** `meta.paths` and `meta.exclude` say
which files the metadata tool reads. The docevals branch declares the same set
again as `docevals.files.include` and `docevals.files.exclude`, with different
key names and a different default. Every document tool that lands will declare
it a third and fourth time. A repository with three tools will spell one glob
three ways, and the day the docs move, two of the three go quietly stale. 0033
made one file so that a user learns one place. It left the *content* of that
place per tool, which was right for keys that are one tool's business
(`schemas`, `severity`, `judge`) and wrong for the one key every document tool
must agree on.

**The private half of the metadata is declared under `meta:` too.** 0037's
manifests supply frontmatter values that live outside the document. That is a
fact about the documents, not about the validator. docevals evaluating a page
needs the page's `owner:` whether it came from the frontmatter or a manifest,
and today it would have to read `meta.sidecars` to find out.

And the word. `sidecars` names a file-layout pattern, which a docs engineer
does not recognise. In review, the feature had to be explained before its
config key made sense. The key should say what the feature does: keep some
metadata outside the document.

## Design

A **collection** is a named set of documents, declared once at the top level of
`manni.config.yaml`, read by every tool that operates on documents. It carries
the globs that select its files, the globs that exclude them, and the external
metadata joined to them.

```yaml
# manni.config.yaml
collections:
  - name: guides
    paths: ["docs/guides/**/*.md"]
    exclude: ["docs/guides/drafts/**"]
    externalMetadata:
      - file: ./guides-meta.yaml
        keys: [source, jira]
        join: id
    url: https://docs.example.com/guides/
  - name: blog
    paths: ["blog/**/*.{md,mdx}"]
    url: https://docs.example.com/blog/

meta:
  overrides:
    - collection: guides
      schemas: [./schemas/guide.json]
    - collection: blog
      schemas: [./schemas/post.json]

docevals:
  # its own keys; the documents come from collections

a11y:
  severity: warning
  # urls: is now optional — the collections' url: is the fallback
```

Everything a tool previously took from `meta.paths`, `meta.exclude` and
`meta.sidecars` it now takes from `collections:`. The metadata tool's section
keeps what is the validator's business: schemas, overrides, checks, baseline,
trust, cache, `fill` defaults.

### The rules

1. **One declaration, every tool.** `collections:` is a top-level key of the
   family file, parsed once in `src/shared/`, and handed to every tool beside
   its own section. A tool section never carries `paths`, `exclude` or
   `externalMetadata`. The metadata tool refuses those keys under `meta:` with
   a message that says where they went. That is the umbrella's rule for a
   moved command, applied to a moved key. It is not an alias.
2. **A run with no paths is every collection.** `manni meta validate` with no
   positional paths reads every collection, in declaration order. That is
   today's `paths:` fallback with a list where there was one entry.
   `--collection <name>` narrows the run to the named collections. It is
   repeatable, one name per occurrence, and never splits on commas (0034).
3. **A positional path is a file the operator chose.** It is loaded whether or
   not any collection contains it. A collection's `exclude` defines the
   collection's membership; it does not filter a file named on the command
   line. Only `--exclude` does that. This changes today's behaviour, where
   `meta.exclude` was merged into every run, and the stress test records why.
4. **Membership is what external metadata attaches to.** A loaded file is a
   member of a collection when, relative to the config file's directory, it
   matches one of the collection's `paths` and none of its `exclude`. Whether
   the file came from the walk or the command line makes no difference. A
   member of `guides` gets `guides`' manifests merged; a positional file that
   is a member of no collection gets none. 0037 rules 1, 2, 5 and 6 apply to
   each manifest exactly as written.
5. **Ownership is disjoint within a collection, and never ambiguous across
   them.** The config parser asserts that two manifests of one collection own
   no key in common, as 0037 does across `sidecars[]`. Two collections may each
   own the same key: `guides` and `blog` can both have a manifest supplying
   `owner`. If one loaded file is a member of both, and both own a key, that
   run is exit 2, naming the file, the key and both collections. A precedence
   rule would be a tiebreak, and 0020 and 0037 refuse tiebreaks.
6. **The orphan check is per collection, when that collection is in the run.**
   0037 rule 4 says an entry naming a document the run did not load is exit 2,
   checked only when the run is the config corpus. The corpus is now each
   collection. The check runs for a collection when the run had no positional
   paths, or `--collection` named it. A positional path skips it, as today.
7. **Every collection is a view.** `manni meta query` exposes each collection
   as a read-only SQL view of its name over `docs`, holding the collection's
   members the run loaded. 0027 built views from override groups that won
   schema resolution, so views were disjoint. These are built from membership,
   so two collections may overlap, and `FROM guides` means "the files the
   guides collection selects", which is what the config says it means.
8. **An override may name a collection instead of globs.** `overrides[]`
   carries exactly one of `files:` (globs, as today) or `collection:` (a name).
   Resolution is unchanged: first match wins, and a `collection:` override
   matches the collection's members. `overrides[].name` is removed with 0027.
9. **The walk happens once; membership is decided after it.** A run resolves
   its targets in one pass over the selected collections' `paths`, with the
   family-wide ignores and `--exclude` applied, and then keeps a file when it
   is a member of a selected collection. A collection's own `exclude` acts only
   through membership. That is what makes rule 3 implementable: a positional
   directory is walked the same way, and every expanded file is tested for
   membership individually, so `docs/` picks up the manifests of whichever
   collections its files belong to without any collection's exclusions
   silencing a file the operator named.
10. **Membership is path arithmetic, not a filesystem question.** A label is
    made relative to the config file's directory in posix form and compared:
    an entry containing glob metacharacters is matched as a glob, and any other
    entry matches itself and everything beneath it, which is how a bare
    directory and a bare filename both work. A path outside the config
    directory and stdin are members of nothing. No `stat` is involved, so
    membership costs nothing per file and cannot fail.
11. **Corpus checks see the whole corpus or nothing.** `checks:` (0026) are
    SQL over the projection, and a run narrowed by `--collection` would leave
    every unselected collection's view empty, so a `FROM blog` check would pass
    by having nothing to fail on. `--collection` therefore skips the checks
    with a notice on stderr rather than running them against a subset. Every
    declared collection still gets its view, empty or not, so a query naming
    one is never a SQL error.
12. **A collection may say where it is published.** `url:` is the site root the
    collection's documents appear at, and it is what `manni a11y check` checks
    when it is given no URLs of its own. Seeds are decided in one order, first
    non-empty winning: positional URLs; the `url` of each collection named by
    `--collection`; `a11y.urls`; the `url` of every declared collection that
    has one. `a11y.urls` stays, because a site has entry points that are not a
    documentation collection, and because nothing that ships today should have
    to move. A collection with no `url` contributes nothing, and is an error
    only when `--collection` named it.

### What moves where

| Concern | Was | Becomes |
|---|---|---|
| Declaring which documents exist | `src/meta/core/config.ts` (`paths`, `exclude`) | `src/shared/collections.ts` (`parseCollections`) |
| Declaring external metadata | `src/meta/core/config.ts` (`parseSidecars`) | `src/shared/collections.ts`, inside each collection |
| Deciding whether a file is in a set | `src/meta/core/resolve-schema.ts` (`matchesFileGlob`) | `src/shared/globs.ts`, called by `isMember` and by resolution |
| Handing a tool its config | `src/shared/config-file.ts` (one slice) | The same, plus `collections` on every `ConfigFile` |
| Walking a set to files | `src/meta/core/load-files.ts` | Unchanged. A later tool calls it through `../meta/index.js`, as it already does for extraction |
| Loading and merging a manifest | `src/meta/core/sidecars.ts` | `src/meta/core/external-metadata.ts`, same functions renamed. Extraction is the metadata tool's, so the merge stays beside it |
| Fetching a URL manifest | `src/meta/core/sidecar-fetch.ts` | `src/meta/core/external-metadata-fetch.ts`; the parse-time URL check moves to shared, because the parser needs it |
| Building query views | `src/meta/core/collections.ts` from `overrides[].name` | The same file, from `CollectionConfig[]` |

The split is deliberate. The *declaration* is shared because every tool reads
it. The *loading* stays with the metadata tool because it produces
`ExtractedMetadata`, which is that tool's type. docevals and tracevals import
the metadata library by relative path today, and `loadExternalMetadata` is one
more export on that path.

### Discovery

0033's walk stops at the first family file carrying the tool's key. A
repository whose family file has `collections:` and no `meta:` must still be
the metadata tool's config, or `manni meta validate` there would find nothing.
So the rule becomes: a family file is a tool's config when it carries the
tool's key **or** `collections:`. A file with `collections:` alone hands the
tool an empty section and the collections. The legacy per-tool files
(`docmeta.config.yaml`) are one section with no wrapper, so they carry no
collections; a legacy file that still says `paths:` is refused with the same
message as `meta.paths` (rule 1), which is how a user learns to migrate.

## Interface

### Config

Top level of `manni.config.yaml`:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `collections` | `Collection[]` | no | The document sets every tool reads. Absent means no configured documents, exactly as an absent `paths:` did. An explicit empty list is a config error (0014). |
| `collections[].name` | `string` | yes | The collection's name: what `--collection`, `overrides[].collection` and `FROM <name>` refer to. Non-blank, unique case-insensitively, not `docs`, not `sqlite_*` (0027's view-name refusals, unchanged). |
| `collections[].paths` | `string[]` | yes | Files, directories or globs, relative to the config file's directory. Non-empty list of non-empty strings. |
| `collections[].exclude` | `string[]` | no | Globs that remove files from `paths`, same base. Default `[]`. `**/node_modules/**` and `**/.git/**` are always excluded, family-wide. |
| `collections[].url` | `string` | no | Where the collection is published: one `http:` or `https:` root. `manni a11y check` seeds from it when it is given no URLs of its own. Anything else is a config error. |
| `collections[].externalMetadata` | `ExternalMetadata[]` | no | Manifests joined to this collection's members. Default `[]`. An explicit `[]` is accepted, as is an explicit `exclude: []`; only `collections: []` is refused. |
| `collections[].externalMetadata[].file` | `string` | yes | Manifest path relative to the config file's directory, or an `https://` URL (0038). |
| `collections[].externalMetadata[].keys` | `string[]` | yes | The top-level keys this manifest owns. Non-empty, unique, disjoint across this collection's manifests, never `$schema`. |
| `collections[].externalMetadata[].tokenEnv` | `string` | no | Environment variable holding a bearer token for a URL `file` (0038). Refused on a path. |
| `collections[].externalMetadata[].join` | `string` | no | `path` (default) or a top-level field the manifest's keys name (0039). Never `$schema`, never a key this entry owns. |

Under `meta:`:

| Key | Change |
|---|---|
| `paths` | Removed. Refused with: `manni.config.yaml: "paths" is no longer a meta key. Document sets are declared once for every tool, under a top-level collections: list. See <configuration reference>#collections.` |
| `exclude` | Removed. Same message, naming `exclude`. |
| `sidecars` | Removed. Refused with: `manni.config.yaml: "sidecars" is no longer a meta key. It is externalMetadata on a collection, under the top-level collections: list. See <configuration reference>#external-metadata.` |
| `overrides[].name` | Removed. Refused with: `manni.config.yaml: overrides[0] no longer carries "name". Define a collection with that name and point the override at it with collection:.` |
| `overrides[].collection` | New, `string`, optional. Exactly one of `files` or `collection` per entry. Must name a defined collection: `manni.config.yaml: overrides[0].collection names "gides", which collections: does not define. Defined: guides, blog.` |

Everything else under `meta:` is unchanged. `a11y:` is unchanged; it takes
URLs, not documents.

Parse errors for `collections:` follow the metadata tool's existing shapes, so
`withSection` needs no new case:

```
manni.config.yaml: "collections" must be a list.
manni.config.yaml: "collections" must name at least one collection; remove the key if there are none.
manni.config.yaml: collections[0] must be a mapping.
manni.config.yaml: collections[0] has unknown key "path". Supported keys: name, paths, exclude, externalMetadata.
manni.config.yaml: collections[0].name must be a non-empty string.
manni.config.yaml: collections[1].name "Guides" is already taken by collections[0]; names are compared case-insensitively because they become SQL views.
manni.config.yaml: collections[0].name "docs" collides with the docs table every query reads. Pick another name.
manni.config.yaml: collections[0].name "sqlite_x" starts with "sqlite_", which SQLite reserves for its own objects. Pick another name.
manni.config.yaml: collections[0].paths must be a non-empty list of files, directories or globs.
manni.config.yaml: collections[0].exclude must be a list of globs.
manni.config.yaml: collections[0].url must be an http(s) URL.
manni.config.yaml: collections[0].externalMetadata must be a list.
manni.config.yaml: collections[0].externalMetadata[1].keys claims "jira", which externalMetadata[0] already owns — a key has exactly one manifest in a collection.
```

The remaining `externalMetadata[]` messages are 0037's, 0038's and 0039's
`sidecars[i].<key>` messages with the path rewritten to
`collections[c].externalMetadata[i].<key>` and the word "sidecar" replaced by
"manifest".

Two details about how these print. `collections:` is a top-level key, so its
messages are never prefixed with a section name; the metadata tool's habit of
rewriting `"paths"` into `"meta.paths"` for a discovered family file must not
apply to them, nor to the four moved-key refusals, which name `meta` in their
own prose already. And `overrides[].collection` can only be checked once the
collections are known, which is after both halves of the file are parsed, so
that refusal arrives from the loader rather than the section parser while still
naming `overrides[0].collection` as its path.

### Types

`src/shared/collections.ts`, new:

```ts
/** One external-metadata manifest (0037, 0038, 0039) joined to a collection. */
export interface ExternalMetadataConfig {
  file: string;
  keys: string[];
  tokenEnv?: string;
  join?: string;
}

/** One named document set, as declared under `collections:`. */
export interface CollectionConfig {
  name: string;
  paths: string[];
  exclude: string[];
  externalMetadata: ExternalMetadataConfig[];
  /** Where the collection is published; `a11y check` seeds from it (rule 12). */
  url?: string;
}

/** Parse the top-level `collections:` value. Errors are built with `toError`. */
export function parseCollections(
  raw: unknown,
  source: string,
  toError: (message: string) => Error,
): CollectionConfig[];

/**
 * The collections a run covers: every one when `names` is undefined, else
 * the named ones in declaration order. An unknown name is an error:
 * `no collection named "x" in manni.config.yaml. Configured: guides, blog.`
 */
export function selectCollections(
  collections: readonly CollectionConfig[],
  names: readonly string[] | undefined,
  source: string,
  toError: (message: string) => Error,
): CollectionConfig[];

/**
 * Whether a file belongs to a collection. `relPath` is posix, relative to
 * the config file's directory. A `paths` entry that is a directory matches
 * everything beneath it; a file matches itself; a glob matches as picomatch
 * says. Any `exclude` match removes membership.
 */
export function isMember(collection: CollectionConfig, relPath: string): boolean;

/** Why a manifest URL may not be used, or `null`. Was `sidecarUrlProblem`. */
export function externalMetadataUrlProblem(url: string): string | null;
```

`src/shared/globs.ts`, new: `matchesFileGlob(relPath: string, glob: string | readonly string[]): boolean`,
moved from `src/meta/core/resolve-schema.ts` unchanged, so membership and
override resolution use one matcher.

`src/shared/config-file.ts`:

```ts
export interface ConfigFile {
  path: string;
  dir: string;
  source: string;
  text: string;
  value: unknown;
  wrapped: boolean;
  kind: "manni" | "moose" | "legacy" | "explicit";
  /** Parsed top-level `collections:`; `[]` when absent or `kind` is "legacy". */
  collections: CollectionConfig[];          // new
}
```

`findConfigFile` and `readConfigFile` keep their signatures. `findConfigFile`
stops at a family file that has the section key or `collections:`. `slice`
returns `{ value: null, wrapped: true }` for a file that has `collections:` and
no section, so the tool sees an empty section rather than no config.

`src/meta/core/config.ts`:

```ts
export interface DocmetaConfig {
  // paths, exclude, sidecars: removed
  schemas?: SchemaEntry[];
  overrides?: SchemaOverride[];
  checks?: CheckConfig[];
  elements?: string[];
  fill?: FillConfig;
  baseline?: string;
  allowEmpty?: boolean;
  respectGitignore?: boolean;
  schemaCache?: SchemaCacheConfig;
  offline?: boolean;
  schemaTrust?: SchemaTrustConfig;
}

export interface SchemaOverride {
  files?: string | string[];      // exactly one of files, collection
  collection?: string;            // new
  schemas: string[];
  // name: removed
  elements?: string[];
}

export interface LoadedConfig {
  config: DocmetaConfig;
  path: string;
  dir: string;
  section?: string;
  collections: CollectionConfig[];   // new: every declared collection
}

export interface RunConfigOptions {
  cwd?: string;
  configPath?: string;
  noConfig?: boolean;
  inputs: string[];
  collections?: string[];            // new: names from --collection
  onConfigLoaded?: (c: ConfigNotice) => void;
}

export interface RunConfig {
  config: DocmetaConfig | null;
  inputs: string[];                  // positional, or the selected collections' paths
  base: string;                      // config dir when from collections, else cwd
  configDir?: string;
  configPath?: string;
  collections: CollectionConfig[];   // new: the selected collections; [] with no config
  fromCollections: boolean;          // new: true when inputs came from collections
}
```

`resolveRunConfig` keeps its signature. With `opts.inputs` empty it selects
collections by `opts.collections` and concatenates their `paths` as `inputs`,
with `base = loaded.dir`. With `opts.inputs` non-empty and `opts.collections`
set it throws `--collection selects a configured collection; it cannot be
combined with paths.` With `opts.collections` set and no config it throws
`--collection needs a config file to select from.`

`src/meta/core/external-metadata.ts` (was `sidecars.ts`), same functions with
new names and one new parameter:

```ts
export const EXTERNAL_OWNED_SCHEMA = "external:owned";
export const EXTERNAL_DUPLICATE_SCHEMA = "external:duplicate";
export const EXTERNAL_KEYWORD = "external";
export const PATH_JOIN = "path";

export interface LoadExternalMetadataOptions {
  configDir: string;
  base: string;
  offline?: boolean;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

/** Load every manifest of every given collection, once per run. */
export async function loadExternalMetadata(
  collections: readonly CollectionConfig[],
  opts: LoadExternalMetadataOptions,
): Promise<ExternalMetadataIndex | null>;

export interface ExternalMetadataIndex {
  /** Owned key -> { collection, file } as reported. */
  owners: ReadonlyMap<string, readonly { collection: string; file: string }[]>;
  byPath: ReadonlyMap<string, ReadonlyMap<string, ExternalMetadataValue>>;
  byField: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, ExternalMetadataValue>>>;
  entries: readonly ExternalMetadataEntry[];
}

export interface ExternalMetadataEntry {
  collection: string;   // new
  join: string;
  abs?: string;
  spelled: string;
  file: string;
  line?: number;
}

/**
 * Merge the manifests of the collections `label` is a member of. Throws
 * DocmetaError when two of those collections own one key (rule 5).
 */
export function mergeExternalMetadata(
  label: string,
  extracted: ExtractedMetadata,
  index: ExternalMetadataIndex | null,
  memberOf: readonly string[],
  base: string,
): MergedMetadata;

export function externalMetadataJoin(m: Pick<ExternalMetadataConfig, "join">): string;
export function externalMetadataPointer(key: string): string;
export function orphanEntries(index, loaded, base, collections: readonly string[]): ExternalMetadataEntry[];
export function orphanJoins(index, matched, collections: readonly string[]): ExternalMetadataEntry[];
export function orphanError(orphans): DocmetaError;
```

`ExternalMetadataValue`, `ExternalMetadataCollision`, `ExternalMetadataJoin`,
`MergedMetadata` and `SourceLocation` are today's `Sidecar*` shapes renamed and
otherwise unchanged. `src/meta/core/external-metadata-fetch.ts` exports
`fetchExternalMetadata`, `ExternalMetadataFetchOptions`,
`EXTERNAL_METADATA_FETCH_TIMEOUT_MS` and `EXTERNAL_METADATA_FETCH_MAX_BYTES`,
today's fetcher renamed.

`src/meta/core/collections.ts`:

```ts
export interface Collection { name: string; members: string[] }
export function collectionNames(collections: readonly CollectionConfig[]): string[];
export function collectCollections(p: CollectionParams): Collection[];   // membership by isMember, not resolution
export function createCollectionViews(db: DatabaseSync, collections: readonly Collection[]): void;
```

Command options (`ValidateOptions`, `GetOptions`, `QueryOptions`,
`FillOptions`, `InferOptions`) each gain `collections?: string[]`, forwarded to
`resolveRunConfig`. Their no-input errors become, per command verb:

```
No files to validate. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.
```

`src/meta/index.ts` re-exports `CollectionConfig`, `ExternalMetadataConfig`,
`parseCollections`, `selectCollections`, `isMember` and
`externalMetadataUrlProblem` from shared, and every renamed name from the two
`external-metadata*` modules. The full rename:

| Was | Becomes |
|---|---|
| `SidecarConfig` | `ExternalMetadataConfig` (from `src/shared/`) |
| `loadSidecars` / `LoadSidecarsOptions` | `loadExternalMetadata` / `LoadExternalMetadataOptions` |
| `mergeSidecars` | `mergeExternalMetadata` |
| `SidecarIndex` / `SidecarEntry` / `SidecarValue` | `ExternalMetadataIndex` / `ExternalMetadataEntry` / `ExternalMetadataValue` |
| `SidecarCollision` / `SidecarJoin` | `ExternalMetadataCollision` / `ExternalMetadataJoin` |
| `sidecarJoin` / `sidecarPointer` | `externalMetadataJoin` / `externalMetadataPointer` |
| `SIDECAR_OWNED_SCHEMA` / `SIDECAR_DUPLICATE_SCHEMA` / `SIDECAR_KEYWORD` | `EXTERNAL_OWNED_SCHEMA` / `EXTERNAL_DUPLICATE_SCHEMA` / `EXTERNAL_KEYWORD` |
| `fetchSidecar` / `SidecarFetchOptions` / `sidecarUrlProblem` | `fetchExternalMetadata` / `ExternalMetadataFetchOptions` / `externalMetadataUrlProblem` |
| `SIDECAR_FETCH_TIMEOUT_MS` / `SIDECAR_FETCH_MAX_BYTES` | `EXTERNAL_METADATA_FETCH_TIMEOUT_MS` / `EXTERNAL_METADATA_FETCH_MAX_BYTES` |
| `SIDECAR_OWNED_RULE` / `SIDECAR_DUPLICATE_RULE` (reporters) | `EXTERNAL_OWNED_RULE` / `EXTERNAL_DUPLICATE_RULE` |
| `orphanEntries`, `orphanJoins`, `orphanError`, `PATH_JOIN`, `MergedMetadata`, `SourceLocation` | unchanged |

### CLI

One new option on `validate`, `get`, `query`, `fill`, `schemas infer` and
`a11y check`. Not on `schemas vendor`, which reads no documents.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `--collection <name>` | string, repeatable | every collection | Run over the named configured collection. One name per occurrence, never split on commas, repeats deduped, names matched exactly. Cannot be combined with positional paths on a meta command or positional URLs on `a11y check`; `-` (stdin) is allowed beside it on meta. |

Help text, identical on all six: `configured collection to run over; repeatable`.

`a11y check` takes it because rule 12 gives a collection a `url`, so "check the
guides" is now a thing a person can mean. It selects seeds, not documents; when
0036 gives a11y local HTML to fix, the same flag will select the files.

The a11y usage errors:

```
manni: collection "blog" has no url: to check.                                       # exit 2
manni: --collection selects a configured collection; it cannot be combined with URLs. # exit 2
manni: No URLs to check. Pass one or more, set url: on a collection, or set a11y.urls in manni.config.yaml.   # exit 2
```

### Finding identities and output

The two finding identities are renamed with the vocabulary, and the schema
registry reserves `external` as the first segment where it reserved `sidecar`:

| Was | Becomes | Message |
|---|---|---|
| `sidecar:owned/sidecar` | `external:owned/external` | `"jira" is owned by manifest guides-meta.yaml (collection guides); remove it from the document` |
| `sidecar:duplicate/sidecar` | `external:duplicate/external` | `2 documents carry id "auth"; guides-meta.yaml cannot tell them apart (docs/a.md, docs/b.md)` |

Rule 5's cross-collection ambiguity is an operational error, not a finding,
because there is nothing about the document to fix:

```
docs/api/auth.md: "owner" is owned by manifests in two of its collections, guides (guides-meta.yaml) and api (api-meta.yaml); a key has one manifest per file. Narrow one collection's paths or exclude.
```

Baseline fingerprints carry the schema ref, so an existing baseline entry for
either finding stops matching after the upgrade, the finding reappears, and the
run is exit 1 until the baseline is regenerated. That is the one place the
rename costs a user an action, and the release note says so. The alternative,
keeping `sidecar:` in every SARIF `ruleId` after the docs stop using the word,
would make the rule id the only place the old term survives, which is the
exact situation a reader of a SARIF alert is least equipped to decode.

JSON, SARIF, JUnit and pretty output shapes are otherwise unchanged. The
manifest file and line ride the same `file`/`line` fields (0037 rule 5).

The `query` split-set refusal (0024) finally names its remedy:
`the run spans guides (docs/guides/**) and blog (blog/**); re-run with --collection guides`.

### Action

`action.yml` keeps its six inputs. The `paths` description becomes
`Files, directories, or globs to validate. Space-separated, or one per line — use lines for any path containing a space. Defaults to the collections in your config.`
`--collection` reaches the Action through `args`, the documented escape hatch,
and `docs:check-action` sees the description change.

### The ladder

```
$ manni meta validate
blog/2026/hello.mdx ✔
docs/guides/auth.md ✔
2 files, 0 errors                                 # every collection, exit 0

$ manni meta validate --collection guides
docs/guides/auth.md ✔                             # one collection, exit 0

$ manni meta validate --collection guides --collection blog
                                                  # both; the report is sorted by
                                                  # path, so declaration order is
                                                  # not observable here. It decides
                                                  # which paths are walked, and the
                                                  # order of the names in a message.

$ manni meta validate --collection guides,blog
manni: no collection named "guides,blog" in manni.config.yaml. Configured: guides, blog.
                                                  # exit 2. One separator per list
                                                  # (0034): this flag repeats.

$ manni meta validate docs/guides/auth.md
docs/guides/auth.md ✔                             # a member of guides: its manifests merge; no orphan check

$ manni meta validate README.md
README.md ✔                                       # a member of nothing: no manifests, DEFAULT_SCHEMAS

$ manni meta query "SELECT _path FROM guides WHERE jira IS NULL" -f csv
_path
docs/guides/new.md                                # the view is the collection, jira from the manifest

$ manni meta validate -c ci/manni.config.yaml --collection guides --exclude "**/wip/**" --ext md --offline -f sarif > out.sarif
                                                  # everything at once; exit 0 or 1 by findings

$ manni meta validate --collection gides
manni: no collection named "gides" in manni.config.yaml. Configured: guides, blog.
                                                  # exit 2

$ manni meta validate --collection guides docs/x.md
manni: --collection selects a configured collection; it cannot be combined with paths.
                                                  # exit 2

$ manni meta validate --collection guides --no-config
manni: --collection needs a config file to select from.
                                                  # exit 2

$ manni meta validate                             # no collections:, no paths
manni: No files to validate. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.
                                                  # exit 2

$ manni meta validate                             # meta.paths still in the file
manni: manni.config.yaml: "paths" is no longer a meta key. Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections
                                                  # exit 2

$ manni meta validate --collection guides         # with checks: configured
manni: corpus checks skipped: run is scoped to collections guides
                                                  # notice on stderr; exit by findings
```

And a11y, whose seeds come from rule 12:

```
$ manni a11y check                                # a11y.urls if set, else every collection's url
$ manni a11y check --collection guides            # guides.url only
$ manni a11y check https://staging.example.com/   # positional wins over both
$ manni a11y check --collection guides --severity warning --max-pages 50 --tags wcag2a -f json --no-crawl -c ci/manni.config.yaml

$ manni a11y check --collection blog              # blog declares no url
manni: collection "blog" has no url: to check.                                        # exit 2
$ manni a11y check --collection guides https://x.example/
manni: --collection selects a configured collection; it cannot be combined with URLs.  # exit 2
$ manni a11y check                                # nothing anywhere
manni: No URLs to check. Pass one or more, set url: on a collection, or set a11y.urls in manni.config.yaml.
                                                  # exit 2
```

### What the other branches do

- **docevals** replaces `docevals.files.include` / `.exclude` with the
  collections it receives, and gains `--collection <name>` on the commands
  that read documents. Its `files.exclude` default of `**/node_modules/**` is
  now the family-wide exclusion. Its branch also forked
  `src/shared/config-file.ts` into sync variants; those wrap `parseCollections`
  the same way, and rebasing onto this change is the moment to fold the fork.
- **tracevals** takes traces, not documents, and is untouched. Its
  `calibrate.labels` doc comment says "labels sidecar", an unrelated use of the
  word that this proposal does not claim.
- **a11y** gains the `url` seed order of rule 12 and `--collection`, and keeps
  `a11y.urls`. Its config loader passes the collections through; nothing else
  about the crawl, the scope or the scoring changes. It is also affected by the
  discovery rule above: a family file carrying `collections:` and no `a11y:`
  now stops the walk and hands a11y an empty section, where before the walk
  continued upward. That is the intended reading of "one file describes the
  repository", and the alternative was a per-tool opt-in flag on the shared
  loader, which is a second grammar for the same question.

## Options

**A. Leave `meta.paths` and `meta.sidecars` where they are; other tools read
`meta:`.** Rejected. It makes `meta:` the family section under another name,
breaks the shared loader's own contract that a tool reads only its key, and
means the docevals user configures documents under a tool they may not run.

**B. A family section named for the concept (`documents:`) rather than a
list.** Rejected in review. One anonymous set cannot be pointed at, and the
first thing docevals wants is "evaluate the guides, not the blog". A list of
named sets is the shape 0027 already proved out for query, and the flag it
recorded as follow-up is exactly the selector a list needs.

**C. Keep 0027's override-group views beside collection views.** Rejected.
Two things called "collection" in one config, one a subset by resolution
winner and one a set by glob, is worse than either alone. 0027's view exists
so that `FROM authors` reads as the config reads; with a top-level `authors`
collection that is literally true.

**D. Rename the config key but keep `sidecar:owned` as the finding identity.**
Rejected, above. Stability of the rule id is worth a lot, but not a word the
documentation no longer contains.

**E. `external:` or `detached:` as the key name.** `externalMetadata` won for
saying what the values are, not only where they are. `overlay` was rejected
because it implies precedence, which 0037 refuses; `private` because 0038
allows a public URL manifest.

**F. Move `a11y.urls` onto the collection and remove it, as `meta.paths` is
removed.** Rejected, and this is the one asymmetry in the proposal. `paths:` and
`urls:` look like the same kind of key but are not: every document a tool reads
belongs to a collection by construction, while a site has entry points that no
documentation collection covers — a marketing page, a status page, a staging
host. `collections[].url` is therefore a fallback that a shipped `a11y.urls`
beats, and the seed order in rule 12 is the whole of the contract. Nothing
that works today stops working, which is also why `a11y` needs no `feat!:` of
its own.

**G. `urls:` (a list) on the collection instead of `url:`.** Rejected. A
collection is published at one root; several unlinked entry points are what
`a11y.urls` is for, and the crawl reaches the rest from the root anyway.

## Stress test

1. **A file in two collections.** `guides` is `docs/**` and `api` is
   `docs/api/**`. `docs/api/auth.md` is a member of both. It appears in both
   views, resolves schemas by the first override that matches, and merges the
   manifests of both collections. If both own `owner`, exit 2 names the file
   and both collections. Sharper than a precedence rule, and the fix is in the
   config, where the overlap was declared.
2. **Positional paths lose the config `exclude`.** Today `meta.exclude:
   ["**/drafts/**"]` filters `manni meta validate docs/` too. Under rule 3 it
   does not, because `exclude` is now one collection's membership rule and a
   positional directory belongs to no collection as a whole. The reasoning is
   that an operator who types `docs/` chose `docs/`; the tool has no basis to
   pick which collection's exclusions to honour once there are several.
   `--exclude` is the spelling for "and skip these". Recorded as a behaviour
   change in the release note.
3. **The name `docs`.** The most natural name for the main collection is
   refused, because `docs` is the projection table every query reads. The
   error says so and the docs suggest `pages`, `site` or `guides`. Renaming
   the table is a far larger break than the refusal.
4. **Two ownership scopes.** Within a collection, disjoint at parse time;
   across collections, checked per file at run time. A parse-time check across
   collections would forbid the legitimate case of `guides` and `blog` each
   supplying `owner`, so the run-time check is the one that fires only on an
   actual overlap.
5. **Two meanings of `url` in one config.** A collection now has a `url` (where
   its pages are published) and its manifests have a `file` that may be a URL
   (where its private metadata is fetched from). They are unrelated, and a
   reader could take `url:` for the manifest's location. The names stay,
   because `file:` says "the manifest" and `url:` sits at the collection level
   beside `paths:`, which is the level that describes the documents. The
   configuration reference puts them in separate sections and says this.
6. **The docevals defaults.** Its `files.include` defaulted to
   `**/*.{md,mdx}`, so a docevals run with no config evaluated everything
   beneath cwd. `collections:` has no default set, and a run with no
   collections and no paths is exit 2 (0014). docevals inherits that when it
   rebases, which is a behaviour change on its branch and the right one.
7. **`collections: []`.** Refused rather than treated as absent. A user who
   wrote the key meant to fill it; silence here is the 0014 failure mode.
8. **Legacy `docmeta.config.yaml` with `paths:`.** Refused with the rule-1
   message. The legacy filename is already announced as going away in a major
   version, and this is that version.
9. **A version.** `feat!:` on a 0.x package: semantic-release's default rules
   take manni from 0.3.0 to 1.0.0. That is a release-visible decision this
   proposal makes and the reviewer should confirm.
10. **`withSection`.** Messages for `collections:` start with a quoted key or
    with `collections[`, both shapes `withSection` already prefixes, so a
    parse error under a discovered family file reads `manni.config.yaml:
    collections[0].paths …` with no new plumbing.

## Breaking

This is a `feat!:`. What breaks, and what the message says:

- `meta.paths`, `meta.exclude`, `meta.sidecars`, `overrides[].name`: refused,
  each message naming the new location.
- The 24 exported `Sidecar*`/`sidecar*` names: renamed, no aliases, per the
  working agreement.
- The `sidecar:owned/sidecar` and `sidecar:duplicate/sidecar` rule ids:
  renamed; affected baseline entries must be regenerated.
- Config `exclude` no longer filters positional paths.
- Discovery stops at a family file that carries `collections:` and no section
  for the tool being run, where the walk used to continue upward. A repository
  with a `collections:`-only file above a per-tool file below it sees the outer
  one win for the first time. No shipped layout does that, since `collections:`
  is new, but a mid-migration repository could produce it.
- The docs page `meta/set-up/sidecar-metadata` moves to
  `meta/set-up/external-metadata`, with an Astro `redirects` entry for the old
  URL, since the site has none today and an inbound link should not 404.

Not breaking: every 0037, 0038 and 0039 rule about what a manifest may
contain, how it joins, what a violation reports and what refuses to write.
