# 0035: sidecar metadata, a private manifest joined to public documents

- **Status:** Implemented
- **Serves:** Maya · M1, M2 · Devin · D1, D4 · Sara · S1
- **Depends on:** Five earlier proposals, one per rule this one relies on.
  - [0004](0004-config-upward-discovery.md) makes paths config-relative. The
    config directory is the one base a manifest's keys resolve from.
  - [0014](0014-empty-input-is-not-success.md) makes a named input that is not
    there an error. That includes a manifest entry naming a document the run
    did not load.
  - [0018](0018-write-support-shipped-for-all-three.md) says a write updates the
    location the value was read from. That is why the first increment refuses
    writes to sidecar keys rather than writing them into the document.
  - [0020](0020-element-metadata.md) validates both channels with no precedence
    tiebreak. A document carrying a sidecar-owned key is a finding.
  - [0026](0026-corpus-checks-are-findings.md) makes a row naming a path outside
    the run exit 2, not a synthetic finding. A corpus invariant is checked only
    when the run is the config corpus.
- **Relates to:** Four proposals this one touches without depending on them.
  - [0006](0006-gitignore-aware-discovery.md) has the multi-root filtering
    defect this proposal fixes first.
  - [0015](0015-schema-trust-boundary.md) says a sidecar never feeds schema
    resolution.
  - [0031](0031-input-formats-notebooks-and-markdoc.md) rejected a standalone
    data file. A manifest is a join table, not that.
  - [0001](0001-validation-baseline.md) is the baseline. The new finding rides
    it unchanged.
- **Touches (planned):** `src/meta/core/{sidecars,gitignore,config,validator}.ts`,
  `src/meta/types.ts`, `src/meta/commands/{validate,get,query,fill,schemas}.ts`,
  `src/meta/reporters/{index,junit,sarif,rule-id}.ts`, `src/meta/index.ts`,
  `reference/{configuration,api,output-and-exit-codes}.mdx`, `test/*`

## Problem

A docs repository is public. Some of the metadata its pages must carry names
things that are not. Examples are the internal design note a guide was written
from, the ticket that tracks it, and the team that owns it. Today that metadata
has two homes, and both are wrong. In the public frontmatter it leaks. In a private
spreadsheet it is never validated, and the whole point of a `jira:` key is that
CI refuses a page without one.

The value belongs in a private repository. The *contract* on it belongs with
the page, in the same schema set, checked by the same `validate` run, reported
with the same exit code. The tool has no way to say that a key of a document
lives in another file.

## Design

A **sidecar** is a YAML manifest, declared in config, that supplies a fixed set
of top-level keys for named documents. Its data is merged into each document's
extracted metadata before schema resolution, so every command sees one object.

```yaml
# private-repo/manni.config.yaml
meta:
  paths: ["public/docs/**/*.md"]        # the public checkout, a submodule here
  sidecars:
    - file: ./docs-meta.yaml
      keys: [source, jira]
  overrides:
    - files: "public/docs/**/*.md"
      schemas: [./schemas/private.json]  # requires `source` and `jira`
```

```yaml
# private-repo/docs-meta.yaml
public/docs/guides/auth.md:
  source: internal/auth-design.md
  jira: PLAT-412
public/docs/guides/billing.md:
  source: internal/billing.md
  jira: PLAT-388
```

The private repository owns the config. The public repository keeps its own
plain config and never mentions a sidecar. That way no public run ever warns
about a private file it cannot see. Running from the private checkout is what
"evaluate against the public docs when both are available" means.

### The rules

1. **Keys are owned.** Each sidecar entry declares the top-level keys it
   supplies. Ownership is disjoint across entries, so two manifests can never
   disagree about one key. A manifest entry supplying a key it does not own is
   an operational error. So is `$schema`, which no sidecar may own (0015: a
   sidecar never picks the schema a document is judged by).
2. **A document carrying an owned key is a finding.** 0020's rule, applied
   across files: neither channel wins, and the discarded value would be exactly
   the one nobody checked. The finding attaches to the document at the key's
   line, with rule id `sidecar:owned/sidecar`. The document's value is what the
   schema sees for that run, so the report shows what the public site would
   publish.
3. **Manifest keys are exact paths, relative to the config's directory.** No
   globs, no cascade. 0004 rejected partial merges of config for the reason
   that a silently merged result changes what the contract means. This
   repository has no specificity metric to borrow either. "Every guide gets X"
   is a follow-up entry form, recorded below, not a manifest feature.
4. **An entry naming a document the run did not load is exit 2.** That follows
   0026 §4 for a check row outside the run and 0014 for a named file that is
   not there. It is checked only when the run is the config corpus, by the same
   `scoped` invariant checks use. A positional path means the operator chose
   to look at part of the corpus, and an entry for the rest is expected.
5. **A sidecar-sourced violation names the sidecar.** The finding's subject
   file stays the document, because that is its baseline identity: the
   fingerprint is keyed by the document and unchanged. The error carries the
   manifest file and line as where the *value* is, and every reporter prints
   it. The pretty and JUnit reporters show it beside the document. The GitHub
   annotation and the SARIF location point at the manifest line itself,
   since that is where the fix goes. Each SARIF finding resolves its own
   URI, so a manifest inside the repository survives when its document does
   not, and the reverse.
6. **The first increment is read-only.** `fill`, and `query`'s UPDATE, DELETE,
   INSERT and rename, refuse a sidecar-owned key by name. That is the RST
   native-header precedent: readable, loudly unwritable. Writing an owned key
   into the public document would be the one thing 0018 forbids.

### Interface

Config, under `meta:`:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `sidecars` | `Sidecar[]` | no | Manifests to join. Absent means today's behaviour exactly. |
| `sidecars[].file` | `string` | yes | Manifest path, relative to the config file's directory. Missing or unparseable is exit 2. |
| `sidecars[].keys` | `string[]` | yes | Top-level keys this manifest owns. Non-empty, unique, disjoint across entries, and never `$schema`. |

The manifest is a YAML mapping from document path to a mapping of owned key to
value. A top level that is not a mapping, an entry that is not a mapping, or an
entry key outside `keys:` is exit 2. The error names the manifest and the entry.

```ts
export interface SidecarConfig {
  file: string;
  keys: string[];
}

/** One value a sidecar supplied, and where it was written. */
export interface SidecarValue {
  value: unknown;
  /** Manifest path as the run reports it (relative to the run's base). */
  file: string;
  /** 1-based line of the key in the manifest, when known. */
  line?: number;
}

export interface SidecarIndex {
  /** Owned key -> manifest path as reported. */
  owners: ReadonlyMap<string, string>;
  /** Absolute document path -> owned key -> value. */
  byPath: ReadonlyMap<string, ReadonlyMap<string, SidecarValue>>;
  /** Every manifest entry, for the orphan check. */
  entries: readonly SidecarEntry[];
}

export interface SidecarEntry {
  /** Absolute document path the entry names. */
  abs: string;
  /** The key exactly as written in the manifest. */
  spelled: string;
  /** Manifest path as reported. */
  file: string;
  line?: number;
}

/** Null when the config declares no sidecars. */
export function loadSidecars(
  config: DocmetaConfig | null | undefined,
  opts: { configDir: string; base: string },
): Promise<SidecarIndex | null>;

export interface MergedMetadata {
  extracted: ExtractedMetadata;
  /** Owned keys the document itself also carried, each with its owning manifest. */
  collisions: { key: string; file: string }[];
  /** Where a merged pointer's value lives; undefined for document-owned ones. */
  locate: (pointer: string) => SourceLocation | undefined;
}

export interface SourceLocation {
  file: string;
  line?: number;
  col?: number;
}

export function mergeSidecars(
  label: string,
  extracted: ExtractedMetadata,
  index: SidecarIndex | null,
  base: string,
): MergedMetadata;

/** Manifest entries naming no loaded document. Empty when index is null. */
export function orphanEntries(
  index: SidecarIndex | null,
  loaded: readonly string[],
  base: string,
): SidecarEntry[];
```

`FieldError` gains one optional field:

```ts
/**
 * The file `line` and `col` refer to, when it is not the result's own file.
 * Set only for a value a sidecar supplied. Absent means the document.
 */
file?: string;
```

`Validator.validate` gains an optional fifth parameter, `locate`, additive in
the way `colFor` was.

Finding for rule 2, with `schema: "sidecar:owned"`, `keyword: "sidecar"`,
`subject: <key>`, `instancePath: /<key>`, and the document's line for the key.
The schema ref is shaped like `check:<name>` so `classifyRef` passes it
through as a built-in id rather than resolving it as a cwd-relative file path.
The `sidecar` first segment is reserved in the registry beside `check`.
The rule id everywhere is therefore `sidecar:owned/sidecar`, by the ordinary
join, with a description in the reserved-rule listing.

No CLI flag. 0016 and 0033 both say an input-shape concern the config file
already expresses does not get a flag on every command.

### The ladder

```console
$ manni meta validate                              # private checkout, config corpus
✗ public/docs/guides/auth.md
    /jira  must match pattern "^PLAT-\d+$"  (docs-meta.yaml:3)  [./schemas/private.json]
✗ public/docs/guides/new.md
    (root)  must have required property 'jira'  [./schemas/private.json]
2 files checked, 0 passed, 2 failed, 2 errors                                     exit 1

$ manni meta validate                              # doc also carries `jira:`
✗ public/docs/guides/auth.md
    /jira  "jira" is owned by sidecar docs-meta.yaml; remove it from the document  (line 4)  [sidecar:owned]
                                                                                    exit 1

$ manni meta validate                              # entry for a renamed page
manni: Sidecar manifest docs-meta.yaml:7 names "public/docs/guides/old.md", which this run did not load. Fix the entry, or remove it.
                                                                                    exit 2

$ manni meta query "UPDATE docs SET jira = 'PLAT-1' WHERE _path LIKE '%auth.md'"
manni: "public/docs/guides/auth.md": "jira" is owned by sidecar docs-meta.yaml; edit the sidecar file instead.
                                                                                    exit 2
```

### The prerequisite is gitignore across roots

The recommended layout puts documents in a different git root from the config.
Today one such candidate makes `git check-ignore` exit 128, and `gitignore.ts`
reads that as "git unavailable" for the whole batch. Filtering then silently
switches off for every file in the run, including the ones in the config's own
repository. The explicit-mode notice then blames a missing repository. That is
0006's "dangerous direction" and lands before anything else here. Candidates
are grouped by their containing repository and asked about per root, so a
submodule's `.gitignore` and a sibling checkout's both apply.

## Options

- **Mirror tree, one sidecar per document.** Rejected for the first increment.
  Its defining failure is a rename orphaning a twin nobody reads again, which
  is the silent green 0014 exists to end. Per-document files also leave nowhere
  natural to declare ownership. It can return as a second entry form under the
  same `sidecars:` key.
- **Glob cascade inside the manifest.** Rejected, per rule 3.
- **Join on an id field instead of a path.** Deferred. It is rename-proof, and
  the join key is contributor-controlled: a public page that declares
  `id: auth-guide` inherits private assertions nobody vetted. It needs a
  corpus-wide duplicate check first, and that is a separate proposal.
- **A second SQL table, no merge.** Rejected alone (0026 option C: `validate`
  stays blind). Worth adding on top later for ad hoc joins.
- **A `$meta:` pointer in the public document.** Rejected. In public CI it is a
  named file that is not there. A contributor choosing what is merged into
  the object they are judged by is 0015 through the front door.
- **Per-entry `required: true`.** Rejected. Presence is what schema `required`
  already says, so a missing entry surfaces as an ordinary finding that
  baselines, SARIF and the ratchet already understand.

## Stress test

1. **Four adversarial reviews, four lenses.** Precedent, pipeline fit, the CI
   operator with the built binary, and silent-failure semantics. All four
   ranked the manifest first. The two disagreements were ownership and the
   cascade. Ownership stayed because a write to an absent key has no "where
   you read it from" without a declared owner. A doc-side private key with
   no manifest entry would otherwise pass unseen. The cascade went because
   0004 already rejected the shape.
2. **The seam has seven call sites, not four.** Two are re-extracts inside
   `query`'s apply phase, comparing plan-time data to disk. An unmerged re-read
   there would refuse every sidecar-backed key as "changed on disk". All seven
   merge.
3. **The operator experiments found the gitignore defect.** From a private
   sibling checkout, a public page the public `.gitignore` excludes was
   validated, unreported, and under `respectGitignore: true` the notice blamed
   a missing repository. Fixed first, as a `fix:` commit.
4. **SARIF cannot represent a finding in another repository's file.** From a
   sibling layout every document finding is dropped with the existing notice.
   The submodule layout keeps document URIs under the private root, which is
   why it is the recommended layout and the docs say so.
5. **`additionalProperties: false` in a public schema rejects every private
   key.** Correct, and honest: a partition needs the public schema to leave
   room. The finding names the manifest line, and the docs show the fix.

## Not breaking

No existing config changes meaning. `sidecars:` absent is the code path every
current user is on. `FieldError.file` is optional and never set today.
`Validator.validate`'s fifth parameter is optional. `ExtractedMetadata` and
`MetadataExtractor` are untouched.

## Follow-ups recorded, not promised

- Write-back into the manifest, one Document mutation per manifest per run.
- `values:` entries with `files:` globs, for "every guide gets X".
- `join:` on a declared frontmatter field, with the duplicate check.
- A `sourceFor(path, key)` SQL function beside `lineFor`, and `get` labelling a
  sidecar-sourced value.
