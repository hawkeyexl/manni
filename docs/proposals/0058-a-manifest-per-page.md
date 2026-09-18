# 0058: a manifest per page

- **Status:** Proposed
- **Serves:** Two journeys.
  - Maya · M6, "Keep citations out of the page". Her pages carry prose. Today
    the bookkeeping they lost is a single file every page shares.
  - Devin · D5, "Gate citations in CI without blocking on prose". A one page
    run should read one page's manifest, not the whole corpus.
- **Depends on:** Four earlier proposals.
  - [0037](0037-sidecar-metadata.md) is the manifest, keyed by document path,
    owning a list of top level keys.
  - [0039](0039-sidecar-join.md) is `join`, which keys entries by a page field
    instead of a path.
  - [0041](0041-collections.md) moved the manifest onto a collection as
    `externalMetadata`, and set the key ownership rules this builds on.
  - [0044](0044-citations-and-drift.md) made cite the first writer of a
    manifest, and made the sidecar the place citations live.
- **Relates to:** [0047](0047-field-location.md), which added
  `x-manni-location` and `manni meta relocate`. `relocate` is the verb that
  performs the migration below, and it gains no flag here.
- **Touches:** `src/shared/collections.ts`,
  `src/meta/core/{external-metadata,external-metadata-write,relocation}.ts`,
  `src/cite/core/{sidecar,manifest,adapt}.ts`,
  `src/cite/reporters/pretty.ts`, `src/key/commands/rotate.ts`,
  `docs/src/content/docs/meta/reference/configuration.mdx`,
  `docs/src/content/docs/cite/**`, `manni.config.yaml`, `test/**`
- **Verdict:** `externalMetadata[].file` accepts one placeholder, `{page}`,
  which resolves to the page's path relative to the config file, without its
  extension. A sibling file is `"{page}.citations.yaml"`. The file's inner
  shape does not change, so every reader and writer keeps working. A `file`
  with no placeholder keeps today's meaning, one shared manifest. Reading a
  placeholder entry resolves per page, so a one page run reads one file.

## Problem

This repository moved 1,941 citations out of its pages and into one manifest,
`site.metadata.yaml`. That file is 16,660 lines and 729 KB, and it holds all 30
cited pages. Pull request [#59](https://github.com/hawkeyexl/manni/pull/59)
made the move. The cost showed up within the afternoon.

### It conflicts in every merge

Five of five merges where two branches both touched a cite document conflicted
in that one file. The record is
[#62](https://github.com/hawkeyexl/manni/pull/62),
[#65](https://github.com/hawkeyexl/manni/pull/65),
[#67](https://github.com/hawkeyexl/manni/pull/67),
[#68](https://github.com/hawkeyexl/manni/pull/68) and
[#69](https://github.com/hawkeyexl/manni/pull/69). Each round cost a full
re-pin of the branch's documents against main's copy of the manifest. One
branch needed three rounds and still could not land. It is closed.

The mechanism is not subtle. A citation entry carries an `integrity` hash of
the lines it pins. Any edit to a cited page re-mints that hash, which rewrites
a line inside the page's entry. Two branches editing two unrelated pages
rewrite two regions of one file. Git resolves that only when the regions are
far apart and the surrounding lines agree. At 555 lines per page they
often are not. A shared manifest turns 30 independent documents into one
merge unit.

### One page's run reads every page

`loadExternalMetadata` walks the collections, flattens every declared
manifest, and reads each one before any document is considered
(`src/meta/core/external-metadata.ts:233-299`). The load is a precondition of
the run, not a function of its scope.

```ts
  const configured = collections.flatMap((c) =>
    c.externalMetadata.map((m) => ({ collection: c.name, manifest: m })),
  );
  if (configured.length === 0) return null;
```

cite narrows that further in the wrong direction, on purpose. Ownership is
decided by every declared collection, whatever `--collection` or the
positional paths selected (`src/cite/core/sidecar.ts:14-19`, and
`sidecarsFor` at `src/cite/core/sidecar.ts:289-303`).

```ts
    // Every declared collection, whatever `--collection` or the paths chose.
    collections: declared,
```

That rule is right, and § 2 keeps it. Its consequence today is that
`manni cite check docs/src/content/docs/cite/index.mdx` reads all 16,660
lines to find one page's 60 entries.

### A reviewer cannot see a page's citations

A diff on `docs/src/content/docs/cite/index.mdx` and a diff on that page's
citations are thousands of lines apart, in a file the other 29 pages also
change. Review of the pin is review of the wrong hunk. M6 promised a reviewer
who reads prose alone. It delivered a reviewer who cannot find the pin.

## Decision

### 1. The placeholder grammar

`externalMetadata[].file` accepts exactly one token, `{page}`. It resolves to
the page's path relative to the config file's directory, with its extension
removed and with posix separators. For
`docs/src/content/docs/cite/index.mdx` under a config at the repository root,
`{page}` is `docs/src/content/docs/cite/index`.

| `file` | Resolves to, for that page |
|---|---|
| `"{page}.citations.yaml"` | `docs/src/content/docs/cite/index.citations.yaml` |
| `"./meta/{page}.citations.yaml"` | `meta/docs/src/content/docs/cite/index.citations.yaml` |
| `./site.metadata.yaml` | `site.metadata.yaml`, for every page. Unchanged. |

The value needs quoting in YAML, because `{` opens a flow mapping. That is a
feature. A reader who has to quote it knows the string is not a plain path.

**One normalization, used everywhere a path or a pattern is compared.** Strip
a leading `./`, write every separator as a forward slash, then compare. It runs
on `{page}` before the substitution, so a Windows walk's backslashes never
reach the template and `./meta/{page}.citations.yaml` yields
`meta/docs/src/content/docs/cite/index.citations.yaml` on every platform. It
runs on the whole `file` pattern too, which is what makes `"{page}.yaml"` and
`"./{page}.yaml"` one pattern rather than two. The rule is deliberately this
small. It is not `path.resolve`, so `./a/../{page}.yaml` stays its own
pattern, and it does not fold case, so `Meta/{page}.yaml` and
`meta/{page}.yaml` stay two. Both of those are a config author writing two
spellings of one directory, which a reader can see. Neither is worth a platform
dependent comparison at parse time. Stress tests 8 and 10 are this one rule
applied to a path and to a pattern.

**No second token.** `{collection}`, `{dir}`, `{name}`, `{ext}` and anything
else are refused by name. A second token makes `file` a template, and a
template needs three more decisions nobody has asked for. It needs an escape
for a literal brace, an evaluation order, and a rule for a token that resolves
to an empty string. One token needs none of them, because the token is the
identity of the thing the manifest is about. A brace that is not part of
`{page}` is refused too, so a brace is never silently literal.

**A placeholder may appear once.** Twice can only build a nonsense path, and
refusing it is cheaper than explaining it.

**Escaping the config directory is refused.** `{page}` resolves to a path
relative to the config file, so a page above that directory resolves with a
leading `../`. Pasted into `./meta/{page}.citations.yaml`, that escapes the
prefix the author wrote. A placeholder is a promise about one tree, and `..`
breaks the promise. So a resolved path outside the config directory is a
refusal, exit 2, naming the page. A concrete `file` above the config directory
stays legal, because the author wrote that exact path.

**An absolute `file` with a placeholder is refused.** An absolute prefix plus
a repository relative page path puts every manifest outside the repository.
SARIF and GitHub annotations both drop such a location
(`src/cite/core/adapt.ts:251-262`), so every finding about an entry would
silently move to the page.

**A URL `file` with a placeholder is refused.** It would be one fetch per
page, and cite may not own `citations` in a URL manifest at all
(`src/cite/core/sidecar.ts:20-22`).

### 2. Reading

A placeholder entry is a rule, not a file. There is nothing to read until a
page is known, so the eager load in `loadExternalMetadata` no longer applies
to it. Resolution happens per page, for the pages in the run's scope.

Ownership does not change, and that is the point. `owners` is built from
`manifest.keys` alone (`src/meta/core/external-metadata.ts:271-275`), which is
a config fact. No file is read to decide who owns `citations`. So cite's rule
at `src/cite/core/sidecar.ts:14-19` holds exactly as written. Membership is a
glob match against every declared collection, and the manifest is then a
function of the page's path. Two refusals sit beside it. A URL manifest may not
own `citations`, and a page whose two collections both own it is refused. Both
are config facts, and both fire before any file is opened.

A per page file makes that rule cheaper rather than weaker. Today cite must
read another page's entries to find its own. With a placeholder it opens the
one file named after the page it is checking.

One structure moves. `CitationManifest` holds one path per collection
(`src/cite/core/sidecar.ts:65-74`), and `forPage` picks the owner from that
list without consulting the page's path
(`src/cite/core/sidecar.ts:196-207`). With a placeholder the path is a
function of the page, so the resolution moves inside `forPage`. The ownership
test above it, which is what the two refusals read, does not move.

**A missing file is not an error.** Today a declared manifest that cannot be
read is a `DocmetaError`
(`readManifest`, `src/meta/core/external-metadata.ts:302-311`). A page with no
citations has no sibling file, and 30 pages cannot be made to fail because one
of them has nothing pinned. So for a placeholder entry, a file that does not
exist reads as an empty manifest. Every other read failure keeps today's
refusal, so a permission error is still reported.

For a concrete `file` nothing changes. A declared shared manifest that is
missing is still a config error.

### 3. Writing

Every writer reaches the same splice. `manni cite add`, `cite update` and
`key rotate` go through `src/cite/core/manifest.ts`, and `meta fill`,
`meta query`, `meta derive` and `meta relocate` import
`spliceManifestValue` from `src/meta/core/external-metadata-write.ts`. So the
resolution and the create-if-missing rule live in one place and every writer
inherits them.

**The hold maps already work per file.** cite holds each manifest's text for
the length of a run, keyed by absolute path
(`ManifestSet.held`, `src/cite/core/manifest.ts:39`), and `hold()` returns the
copy the run has already rewritten. With a placeholder each page resolves its
own path, so each page gets its own hold. One read and one write per page,
which is what a per page layout should cost. The write-once-per-run guarantee
is unchanged, because it was never a guarantee about one file.

**A missing file is created.** `hold()` treats a missing file for a
placeholder entry as empty text rather than a refusal. `startManifest`
(`src/meta/core/external-metadata-write.ts:419-427`) already writes a first
entry into an empty string, and `relocate` already hands it one for a manifest
it created (`src/meta/core/relocation.ts:1102`). So this is an existing write
path reached by a second caller, not a new one.

**A page read from stdin owns nothing.** `{page}` is a path, and a piped
document has none. Its label is `<stdin>`, so a placeholder would resolve
`<stdin>.citations.yaml`, a file named after a token. So a writer refuses
rather than creating it.

Only one of the five writers needs a new refusal, and the other four were
checked rather than assumed.

| Writer | Stdin today | Needs a row |
|---|---|---|
| `cite add -` | Reaches the manifest. | Yes, and the table already has it. |
| `meta fill -` | Reaches `keyHome` for every page, `<stdin>` included (`src/meta/commands/fill.ts:751`). No guard. | **Yes.** |
| `meta query -` | A stdin row returns unowned before any manifest is considered (`src/meta/commands/query.ts:3090`), and is skipped by every write path (`:3148`, `:3324`, `:3601`). | No. There is no write to refuse. |
| `meta derive -` | Already refused, before this proposal: `cannot derive <stdin>: no history behind it` (`src/meta/commands/derive.ts:296-303`). | No. |
| `meta relocate -` | Already refused: "relocate moves values between documents and a collection's manifest, and stdin is not a document on disk" (`src/meta/commands/relocate.ts:75-78`). | No. |

`fill` is the gap because `entryFor` builds a path joined entry key from the
label with no stdin case (`src/meta/core/relocation.ts:601-609`). It reaches a
manifest only when `<stdin>` matches a collection glob, which a narrow
`paths:` never does and a `paths: ["**/*"]` might. Resting on that accident is
what the refusal replaces.

**The directory is created, recursively.** Nothing in the family creates a
directory today. `writeFileAtomic` puts its temp file in `dirname(path)` and
renames (`src/meta/core/write-file.ts:50-53`), so a path whose directory is
absent fails with `ENOENT`. A sibling file's directory is the page's own and
already exists, so the sibling layout needs nothing. A mirrored tree such as
`./meta/{page}.citations.yaml` does not exist, and refusing to create it would
make that layout unusable. So the writer creates it, once, before the rename.

### 4. `meta relocate`

`relocate` derives a manifest name only when the collection has no local one
to use. It looks for one first
(`src/meta/core/relocation.ts:415`), and falls back to
`` `${name}.metadata.yaml` `` beside the config file
(`src/meta/core/relocation.ts:426`). An existing undeclared file there is a
refusal (`src/meta/core/relocation.ts:429-433`).

**With a placeholder declared, none of that fires.** The declared entry is a
local manifest, so `relocate` uses it and derives nothing. The config it
writes is unchanged, because it adds keys to an entry that already exists.

**The derived default stays shared.** `relocate` creates a manifest for
whatever keys a schema marks `external`, which is usually `owner`,
`stakeholders` and `evals`. A file per page to hold one page's `owner` string
is 30 files for 30 strings. A per page default would also make
`x-manni-location: external` mean "give me a file per page", which no schema
says. So the derived name stays `<collection>.metadata.yaml`, and a per page
layout is something the author writes. That keeps "detect, don't switch":
`relocate` reads what the config says and invents nothing.

**The split runs through the page, in two runs.** `relocate` has two ends, the
page and the declared manifest. A shared file and a per page file are both the
manifest end. It cannot move a value between them, because only one of the two
is ever declared. Nor would naming a file choose a direction, since the
direction comes from the schema. Declaring both is not available either:
a key has exactly
one manifest in a collection, and a second entry claiming `citations` is a
config refusal (`src/shared/collections.ts:325-335`).

So the migration is one config edit, one throwaway schema and two `relocate`
runs, in one working tree.

The throwaway schema is the part worth naming. `relocate` takes its direction
from the schema, not from the config. `removeKey` fires only where a key's
preference is `page` (`src/meta/core/relocation.ts:908-915`), and
`manni:citations` marks `citations` as `external`. So emptying `keys:` by hand
would not pull the values out. It would stop them being read and strand them
in a file nothing declares. The lever that does work is `-s`, which overrides
the preferences for one run, and 0047 § 6 is where the reverse direction is
documented.

```console
# 1. A one-off schema saying citations belongs in the page, for this run only.
$ cat > /tmp/citations-to-page.schema.json <<'JSON'
{ "properties": { "citations": { "x-manni-location": "page" } } }
JSON

# 2. Move every value back into its page. relocate removes the key from
#    keys:, and the entry with it, because keys: is then empty.
$ manni meta relocate --fields citations -s /tmp/citations-to-page.schema.json
Removing citations from site.metadata.yaml's keys moves it into every page in collection site.
site.metadata.yaml no longer owns any keys and is no longer declared; delete it when you are ready.
docs/src/content/docs/a11y/ci/index.mdx
    citations  ← site.metadata.yaml
…
30 files, 1941 values moved into pages

# 3. Edit manni.config.yaml. Declare a file per page, where step 2 left no
#    externalMetadata: at all.
#      externalMetadata:
#    +     - file: "{page}.citations.yaml"
#    +       keys: [citations]

# 4. Move every value out into its own manifest. No -s: the vocabulary's own
#    external mark is the one that applies now.
$ manni meta relocate --fields citations
Adding citations to {page}.citations.yaml's keys moves it out of every page in collection site.
docs/src/content/docs/a11y/ci/index.mdx
    citations  → docs/src/content/docs/a11y/ci/index.citations.yaml:2
…
30 files, 1941 values moved to 30 manifests

# 5. Delete the shared file and commit.
$ rm site.metadata.yaml
$ manni cite check
✓ 1941 citations, no findings
```

**What step 2's second line means.** It is `relocate`'s own wording
(`src/meta/reporters/relocate.ts:144-150`), and both halves are already true
when it prints. `relocate` removed `citations` from `keys:`, then deleted the
emptied entry, then deleted `externalMetadata:` because the list was empty
(`src/meta/core/relocation.ts:1416-1422`). So nothing declares the file any
more, and the operator does not undeclare it in a later step. "Delete it when
you are ready" is about the file, which step 5 removes. 0047 stress test 10 is
why the tool leaves it rather than deleting a file that may carry history.

Step 4's first line names the pattern rather than a path, because a placeholder
entry has no single file to name. That is this proposal's one change to
`relocate`'s output.

The halfway state is verifiable. After step 2 every citation is in its page's
frontmatter, and `manni cite check` passes there, which is the channel 0044
shipped first. The state is never committed, because both runs happen before
the commit.

**No second verb.** A `relocate --from <file>` flag was considered and
refused. It is a switch for something that happens once per repository, and
the page channel already round-trips the values. `relocate`'s summary already
counts distinct manifests, so it reports "30 manifests" with no change
(`src/meta/reporters/relocate.ts:186-196`).

### 5. Orphans

Today an orphan is an entry inside a shared file naming a document the run did
not load (`orphanEntries`, `src/meta/core/external-metadata.ts:636-651`). The
message is built by `orphanError`
(`src/meta/core/external-metadata.ts:691-703`):

```
Manifest site.metadata.yaml:1 names "docs/src/content/docs/cite/old.mdx", which this run did not load. Fix the entry, or remove it.
```

Per page, that check can never fire for a page's own file, because the file is
named after the page. The orphan becomes a stray **file**, left behind by a
`git mv` or a deletion. Two messages cover it, both keeping the
`Manifest <file>:<line>` shape.

```
Manifest docs/src/content/docs/cite/old.citations.yaml:1 names "docs/src/content/docs/cite/old.mdx", which this run did not load. Fix the entry, or remove the file.
```

```
Manifest docs/src/content/docs/cite/index.citations.yaml:1 names "docs/src/content/docs/cite/other.mdx", but {page} resolved this file for "docs/src/content/docs/cite/index.mdx". A per-page manifest holds one entry, for its own page.
```

The first is today's message with its last word changed, because a one entry
file is removed rather than edited. The second catches a copied file, which
would otherwise hand `other.mdx` values from a file nobody would look in.

Both stay operational errors rather than findings, which is what an orphan is
today. `orphanError` throws a `DocmetaError`, and cite re-wraps it as a
`CiteError` in `orphanRefusal` (`src/cite/core/sidecar.ts:261-266`). Neither
carries a rule id or a severity, so neither reaches a baseline.

**Finding a stray without walking the tree.** One glob comes from the entry,
by splitting the pattern at `{page}`, inserting `**/*`, and keeping the prefix
and the suffix around it. So `"{page}.citations.yaml"` gives
`**/*.citations.yaml`, and `"./meta/{page}.citations.yaml"` gives
`meta/**/*.citations.yaml`. The `**/*` is what matches a manifest at any depth
under the prefix. A bare `*` would match only the prefix's own directory, and
the check would then find no stray in a nested tree at all.

No page path reaches that glob, which is why a page named `docs/[draft]/x.mdx`
needs no escaping. `{page}` becomes `**/*` rather than the path. Only the
prefix and the suffix carry through, and both are the config author's own
literal text.

That glob is walked under the corpus invariant
`orphanEntries` already uses, recorded in its own comment at
`src/meta/core/external-metadata.ts:628-634`. The check runs only when the run
is the config corpus, because a positional path means the operator chose part
of it. So a one page run walks nothing extra, and a full run walks one glob
beside the document glob it already walks.

The glob does not respect `.gitignore`. A manifest is config named input, not
a discovered document, which is how a gitignored concrete manifest is treated
today.

### 6. `join`

A field join keys entries by a top level page field, and `{page}` substitutes
a path. Together they say two different things about one file. The name would
come from the path while the entry key came from the field. A rename would then
move the file and leave the key. And one file could hold an entry for a page it
is not named after. That is the orphan `join` exists to prevent (0039).

Refused at config parse, exit 2:

```
manni.config.yaml: collections[0].externalMetadata[0].file uses {page}, and join is "id". A per-page manifest is found by path, so it cannot be keyed by a field. Remove {page}, or remove join.
```

An explicit `join: path` is accepted, because that is the default spelled out.

### 7. Reporters and the baseline

**The pretty manifest column cannot widen the table.** It is not padded at
all. `where` is emitted last, dimmed and unpadded
(`src/cite/reporters/pretty.ts:319-322` and `:337`), and the widths computed
per page cover only the label, claim and source columns
(`src/cite/reporters/pretty.ts:327-333`). A longer path lengthens its own line
and moves nothing else. Widths are also per page and the comment says so, so
the 30 distinct paths never share one calculation.

What changes is redundancy. Every row of one page's block carries the same
`origin.file`, because ownership is per key and a page's whole `citations`
value comes from one place. With a placeholder that file is the page's own name
plus a suffix, repeated on all 60 rows. So the path prints once, on the page's
own line. The per-row column is dropped for a page whose every row names one
manifest. That is already true of a shared manifest, so the collapse is correct
either way.

**SARIF keeps the location.** Two guards agree. cite's `errorSite` drops a
finding's file when it starts with `../` or is absolute
(`src/cite/core/adapt.ts:251-262`).

```ts
  if (finding.file.startsWith("../") || isAbsolute(finding.file)) return {};
```

The reporter checks again, per finding. A manifest and its documents can sit on
either side of the repository root
(`src/meta/reporters/sarif.ts:200-208`). It resolves each with `artifactUri`
(`src/meta/reporters/sarif.ts:155-165`) and counts what it drops
(`src/meta/reporters/sarif.ts:131-132`).

A sibling file resolves inside the collection's own tree, so it is repository
relative and never `../`. The two refusals in § 1 mean a placeholder cannot
produce either shape. Confirmed in repo.

**Baseline fingerprints do not move.** A fingerprint is
`sha256(schema NUL instancePath NUL keyword NUL subject)`
(`src/meta/core/baseline.ts:124` and `148-159`), and it excludes the file path
deliberately. The entry key is the page label, taken from the validation
result's own file (`src/meta/core/baseline.ts:310` and `344`), which is the
page and not the manifest. So a recorded baseline survives the split
untouched, and no suppressed finding comes back as new. Confirmed.

### 8. Refusals

Every new refusal is exit 2, and every config refusal keeps the
`<source>: collections[c].externalMetadata[i].<key>` path 0041 set.

| Situation | stderr | Exit |
|---|---|---|
| Unknown token | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses "{collection}", which is not a placeholder. The only placeholder is {page}.` | 2 |
| A stray brace | `manni: manni.config.yaml: collections[0].externalMetadata[0].file contains "{" outside a {page} placeholder. Remove it, or write {page}.` | 2 |
| `{page}` twice | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page} twice. One manifest names one page.` | 2 |
| `{page}` and `join` | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page}, and join is "id". A per-page manifest is found by path, so it cannot be keyed by a field. Remove {page}, or remove join.` | 2 |
| `{page}` in a URL | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page} in a URL. A placeholder names a file this run can write, and a URL is not one.` | 2 |
| `{page}` in an absolute path | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page} in an absolute path, so every manifest would sit outside the repository. Make it relative to the config file.` | 2 |
| Two entries, one file | `manni: manni.config.yaml: collections[0].externalMetadata[1].file resolves to the same manifest as externalMetadata[0].file for every page. Give each entry its own file name.` | 2 |
| A page above the config | `manni: manni.config.yaml: collections[0].externalMetadata[0].file resolves outside manni.config.yaml's directory for "../site/install.md". A {page} manifest stays under the config file.` | 2 |
| A stray manifest | `manni: Manifest docs/src/content/docs/cite/old.citations.yaml:1 names "docs/src/content/docs/cite/old.mdx", which this run did not load. Fix the entry, or remove the file.` | 2 |
| A copied manifest | `manni: Manifest docs/src/content/docs/cite/index.citations.yaml:1 names "docs/src/content/docs/cite/other.mdx", but {page} resolved this file for "docs/src/content/docs/cite/index.mdx". A per-page manifest holds one entry, for its own page.` | 2 |

One warning, on stderr, said once, from `warn()` in `src/shared/`:

```
manni: docs/src/content/docs/cite/index.citations.yaml is covered by .gitignore, so CI checks out a page with no citations.
```

Two existing refusals are reached by the new shapes and need no new text.
`tokenEnv` on a path already refuses
(`src/shared/collections.ts:296-300`), and a second entry claiming an owned
key already refuses (`src/shared/collections.ts:325-335`).

## The interface

### Config

Before, this repository's own `manni.config.yaml`, abridged:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/
    externalMetadata:
      - file: ./site.metadata.yaml
        keys: [citations]

tools:
  vale:
    config: .vale.ini

meta:
  overrides:
    - collection: site
      schemas:
        - ./docs/doc-frontmatter.schema.json
        - astro:starlight:0.41

a11y:
  severity: notice
```

After:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/
    externalMetadata:
      - file: "{page}.citations.yaml"
        keys: [citations]

tools:
  vale:
    config: .vale.ini

meta:
  overrides:
    - collection: site
      schemas:
        - ./docs/doc-frontmatter.schema.json
        - astro:starlight:0.41

a11y:
  severity: notice
```

One string changed. No new key, in any section.

The only key whose meaning moves:

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `collections[].externalMetadata[].file` | string | none | yes | The manifest, relative to the config file's directory, or an `https://` URL (0038). May contain the placeholder `{page}` once, which resolves per page to that page's path relative to the config file's directory, without its extension. With a placeholder the entry names one manifest per page, and a missing one reads as empty. Without a placeholder the entry names one manifest for the whole collection, and a missing one is an error. |

`keys`, `join` and `tokenEnv` are unchanged. The manifest's own shape is
unchanged. It stays a mapping from page path to that page's owned keys. So
`join: path` works, the per item line numbers 0044 needs survive, and every
reader and writer keeps working. A per page file is a mapping with one entry:

```yaml
docs/src/content/docs/cite/index.mdx:
  citations:
    - id: check-exit-codes
      claim: { lines: 118-119, integrity: sha256-c41f09aa… }
      source: { file: src/cite/commands/check.ts, lines: 322-332, integrity: sha256-78af1d33… }
```

That one entry is why an orphan is still detectable. A file whose keyed page
is gone is a file whose only entry names nothing.

### No flag is added

No command gains an option, on any domain. `cite check`, `cite add`,
`cite update`, `key rotate`, `meta fill`, `meta query`, `meta derive` and
`meta relocate` all keep the surface they have. The layout is a fact about
where a collection keeps its metadata. The config already states it, and every
tool detects it from the string it already reads. A flag would be a
second place to say it, and a run whose flag disagreed with the config would
have to pick one.

### Output shapes

Three shapes change, all of them values rather than keys.

**`cite check -f pretty`.** The manifest path prints once per page instead of
once per row. Before:

```
docs/src/content/docs/cite/index.mdx
    ✓ check-exit-codes       118-119   src/cite/commands/check.ts:322-332   site.metadata.yaml:2104
    ✓ check-baseline         141       src/cite/commands/check.ts:322-332   site.metadata.yaml:2112
```

After:

```
docs/src/content/docs/cite/index.mdx   docs/src/content/docs/cite/index.citations.yaml
    ✓ check-exit-codes       118-119   src/cite/commands/check.ts:322-332
    ✓ check-baseline         141       src/cite/commands/check.ts:322-332
```

**`cite check -f json`** and the SARIF and GitHub reporters. Every key is the
same. `origin.file` now carries the page's own manifest, and `origin.line` is
a line in it, so both numbers get small.

**`meta relocate -f pretty`.** The summary needs nothing. It already counts
distinct manifests (`src/meta/reporters/relocate.ts:186-196`), so a split
reports `to 30 manifests` on the line as it stands.

One line above it changes. The keys-added and keys-removed lines name
`m.file` (`src/meta/reporters/relocate.ts:124-141`), and a placeholder entry
has no single file to name. So those lines print the pattern, as § 4 step 4
shows. A concrete entry prints its path, unchanged.

### The ladder

**1. The bare minimum.** The config says where the manifests are. One run puts
every value where the config and the schemas say it belongs.

```console
$ manni meta relocate
30 files, 1941 values moved to 30 manifests
```

**2. One key, from the config's own collection.** The usual migration step.

```console
$ manni meta relocate --fields citations
30 files, 1941 values moved to 30 manifests
```

**3. See it first.** `--dry-run` writes nothing, including the config.

```console
$ manni meta relocate --fields citations --dry-run
docs/src/content/docs/cite/index.mdx
    citations  → docs/src/content/docs/cite/index.citations.yaml
docs/src/content/docs/cite/reference/cli.mdx
    citations  → docs/src/content/docs/cite/reference/cli.citations.yaml
… (28 more files)
30 files, 1941 values would move to 30 manifests
```

**4. One page.** A positional path narrows the run, and the corpus orphan
check stands down because the operator chose part of the corpus.

```console
$ manni meta relocate docs/src/content/docs/cite/index.mdx --fields citations
docs/src/content/docs/cite/index.mdx
    citations  → docs/src/content/docs/cite/index.citations.yaml:2
1 file, 60 values moved to 1 manifest
```

**5. For a script.**

```console
$ manni meta relocate --fields citations -f json | jq -r '.files[].file'
docs/src/content/docs/cite/index.mdx
docs/src/content/docs/cite/reference/cli.mdx
…
```

**6. Every option at once.**

```console
$ manni meta relocate docs/src/content/docs \
    --fields citations,owner \
    --collection site \
    -s ./docs/doc-frontmatter.schema.json \
    -s astro:starlight:0.41 \
    --ext md,mdx \
    --exclude '**/draft/**' \
    --exclude '**/index.mdx' \
    --as mdx \
    -c ./manni.config.yaml \
    --allow-empty \
    --no-gitignore \
    --dry-run \
    -f json
{"files":[…],"manifests":[…],"summary":{"files":29,"moved":1881,"stayed":0}}
```

**7. A value that stays.** Exit 1, and the reason is named.

```console
$ manni meta relocate --fields citations
docs/src/content/docs/cite/get-started/index.mdx
    citations  stays: the page and the manifest hold different values
29 files, 1881 values moved to 29 manifests, 1 stayed
$ echo $?
1
```

### The usage errors

| Invocation | stderr | Exit |
|---|---|---|
| `file: "{page}.yaml"` with `join: id` | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page}, and join is "id". A per-page manifest is found by path, so it cannot be keyed by a field. Remove {page}, or remove join.` | 2 |
| `file: "{collection}.yaml"` | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses "{collection}", which is not a placeholder. The only placeholder is {page}.` | 2 |
| `file: "{page}/{page}.yaml"` | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page} twice. One manifest names one page.` | 2 |
| `file: "a{b.yaml"` | `manni: manni.config.yaml: collections[0].externalMetadata[0].file contains "{" outside a {page} placeholder. Remove it, or write {page}.` | 2 |
| `file: "https://ex.test/{page}.yaml"` | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page} in a URL. A placeholder names a file this run can write, and a URL is not one.` | 2 |
| `file: "/srv/{page}.yaml"` | `manni: manni.config.yaml: collections[0].externalMetadata[0].file uses {page} in an absolute path, so every manifest would sit outside the repository. Make it relative to the config file.` | 2 |
| Two entries resolving alike | `manni: manni.config.yaml: collections[0].externalMetadata[1].file resolves to the same manifest as externalMetadata[0].file for every page. Give each entry its own file name.` | 2 |
| `paths: ["../site/**/*.md"]` with a placeholder | `manni: manni.config.yaml: collections[0].externalMetadata[0].file resolves outside manni.config.yaml's directory for "../site/install.md". A {page} manifest stays under the config file.` | 2 |
| `cite check` with a stray manifest | `manni: Manifest docs/src/content/docs/cite/old.citations.yaml:1 names "docs/src/content/docs/cite/old.mdx", which this run did not load. Fix the entry, or remove the file.` | 2 |
| `cite check` with a copied manifest | `manni: Manifest docs/src/content/docs/cite/index.citations.yaml:1 names "docs/src/content/docs/cite/other.mdx", but {page} resolved this file for "docs/src/content/docs/cite/index.mdx". A per-page manifest holds one entry, for its own page.` | 2 |
| `cite add -` with a placeholder entry | `manni: A page read from stdin has no path, and its citations live in a manifest {page} resolves by path.` | 2 |
| `meta fill -` with a placeholder entry | `manni: A page read from stdin has no path, and its "owner" lives in a manifest {page} resolves by path.` | 2 |
| A manifest that cannot be read | `manni: Manifest docs/src/content/docs/cite/index.citations.yaml could not be read: EACCES: permission denied` | 2 |

Exit codes are the family's. `0` is clean, `1` is an error severity finding or
a value that stayed, and `2` is operational or usage.

### The programmatic API

`src/index.ts` gains nothing. Two existing exports change shape, and both are
internal to the family barrel rather than the public one.

| Export | Kind | Change |
|---|---|---|
| `ExternalMetadataConfig.file` | field | Documented as accepting one `{page}`. The type stays `string`. |
| `loadExternalMetadata` | function | Takes the run's pages, so a placeholder entry resolves per page. A concrete entry loads as before. |
| `spliceManifestValue` | function | Unchanged signature. Its callers now hand it empty text for a manifest that does not exist yet. |
| `orphanEntries` | function | Also reports a stray manifest, as an entry whose file is named after a page the run did not load. |

## Stress test

### 1. A page with no citations

There is no sibling file, and § 2 makes a missing one read as empty. The page
reports no citations and the run exits 0. With a shared manifest the same page
simply has no entry, so the two layouts agree.

**Changed as a result:** the missing file rule. The first draft kept
`readManifest`'s refusal, which would have failed this repository's run on the
first uncited page.

### 2. A page added after the split

It matches the collection's glob, so it is a member. It has no manifest, which
reads as empty. `manni cite add` on it creates the file and its directory.
Nothing is orphaned, because an orphan is a file whose page is gone.

### 3. A `git mv` of a cited page

The sibling file does not move with it. A full `cite check` walks the
`**/*.citations.yaml` glob. It finds a file whose only entry names a page the
run did not load, and refuses with the § 5 message.

The fix is three steps, not two. Move the page, move the manifest, then change
the entry's key to the new path. A second `git mv` alone leaves
`new.citations.yaml` holding an entry keyed to `old.mdx`, which is § 5's
second message, the copied manifest. That is the right report for that state,
and it names both paths, so the third step is the one the message asks for.
`manni cite update` rewrites the key in place, and deleting the entry and
re-running `manni cite add` on the renamed page is the longer way round.

This is the cost of a path join, which 0039 recorded. Per page makes it
better in one way that matters. The stale file sits in the directory the moved
page came from, next to the `git mv` the author just ran. The alternative is
8,000 lines into a file shared with 29 other pages.

### 4. Two collections covering one page

Unchanged. Both resolve a file for the page, and `src/cite/core/sidecar.ts:20-27`
refuses a page whose collections own `citations` twice, before either file is
opened. A writer that had to pick one would be the tiebreak 0020 refuses.

### 5. A placeholder plus `tokenEnv`

Already impossible, through two refusals rather than one. `tokenEnv` on a path
refuses (`src/shared/collections.ts:296-300`), and § 1 refuses a placeholder in
a URL. The pair is reported by whichever fires first, and both messages say
what to change.

### 6. A URL manifest

Refused when it carries a placeholder, and unchanged otherwise. A collection
may still declare a URL manifest owning keys cite does not write, and 0038's
fetch-every-run behaviour stands. Per page and a URL cannot be combined,
because a placeholder exists to name a file a writer can create.

### 7. A page whose sibling file is gitignored

The file is still read and written, because a manifest is config named input
rather than a discovered document. `respectGitignore` governs document
discovery. That is also true today of a gitignored shared manifest.

It is still a mistake worth saying. CI checks out a page whose citations are
not in the repository, and reports every entry as missing. So a full run warns
once, with the § 8 line. A warning rather than a refusal,
because a local-only manifest is a legitimate choice for someone trying the
layout out.

**Changed as a result:** the warning. The first draft said nothing, on the
grounds that `.gitignore` is the author's business. A silent green run against
a manifest CI cannot see is the failure D5 exists to prevent.

### 8. A case-only path difference on Windows

`{page}` comes from the page's path as the walk produced it, through § 1's
normalization, and the file is resolved from that. The normalization is what
turns a Windows walk's backslashes into forward slashes, and it runs before the
substitution rather than after. It does not fold case. On a case-insensitive
filesystem `Cite/Index.mdx` and `cite/index.mdx` name one file, so one manifest
holds one entry under one spelling.

The § 5 "named after its own page" check therefore compares resolved absolute
paths, not the entry key's text. Resolution is the platform's job. So a case
difference is one page on Windows and two on Linux, as it already is for every
other path in the run. Comparing the strings would raise a false orphan on
Windows and miss a real one on Linux.

**Changed as a result:** the comparison. The first draft compared the entry
key against the page label, after the separator normalization
`src/meta/core/baseline.ts:85-90` already does. That is text, and text is the
wrong question here.

### 9. 1,941 entries split across 30 files, read by one `cite check`

A full run reads the same bytes in 30 opens instead of one, about 555 lines
each. It also walks one extra glob, for the orphan check. A one page run reads one
file of 555 lines instead of 16,660. The full run is the CI job, where the
extra opens are noise beside the git calls each pin already makes. The one
page run is the local loop, where the whole cost was the file.

### 10. Two entries whose placeholders resolve alike

`file: "{page}.yaml"` and `file: "./{page}.yaml"` are two strings and one
manifest for every page. A reader of the config sees two entries and expects
two files. So the two patterns are put through § 1's normalization and compared
as strings, at config parse, and a collision refuses.

The comparison is on the patterns, with `{page}` still in them, because no page
is known yet. That costs nothing. Two patterns that normalize alike resolve to
one file for every page, so comparing them once answers the question for the
whole corpus.

Two **concrete** entries naming one file stay legal, as they are today. The
config then shows one path written twice, which is visible, and refusing it
would break a config that works. 0058 breaks nothing. This asymmetry is an
open question below.

### 11. A shared manifest that nobody migrates

Nothing happens. A `file` with no placeholder keeps every rule it has, and no
config has to change. That is the test this proposal has to pass before any of
the rest matters.

### 12. `key rotate` over 30 files

It re-encrypts every value in every manifest, so it must enumerate the files
rather than read one. It uses the same glob § 5 derives, under the same corpus
invariant, and its own hold map is already keyed by path
(`src/key/commands/rotate.ts:331`). One read and one write per page, as with
`cite update`.

### 13. A merge after the split

Two branches editing two pages touch two files. There is no shared region and
no conflict. Two branches editing one page still conflict, in that page's
manifest, which is the same unit as the page itself. That is the outcome the
Problem section measured the absence of.

### 14. A finding about an entry, in SARIF

The location survives, because a sibling file is repository relative. § 7
confirms it against `src/cite/core/adapt.ts:257`. The `../` and absolute
refusals in § 1 keep this true for every layout the config can express.
Without them it would hold only for the layout this repository chose.

### 15. A recorded baseline, across the split

Unchanged, and no re-record. The fingerprint excludes the file path and the
entry key is the page. § 7 cites both. A team mid-ramp keeps every suppression
through the migration, which is what makes the migration something they can do
on a Tuesday.

## Verification

```bash
npx vitest run test/external-metadata.test.ts test/relocate.test.ts test/cite
node dist/cli.js cite check                           # the repo's own config; exit 0
node dist/cli.js cite check docs/src/content/docs/cite/index.mdx   # reads one manifest
node dist/cli.js meta validate                        # the dogfood gate; exit 0
node dist/cli.js meta relocate --fields citations --dry-run
```

New fixtures under `test/fixtures/per-page/`, one per refusal in § 8 and one
per stress test that has a file shape. The suites that gain cases are the
external-metadata loader, the relocation planner, the cite sidecar and the
cite pretty reporter.

## Not breaking

Additive, and one config string away from inert. A `file` with no placeholder
behaves exactly as it does today, so every existing config keeps its meaning
and its error messages. Every new refusal describes a config that cannot be
written today. The two output changes are values inside unchanged keys, plus
one column that collapses when it is redundant.

`feat(meta):`, a minor release. The grammar and the reader land in one commit,
the writer and the directory creation in a second, and the orphan glob in a
third. Each carries its own tests. The repository's own migration is a fourth
commit, separate, so the feature reviews without 16,660 lines of moved YAML in
the diff.

## Consequences

- The `cite` and `meta` configuration references gain the placeholder.
- M6 needs rewording. Its outcome says every citation lives in "one manifest
  her collection declares" (`docs/content-strategy/cujs.md:43`), and its steps
  say she moves one page's block "into that manifest"
  (`docs/content-strategy/cujs.md:45`). The sibling layout becomes the
  recommended shape there. A reviewer seeing the pin beside the prose is what
  M6 asked for, and what the shared file took away.
- D6, "Rotate the family key without breaking CI"
  (`docs/content-strategy/cujs.md:107`), says `key rotate` finds values in
  pages and in the local manifests of the collections it covers. Stress test 12
  is that sentence under a per page layout, and the page gains the count.
- A `feat:` commit ships a demo video, per the house rule. The demo is the
  Problem section's merge. Two branches edit two pages, the merge is clean, and
  the accent is blue.
- A future layout that groups by directory rather than by page would want a
  second token. § 1 refuses one, and that refusal is the thing to revisit if
  such a layout is ever asked for. A superseding proposal, not an amendment.
- Open questions for the review, in the order debate is expected:
  1. Should the same-file refusal in § 10 apply to concrete entries too? It is
     the more consistent rule and it would break a config that works.
  2. Is the derived `<collection>.metadata.yaml` in § 4 still right, now that
     a per page layout exists? A schema marking one key `external` gets a
     shared file, and a reader may expect the layout the collection already
     uses for its other keys.
  3. Should the two-run migration in § 4 be one run, at the cost of a
     `relocate --from <file>` flag that nobody needs twice?
  4. Is a stray manifest an exit 2 refusal, or a finding? It is an error today
     because an orphan entry is, and a file is easier to delete than an entry.
