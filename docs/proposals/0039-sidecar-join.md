# 0039: `join`, a sidecar keyed by a frontmatter field

- **Status:** Implemented
- **Serves:** Maya · M1, M2 · Devin · D4 · Sara · S3
- **Depends on:** Three earlier proposals.
  - [0037](0037-sidecar-metadata.md) defines the manifest and deferred the id join to a separate proposal.
  - [0015](0015-schema-trust-boundary.md) names the risk: a join key the document controls lets a contributor pick what is merged into the object they are judged by.
  - [0026](0026-corpus-checks-are-findings.md) settled that a corpus-wide fact is a finding on each file it concerns. It also settled that a corpus invariant is checked only on a config-corpus run.
- **Relates to:** [0038](0038-sidecar-url-manifests.md), whose remote manifests join the same way; [0004](0004-config-upward-discovery.md), for why globs are not the answer.
- **Touches (planned):** `src/meta/core/{sidecars,config}.ts`, `src/meta/commands/{validate,query}.ts`, `reference/{configuration,api,output-and-exit-codes}.mdx`, `set-up/private-metadata-sidecar.mdx`, `test/sidecars-join.test.ts`, `test/fixtures/sidecars-join/`

## Problem

A manifest entry names a document by path. A rename in the public
repository orphans it, and the next corpus run is exit 2 until someone
edits the manifest. That is the right default: loud, and cheap to fix once.
It is the wrong shape for a docset that moves pages often. It is also wrong
for a manifest maintained by a team that does not watch the public
repository's renames. The path is the one thing about a page the manifest author does
not control.

## Design

`join` names the top-level frontmatter field a manifest's keys are matched
against. Absent, or `path`, means today's behaviour exactly.

```yaml
meta:
  sidecars:
    - file: ./docs-meta.yaml
      keys: [source, jira]
      join: id
```

```yaml
# docs-meta.yaml, keyed by each page's `id`
auth-guide:
  source: internal/auth-design.md
  jira: PLAT-412
```

Matching happens on the extracted value of that field. So it works for any
format and for a remote manifest. A document with no metadata block has
no field, and so no entry. The value is compared as a string: `id: 42` and a
manifest key `42` match.

### The rules

1. **The public schema should require the field.** A page without the
   field has no entry and no finding of its own. What catches it is the
   ordinary `required` finding on the merged object, which only exists if
   a schema demands the private key. The docs say so, and the set-up page
   shows the schema pattern that goes with it.
2. **An entry matching two documents is a finding on both.** Two pages
   sharing one `id` is corpus content, the same class as a duplicate slug,
   and it needs to baseline during a migration. The finding carries
   `schema: "sidecar:duplicate"`, `keyword: "sidecar"`, the id as `subject`,
   and `instancePath: /<join field>`, at the field's line in each page.
   Both pages still receive the entry's values, so the schema judges what
   the site would publish.
3. **An entry matching no document is exit 2**, as for a path entry. For a
   field join the check runs after the per-file loop, because the ids are
   only known once every document is read. It runs only on a config-corpus
   run, by the same `scoped` invariant checks and the path orphan check use.
4. **The join field is not an owned key**, and a manifest may not own it.
   The value that selects an entry cannot itself come from the entry.
5. **Changing the field is a write to the join.** `query`'s UPDATE of the
   join field on a document that matched an entry is refused at plan time,
   the way an owned key is. The next run would report the entry orphaned.
   Renaming such a document is allowed, which is the point.
6. **`path` is the join, not a field.** A frontmatter key literally named
   `path` cannot be joined on. Nothing else about the value is reserved.

### The risk, and what bounds it

The join key is contributor-controlled. A pull request that sets
`id: auth-guide` on a new page inherits the private assertions made about
the real one. A public schema cannot tell the two apart. Three things
bound it, and the docs name all three:

- the duplicate finding fires on both pages, so the run goes red rather
  than green;
- the schema can constrain the field's shape with a `pattern`, so an id
  is at least well-formed;
- the manifest is reviewed in the private repository. An entry that
  suddenly matches two pages shows up there as a duplicate finding before
  it shows up anywhere else.

A path join has none of this exposure, and that is why it stays the default.

### Interface

| Key | Type | Required | Meaning |
|---|---|---|---|
| `sidecars[].join` | `string` | no | `path` (default), or the top-level frontmatter field whose value the manifest's keys name. Never `$schema`, and never a key the same entry owns. |

```ts
export interface SidecarConfig {
  file: string;
  keys: string[];
  tokenEnv?: string;
  /** `path`, or the top-level field a manifest key names. Default `path`. */
  join?: string;
}

export interface SidecarIndex {
  owners: ReadonlyMap<string, string>;
  /** Path-joined sidecars: absolute document path -> owned key -> value. */
  byPath: ReadonlyMap<string, ReadonlyMap<string, SidecarValue>>;
  /** Field-joined sidecars: field -> value -> owned key -> value. */
  byField: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, SidecarValue>>>;
  entries: readonly SidecarEntry[];
}

export interface SidecarEntry {
  /** `path`, or the field this entry is keyed by. */
  join: string;
  /** Absolute document path, for a path entry. */
  abs?: string;
  spelled: string;
  file: string;
  line?: number;
}

export interface MergedMetadata {
  extracted: ExtractedMetadata;
  collisions: SidecarCollision[];
  /** Field-joined entries this document matched. */
  joins: SidecarJoin[];
  locate: (pointer: string) => SourceLocation | undefined;
}

export interface SidecarJoin {
  field: string;
  value: string;
  file: string;
}

/** Field-joined entries no loaded document matched. */
export function orphanJoins(
  index: SidecarIndex | null,
  matched: ReadonlyMap<string, ReadonlySet<string>>,
): SidecarEntry[];
```

### The ladder

```console
$ manni meta validate                      # two pages both say `id: auth-guide`
✗ docs/auth.md
    /id  2 documents carry id "auth-guide"; docs-meta.yaml cannot tell them apart (docs/auth-copy.md)  (line 3)  [sidecar:duplicate]
✗ docs/auth-copy.md
    /id  2 documents carry id "auth-guide"; docs-meta.yaml cannot tell them apart (docs/auth.md)  (line 3)  [sidecar:duplicate]
                                                                                   exit 1

$ manni meta validate                      # entry `gone-guide` matches no page
manni: Sidecar manifest docs-meta.yaml:9 names id "gone-guide", which no loaded document carries. Fix the entry, or remove it.
                                                                                   exit 2

$ manni meta query "UPDATE docs SET id = 'other' WHERE _path = 'docs/auth.md'"
manni: "docs/auth.md": "id" is the field sidecar docs-meta.yaml joins on, and this document has an entry; change the manifest first.
                                                                                   exit 2
```

## Options

- **A frontmatter field, named in config.** Chosen. One mechanism covers
  a hand-written `id`, a Starlight `slug`, and a Docusaurus `id` alike,
  with no special cases.
- **Git rename tracking.** Deferred, and not as a match. `git log --follow`
  can suggest where an orphaned path went, and that belongs in the orphan
  error as a hint. As a match it needs history in CI, guesses on heavy
  edits, and hides the decision from the person who should make it.
- **Content hash.** Rejected. Any edit breaks it.
- **Tool-minted ids.** Rejected for now. It adds a key to every public
  page and still needs the schema to require it. That is the chosen option
  with more ceremony.
- **Globs or prefixes.** Rejected in 0037, for 0004's reason.

## Stress test

1. **A page with no field.** Silently unmatched, by design; rule 1 says
   why that is safe only when a schema requires the private key, and the
   docs lead with that.
2. **A field that is not a scalar.** `id: [a, b]` matches nothing and is
   left alone. The schema is the place to say the field is a string.
3. **Two sidecars joining on different fields.** Each is indexed under its
   own field; a document can match one entry per sidecar. Ownership is
   still disjoint, so the merged object is still unambiguous.
4. **A remote manifest with a field join.** Nothing changes: the fetch
   returns text and the parser indexes it by the configured join.
5. **A scoped run.** `validate docs/auth.md` matches by id exactly as a
   corpus run does, and skips the orphan check, exactly as the path join
   does. The duplicate finding still fires if both pages are in the run,
   because it is about the pages loaded, not the corpus.
6. **`query`'s rename.** A path-joined document with an entry still
   refuses a rename. A field-joined one does not, and its UPDATE of the
   join field refuses instead. Both refusals name the manifest.

## Not breaking

`join` absent is today's behaviour. `SidecarIndex` gains `byField`,
`SidecarEntry.abs` becomes optional and gains `join`, and
`MergedMetadata` gains `joins`. All additive; every existing caller reads
the fields it read before.
