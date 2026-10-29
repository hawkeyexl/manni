# 0126: id-keyed external metadata, in a metadata directory

- **Status:** Implemented (#264, #265, #266, #267)
- **Serves:** Three journeys, each for a page whose bookkeeping lives outside
  it.
  - Maya · M16, "Keep evals out of the delivered page". A page's evals stay in
    its manifest when the page is renamed.
  - Maya · M6, "Keep citations out of the page". A page's citations share its
    one manifest, and a rename strands neither.
  - Maya · M1, "Stand up metadata validation for my repo". A collection with
    no `externalMetadata:` has a home for its external fields already.
- **Depends on:** Five earlier proposals.
  - [0037](0037-sidecar-metadata.md) is the manifest, owning top-level keys
    for named documents.
  - [0039](0039-sidecar-join.md) is `join`, which keys entries by a page field
    instead of a path. `{id}` is a field join whose file is named for the
    value.
  - [0047](0047-field-location.md) marked each field `page` or `external`, and
    added `manni meta relocate`.
  - [0058](0058-a-manifest-per-page.md) and
    [0060](0060-a-manifest-per-page-as-built.md) gave each page a manifest of
    its own, through `{page}`.
  - [0068](0068-a-manifest-owns-what-the-marks-say.md) lets a manifest with no
    `keys` own what the marks say. The metadata directory is such a manifest.
- **Supersedes in part:** Two records. In each, the Status line is the only
  edit.
  - [0060](0060-a-manifest-per-page-as-built.md), for the one-placeholder
    grammar it kept from 0058 § 1. Its review answers 2 and 3 go with it. Those
    are the shared manifest `relocate` creates, and the migration with no
    `--from`.
  - [0047](0047-field-location.md) § 4, for the home `relocate` creates when a
    collection declares no `externalMetadata:`. That home was
    `<collection>.metadata.yaml`, and is now the metadata directory.
- **Touches:** `src/shared/{config-file,collections,page-manifest}.ts`,
  `src/meta/core/{external-metadata,relocation}.ts`, a new minting module
  under `src/meta/core/`, `src/meta/commands/{validate,relocate,query}.ts`,
  `src/meta/cli.ts`, `src/meta/reporters/{relocate,rule-id}.ts`,
  `src/cite/core/sidecar.ts`, `src/docevals/core/external.ts`,
  `src/strategy/core/serving.ts`, `src/key/commands/rotate.ts`, a new
  `test/fixtures/external-metadata-dir/`, the meta set-up and reference pages,
  and this repository's own manifests.
- **Verdict:** A page's external metadata lives in `metadata/<id>.yaml`, found
  by the page's `id`. A rename or an edit leaves the link intact, with or
  without git. A collection with no `externalMetadata:` reads the directory.
  `externalMetadataDir` and `MANNI_EXTERNAL_METADATA_DIR` move it. Writers
  mint a frozen-slug `id` into a page that has none. `manni meta relocate
  --from` migrates an existing setup in one command.

## Problem

Maya runs this repository's docs site. Each of its 266 pages keeps its
bookkeeping in a `{page}.meta.yaml` beside it. That covers personas, journeys,
evals, review interval and source of truth. 116 of them also keep a
`{page}.citations.yaml`. A `{page}` manifest is found by the page's path and
keyed by that path, so a rename strands it twice over.

- **The renamed page loses its values.** It resolves a new manifest that does
  not exist, and silently reads nothing. Its `required` fields fail and its
  evals vanish.
- **A whole-corpus run stops.** It finds the old file and exits 2.

```
Manifest docs/.../old.meta.yaml:1 names "docs/.../old.mdx", which this run did not load. Fix the entry, or remove the file.
```

The fix today is to `git mv` every sidecar by hand and retype its root key.
`join: id` survives a rename, but only in one shared manifest per collection.
`{page}` refuses a field join (0058 § 6). Nothing names a default home, and
nothing lets an environment variable move it. Nothing gives an `id` to a page
that lacks one.

The ids are mostly there already. About 232 of the 266 pages carry a
kebab-case `id`, such as `meta-set-up-external-metadata` for
`meta/set-up/external-metadata.mdx`. `manni:core` defines that field as
"Stable identifier for this page, independent of its path". It marks it
`x-manni-location: page`, so the id stays in the page that carries it.

## Outcome

A page's external metadata lives in `metadata/<id>.yaml`, found by the page's
`id`. A rename or any edit leaves the link intact, with or without git. The
directory is the default for every collection that configures no external
metadata of its own. A top-level key moves it to any path, including another
checkout. `MANNI_EXTERNAL_METADATA_DIR` moves it per environment. Writers mint
a frozen-slug `id` into a page that has none. `manni meta relocate --from`
migrates an existing setup in one command, and this repository migrates in
the same pull request.

These were settled with the user before the plan.

- The directory is a filesystem path, in this repository or another checkout.
- It has a built-in default, a config key and an environment override.
- A page with no id gets one minted into the page.
- The directory is `metadata/`, and the ids are frozen slugs.
- A migration command ships, and this repository migrates with it.
- Each page's citations live in the same file as its other values.

## Worked example

Maya migrates this repository. The counts below are estimates from a grep,
and the dogfood records the real ones.

1. She previews the migration. The report is abridged.

   ```console
   $ manni meta relocate --from "{page}.meta.yaml" --from "{page}.citations.yaml" --dry-run
   Would remove collections[site].externalMetadata[0] ({page}.citations.yaml) and [1] ({page}.meta.yaml); collection site would read metadata/.
   Would create metadata/; it would own what each page's schemas mark external, one <id>.yaml per page.
   docs/src/content/docs/meta/set-up/external-metadata.mdx
       personas   → metadata/meta-set-up-external-metadata.yaml  (from docs/src/content/docs/meta/set-up/external-metadata.meta.yaml)
       citations  → metadata/meta-set-up-external-metadata.yaml  (from docs/src/content/docs/meta/set-up/external-metadata.citations.yaml)
   docs/src/content/docs/docevals/adopt/index.mdx
       id         ← minted docevals-adopt
       personas   → metadata/docevals-adopt.yaml  (from docs/src/content/docs/docevals/adopt/index.meta.yaml)
   … (264 more files)
   266 files, N values would move to 266 manifests, 34 ids would be minted, 382 emptied manifests would be deleted
   ```

   It exits 0.

2. She runs it without `--dry-run`. The same report prints in the past tense,
   and it exits 0. `git status` shows 382 deleted sidecars and 266 new
   `metadata/*.yaml` files. About 34 pages gain one `id:` line, and two
   entries leave `manni.config.yaml`.

3. The gates come out as they did before the migration. `manni meta
   validate`, `manni cite check`, `manni strategy check`, `npm run
   docs:check-graph` and `manni check` each exit 0.

4. She renames a page and reads it back.

   ```console
   $ git mv docs/src/content/docs/meta/set-up/external-metadata.mdx docs/src/content/docs/meta/set-up/keep-metadata-outside.mdx
   $ manni meta get docs/src/content/docs/meta/set-up/keep-metadata-outside.mdx --fields personas,journeys
   docs/src/content/docs/meta/set-up/keep-metadata-outside.mdx: personas=["maya","devin"]
   docs/src/content/docs/meta/set-up/keep-metadata-outside.mdx: journeys=["m1","m2","d1","d4"]
   $ manni meta validate
   ```

   The last command exits 0. Nothing is orphaned, and nothing is lost.

5. CI reads the metadata from another repository's checkout instead, with
   `MANNI_EXTERNAL_METADATA_DIR=../docs-meta manni meta validate`. When the
   checkout step is forgotten, the run stops before judging any page.

   ```console
   $ MANNI_EXTERNAL_METADATA_DIR=../docs-meta manni meta validate
   manni: MANNI_EXTERNAL_METADATA_DIR: ../docs-meta does not exist. Create it, or check out the repository it names.
   ```

   It exits 2.

## Decision

### 1. One directory, keyed by id

The metadata directory holds one manifest per page, named `<id>.yaml`. Each
file holds one entry, keyed by the id. That is the shape every field-joined
manifest already has. The directory is one manifest for the whole config. It
is loaded once, indexed by id, and its values are not tagged by collection. A
page in two collections that both read it reads its file once.

A collection with no `externalMetadata:` key reads the directory, as if it
declared `- file: "<externalMetadataDir>/{id}.yaml"` with no `keys`. So the
directory owns what each page's schemas mark `x-manni-location: external`, as
0068 states for any manifest with no `keys`. `externalMetadata: []` opts a
collection out. A collection that declares any entry manages its own
manifests, and does not read the directory.

### 2. `{id}`, a second placeholder

`externalMetadata[].file` accepts `{id}` beside `{page}`. It names one
manifest per page, found by the page's `id` and keyed by it. It takes no
`join:`, because the join is `id`. It may be absolute, or point outside the
config directory, because another repository's checkout is the point. It
names a file, so it may not sit in a directory name.

0058 § 1 refused a second token because a template needs an escape, an
evaluation order and an empty-value rule. `{id}` needs none of them. The two
tokens never share one `file`, so nothing is ordered. An id that cannot name a
file is a finding on its page, in § 3, and never resolves.

### 3. Which file a page reads

A page reads `<dir>/<id>.yaml` when its `id` is safe. Safe means it matches
`^[a-z0-9][a-z0-9-]*$`, core-strict's pattern, and is not a Windows device
name. A missing file is an empty manifest.

- **A page with no `id`** reads nothing from the directory. That raises no
  finding of its own. A schema may require `id`, and `location:external`
  already warns about values left in the page.
- **An unsafe or encrypted `id`** reads nothing, and `validate` files
  `external:unsafe-id/external` at error severity.
- **Two pages with one `id`** each get `external:duplicate/external`, across
  collections, whether or not the file exists yet.
- **An entry no loaded page carries** is the existing orphan error, exit 2, on
  whole-corpus runs.

### 4. Writers mint an id

Before a writer puts a value in the directory for a page with no `id`, it
mints one through the format's own writer. It first reads the id of every page
in the collections that read the directory. It mints in sorted path order, so
the result is the same on every run.

The slug is minted once and never rewritten. A later rename leaves it alone,
because the id is the link.

A writer does not mint, and the value stays in the page with a warning, in
three cases. The page's schemas reject `id`. A schema other than `manni:core`
gives `id` a meaning of its own. The page cannot be written.

### 5. `relocate --from` migrates a setup

`--from <file>` empties a manifest. Every value it holds moves to where the
config, without that manifest, says its key lives. For a collection left with
no entries, that is the directory.

An equal value already at the target drops the source copy. A different value
stays where it is, and its manifest stays declared and on disk. A declared
`--from` with nothing left is removed from `externalMetadata`. A file left
with no entries is deleted, unless it holds YAML comments.

### 6. The home `relocate` creates

0047 § 4 created `<collection>.metadata.yaml` for a collection with no
manifest. For a collection with no `externalMetadata:` key, the home is now
the directory, with no config edit. The offer `validate` makes on a terminal
names `metadata/<id>.yaml`. A collection that declares `externalMetadata:`
keeps 0047's rule.

## Interface

### Config, before and after

One new top-level key, beside `collections:` and `encryptionKey:`.

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `externalMetadataDir` | string | `metadata` | no | The metadata directory, one `<id>.yaml` manifest per page. Relative to the config file. An absolute path is allowed, and a URL is refused. |

`MANNI_EXTERNAL_METADATA_DIR` wins over `externalMetadataDir`. An empty value
counts as unset, since that is what an absent CI secret expands to. A relative
value resolves from the config file's directory, the same rule as the key.

The directory is read in three cases.

- **Set by the key or the variable.** Always. A missing directory stops every
  command with exit 2. `meta relocate` without `--dry-run` creates it instead,
  and says so.
- **The default, `metadata`.** Once `<config dir>/metadata/` holds a
  manifest, meaning a `*.yaml` whose root key is its own file stem. Until
  then, nothing reads it. `relocate` creates it, and so does the interactive
  home offer on consent.
- **`--no-config`, or a legacy per-tool file.** Never.

This repository, before.

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/
    externalMetadata:
      - file: "{page}.citations.yaml"
        keys: [citations]
      - file: "{page}.meta.yaml"
  - name: strategy
    paths:
      - "docs/content-strategy/{audiences,personas,journeys}/*.md"
    externalMetadata:
      - file: "{page}.citations.yaml"
        keys: [citations]
```

After. `externalMetadataDir` is left out, because `metadata` is its default.

```yaml
collections:
  # No externalMetadata: each page's external values (personas, journeys,
  # evals, citations) live in metadata/<id>.yaml, found by the page's id, so
  # a rename or an edit never strands them (proposal 0126).
  # MANNI_EXTERNAL_METADATA_DIR moves the directory.
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/
  # Unchanged. It declares its own manifest, so it does not read metadata/.
  - name: strategy
    paths:
      - "docs/content-strategy/{audiences,personas,journeys}/*.md"
    externalMetadata:
      - file: "{page}.citations.yaml"
        keys: [citations]
```

Other forms.

```yaml
externalMetadataDir: ../docs-meta            # another repository's checkout
collections:
  - name: guides                             # reads ../docs-meta/<id>.yaml
    paths: ["guides/**/*.md"]
  - name: api
    paths: ["api/**/*.md"]
    externalMetadata:
      - file: "../docs-meta/api/{id}.yaml"   # explicit {id}, its own directory
  - name: legal
    paths: ["legal/**/*.md"]
    externalMetadata: []                     # reads no external metadata
```

### Manifest file shape

```yaml
# metadata/meta-set-up-external-metadata.yaml
meta-set-up-external-metadata:
  personas: [maya, devin]
  journeys: [m1, m2, d1, d4]
  citations:
    - …
```

Only the entry keyed by the file's own stem is read. A file with no such entry
is not a manifest, as with `{page}`.

### The slug rule

1. Start from the page's path relative to its base. The base is the literal
   prefix of the first `paths:` entry, in config order, of the first
   collection that matched. For a plain file entry, the base is its
   directory. For the `default` collection, it is the config directory.
2. Drop the extension and a trailing `/index`. A page that is its base's own
   `index` takes the base's last segment, or `index` when the base is the
   config directory.
3. Lowercase it, and turn each run of characters outside `a-z0-9` into `-`.
   Trim `-` from both ends. If nothing is left, use `page`.
4. If another page already carries the slug, or `<dir>/<slug>.yaml` exists,
   append `-2`, `-3`, and so on.

So `docs/src/content/docs/docevals/adopt/index.mdx` becomes `docevals-adopt`.
That is the convention this repository's ids already follow, and every minted
id passes core-strict.

A writer leaves the value in the page in three cases.

- The page's schemas reject `id`. `agent-skills` is one, since it sets
  `additionalProperties: false`.
- A schema other than `manni:core` gives `id` a meaning of its own.
  `docusaurus-docs` reads it as the doc id, so a minted one would move the URL.
- The page cannot be written. That covers AsciiDoc or RST without fenced front
  matter, HTML without `<head>`, XML without a root element, DITA with a
  self-closing metadata container, and stdin.

A writer is any command that puts a value in a manifest.

- meta's `relocate`, `fill`, `derive`, `query` writes, and `validate`'s
  interactive offer.
- cite's `add`, `update` and `remove`.
- docevals' `fill`, `generate` and `promote --write`.
- `tracevals fill`, `graph fill` and `key rotate`.

`key rotate` re-encrypts every file in the directory. `query`'s `SET _path`
works for a page that reads the directory, because its file does not move.

### Command ladder

```
manni meta relocate --from "{page}.meta.yaml"                                   # migrate one manifest
manni meta relocate --from "{page}.meta.yaml" --dry-run                         # preview, write nothing
manni meta relocate --from "{page}.meta.yaml" --collection site                 # one collection only
manni meta relocate --from "{page}.meta.yaml" --from "{page}.citations.yaml" -f json
manni meta relocate --from "{page}.meta.yaml" --from "{page}.citations.yaml" --collection site --dry-run -f json -c manni.config.yaml
```

`--from <file>` is repeatable, one value per occurrence. `<file>` is a
concrete manifest path or a `{page}` or `{id}` pattern. It is relative to the
config directory, and spelled the way the config spells `file:`, by 0058's
normalization. An undeclared file is read with a path join. It composes with
`--collection`, `--dry-run` and `-f json`. It refuses positional paths and
`--fields`, because a partly emptied manifest stays declared and would hide
what moved.

The usage errors, each exit 2.

```console
$ manni meta relocate --from "metadata/{id}.yaml"
manni: --from metadata/{id}.yaml is where values would move to; name the manifest to empty.
$ manni meta relocate --from https://example.com/meta.yaml
manni: --from https://example.com/meta.yaml is fetched and cannot be emptied; move its values in that repository.
$ manni meta relocate --from nope.yaml
manni: --from nope.yaml is not declared and does not exist.
$ manni meta relocate docs/ --from "{page}.meta.yaml"
manni: --from empties a manifest for every page at once, so it takes no paths and no --fields.
$ manni meta relocate --from "{page}.meta.yaml" --no-config
manni: relocate writes collections: and externalMetadata: to the config file, and --no-config rules one out.
```

### Messages

Config refusals, each exit 2. They follow the existing `{page}` refusals. The
`collections[0]` index is the collection's position in the list.

```
manni.config.yaml: externalMetadataDir must be a non-empty string naming a directory, relative to the config file.
manni.config.yaml: externalMetadataDir is a URL. It names a directory this run reads and writes; check the repository out and name its path.
manni.config.yaml: collections[0].externalMetadata[0].file uses {id}, and join is "slug". An {id} manifest is found by the page's id, so it takes no join. Remove join.
manni.config.yaml: collections[0].externalMetadata[0].file uses {page} and {id}. A per-page manifest is named by one of them.
manni.config.yaml: collections[0].externalMetadata[0].file uses {id} twice. One manifest names one page.
manni.config.yaml: collections[0].externalMetadata[0].file uses {id} in a URL. A placeholder names a file this run can write, and a URL is not one.
manni.config.yaml: collections[0].externalMetadata[0].file uses {id} in a directory name. Put it in the file name, such as metadata/{id}.yaml.
manni.config.yaml: collections[0].externalMetadata[0].file uses "{slug}", which is not a placeholder. The placeholders are {page} and {id}.
```

The last line replaces "The only placeholder is {page}." The `{page}`
absolute-path refusal stays.

A missing directory, exit 2. `manni check` prints it once.

```
externalMetadataDir: ../docs-meta does not exist. Create it, or check out the repository it names.
MANNI_EXTERNAL_METADATA_DIR: ../docs-meta does not exist. Create it, or check out the repository it names.
```

The findings `validate` files, each at error severity.

```
id "Getting_Started" cannot name a file in metadata/; an id that names a manifest is lowercase letters, digits and "-", starting with a letter or digit.
id is encrypted, so it cannot name a file in metadata/; store it plain.
```

The orphan error, exit 2, on whole-corpus runs.

```
Manifest metadata/old-page.yaml:1 names id "old-page", which no loaded document carries. Fix the entry, or remove the file.
```

cite's existing `.gitignore` warning covers the directory.

```
metadata/ is covered by .gitignore, so CI checks out pages with no citations.
```

On stderr, from every writer except `relocate`, once per minted page.
`relocate` lists minted ids in its report instead.

```
manni: minted id "docevals-adopt" in docs/src/content/docs/docevals/adopt/index.mdx, for metadata/docevals-adopt.yaml.
manni: docs/x.md: no id could be minted (its schemas do not allow id), so personas stays in the page.
manni: docs/x.meta.yaml holds comments relocate does not carry; it is kept, emptied of entries.
```

The other reasons in the second line are `docusaurus-docs reads id as the doc
id; set one by hand` and `the page cannot be written: <existing reason>`. A
duplicate id during a write is the existing duplicate-join refusal from meta
and cite, exit 2.

### Output shapes

`relocate`'s pretty output gains five things.

- A config line for each undeclared `--from`.
  `Removed collections[site].externalMetadata[1] ({page}.meta.yaml); collection site reads metadata/.`
- A line when it creates the directory.
  `Created metadata/; it owns what each page's schemas mark external, one <id>.yaml per page.`
- A per-page `id ← minted <slug>` line.
- A `(from <manifest>)` suffix on a move between manifests.
- Footer clauses `, N ids minted` and `, N emptied manifests deleted`, shown
  when non-zero.

Dry runs use the "Would …" forms, as they do today.

`relocate`'s JSON gains fields, each present only when non-empty. They are
`files[].minted` (a string), `deleted` (a string array), `summary.minted` and
`summary.deleted` (numbers). `files[].moved[].from` extends to moves between
manifests, and `manifests[].undeclared` covers `--from`.

`validate`, `get`, SARIF and JUnit keep their shapes. A directory value is
located in its file, as every manifest value is. `external:unsafe-id/external`
joins the reserved rules, described as "The page's id cannot name a file in
the metadata directory, so its external metadata is not read." `manni
strategy` and the `manni check` roll-up map a finding in `metadata/<id>.yaml`
to its page, as they map `{page}` files.

### Programmatic API

| Change | Name |
|---|---|
| Added | `EXTERNAL_UNSAFE_ID_SCHEMA`, beside the other reserved constants |
| Added | `from?: string[]` on the relocate options |
| Added | `RelocateResult` fields `files[].minted`, `deleted`, `summary.minted` and `summary.deleted` |

### Release type

`feat`, not `feat!`. No existing setup changes behavior. A collection reads
`metadata/` only once that directory holds a manifest named for its own key,
or when the user sets the key or the variable. A repository cannot have such a
directory by accident before this ships.

## Stress test

### 1. A rename plus a rewrite

Maya moves a page and rewrites half of it in one commit. Its `id:` line is
unchanged, so it reads the same `metadata/<id>.yaml`. No path, hash or git
history takes part, so a squash, a shallow clone or a checkout with no `.git`
gives the same answer.

### 2. A copied page

A contributor copies `install.mdx` to `upgrade.mdx`, `id` included. Both pages
get `external:duplicate/external`, and the run exits 1. Both still read
`metadata/install.yaml`, so the schema judges what the site would publish. The
fix is a new id on the copy. A writer refuses to write either page's
directory values until then, with the existing duplicate refusal.

### 3. Two collections sharing the directory

`guides` and `api` both leave `externalMetadata:` out. They read one
directory, which is one manifest, so the ownership check sees one owner, not
two. A page in both reads its file once. Two pages, one in each, with one id
are a duplicate, because the directory cannot tell them apart.

### 4. Another repository's checkout missing in CI

The job sets `MANNI_EXTERNAL_METADATA_DIR=../docs-meta` and forgets the
checkout step. The first command stops with exit 2, naming the variable and
the path. A silent empty read would fail every `required` field, or pass every
page with no evals. Both hide the real cause.

### 5. An existing unrelated `metadata/` directory

A repository already keeps image metadata in `metadata/`. Its files are not
named for their own root keys, so the directory holds no manifest and nothing
reads it. The default stays inert until `relocate`, or the home offer, writes
the first real manifest. An explicit key or variable is always read, because
someone asked for it.

### 6. A Docusaurus page

A Docusaurus doc with no `id` gets a field to move into the directory. The
`docusaurus-docs` schema reads `id` as the doc id, and a minted one would
change the page's URL. So the writer mints nothing. The value stays in the
page, with a warning that names the reason and says to set an id by hand.

### 7. Case-insensitive filesystems

`Install` and `install` are one file on Windows and macOS, and two on Linux.
A mixed-case id could pass on one machine and collide on another. So a safe id
is lowercase, as core-strict already requires. `Getting_Started` reads nothing
and files `external:unsafe-id/external`, rather than reading a file that
depends on the platform. A Windows device name such as `con` is refused for
the same reason.

### 8. An encrypted id

A schema marks `id` with `x-manni-encrypt`. The stored value is ciphertext,
and naming a file after the decrypted value would publish it in the tree. So
the page reads nothing and files `external:unsafe-id/external`, which says to
store it plain.

### 9. A partial `--from`

One page's `{page}.meta.yaml` holds `owner: docs`, and a value already in
`metadata/install.yaml` says `owner: platform`. The run moves every other
value, and that one stays with `values-differ`. Its manifest stays declared
and on disk, so the collection keeps reading it, and nothing is lost. The run
exits 1. Maya settles the value and runs `--from` again.

### 10. Comments in a migrated sidecar

Twelve of this repository's sidecars carry YAML comments. `relocate` moves
values, and it does not carry comments to another file. So a commented file is
emptied of entries and kept, with a warning naming it. Maya restores the
comments worth keeping by hand and deletes the rest.

## Rejected

- **Tracking renames through git.** A non-git user could not fix the
  resulting finding, and a squash loses the history. The id is in the page,
  where every format already carries it.
- **A field join on `{page}`.** The file name would come from the path and the
  key from the field, which is the mismatch 0058 § 6 refused.
- **Re-slugging an id on rename.** The file would move with the path, and the
  rename case would return.
- **A random id.** A slug reads well in a diff, and matches the ids this
  repository already writes by hand.
- **`{id}` in a directory name.** Each manifest is one file in one directory,
  so loading the directory and finding its orphans is one listing.
- **A `--to` flag on `relocate`.** The config already says where each key
  lives, and a second answer on the command line could disagree with it.

## Known limits

- **Every file is read each run.** The directory is loaded whole. Indexing by
  page is the upgrade, if a large corpus ever measures slow.
- **One directory per config.** A collection that wants its own uses an
  explicit `{id}` entry.
- **A page with no id reads nothing, silently.** A schema that requires `id`
  is what makes it a finding.
- **Some pages cannot be minted.** The three stay cases above keep the value
  in the page, with a warning.

## Open questions

None.

## Verification

- `npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`,
  `npm run docs:check-cli` and `npm run smoke:lint`.
- A fixture, `test/fixtures/external-metadata-dir/`. It holds a config, pages
  with and without `id`, a `metadata/` directory, a duplicate id, an unsafe and
  an encrypted id, and a stray. It also holds a Docusaurus page and an
  agent-skills page, which mint nothing. A `{page}` setup with a differing
  value and a commented sidecar serves `--from`.
- Tests cover each behavior above.
  - The grammar refusals, the variable over the key, and an empty variable
    read as unset.
  - The default applying only without `externalMetadata:`, and `[]` opting
    out. Default-directory detection.
  - A rename keeping its values, and edits keeping them.
  - The missing explicit directory, exit 2, and `relocate` creating it.
  - Slug cases. Those are an index page, a base index, a clash, uppercase, an
    empty result, a plain-file entry and a brace pattern.
  - Each stay case.
  - `relocate --from` dry and real, with conflicts, comments, deletions, the
    JSON shape and the usage errors.
  - Two collections sharing the directory, with no values lost.
  - cite reading and writing citations in `metadata/<id>.yaml`.
  - graph build seeing a value only the directory supplies.
  - `key rotate` re-encrypting directory files, and the strategy roll-up
    mapping.
  - The CLI integration exit codes.

### Dogfood

This repository migrates in the same pull request.

- The worked example's five steps.
- `node dist/cli.js term check` and `npm run docs:check-docevals`.
- `cd docs && npm run build`, then `npm run docs:check-links`.
- `node dist/cli.js cite check`, after `cite update`.

The `--dry-run` report, the real counts, every gate's exit code and the rename
transcript go in the pull request. The rename is reverted before committing.

## Consequences

- 0060's Status line gains "superseded in part by 0126". So does 0047's.
- This repository's site collection reads `metadata/`, and no `.meta.yaml` or
  `.citations.yaml` stays under `docs/src/content/docs/`.
- The release commits `metadata/**` where it committed the sidecars.

## Acceptance checklist

- [ ] `externalMetadataDir` is read at the top level. A non-string or a URL
      exits 2 with the lines above.
- [ ] `MANNI_EXTERNAL_METADATA_DIR` wins over the key. An empty value counts
      as unset, and a relative one resolves from the config directory.
- [ ] A collection without `externalMetadata:` reads the directory.
      `externalMetadata: []` and any declared entry opt it out.
- [ ] Without the key, `metadata/` is read only once it holds a manifest
      named for its own key.
- [ ] A missing explicit directory exits 2 on every command with the key or
      variable line, and `manni check` prints it once. `relocate`, without
      `--dry-run`, creates it.
- [ ] `{id}` is accepted in `externalMetadata[].file`. `{id}` with `join:`,
      with `{page}`, twice, in a URL or in a directory name exits 2 with the
      lines above.
- [ ] A renamed page keeps every `metadata/<id>.yaml` value in `validate`,
      `get`, `cite check`, `graph build`, `docevals run` and `strategy check`,
      as long as its `id` is unchanged.
- [ ] Two collections reading one directory lose no values. A page in both
      reads its file once.
- [ ] A duplicate id raises `external:duplicate/external` on each page. An
      unsafe or encrypted id raises `external:unsafe-id/external`, with its
      line.
- [ ] A stray entry in `metadata/` is the orphan error, exit 2, on
      whole-corpus runs only.
- [ ] Writers mint frozen-slug ids by the rule. They scan every id first,
      print the stderr notice, and leave the value in the page, with a
      warning, in each stay case.
- [ ] 0047 § 4's created home is the directory for collections with no
      `externalMetadata:`, and the offer text names it.
- [ ] `manni meta relocate --from` moves, undeclares and deletes as specified.
      Differing values and commented files are kept, and the usage errors
      print their lines and exit 2.
- [ ] `relocate` pretty and JSON output carry the new lines and fields.
- [ ] `key rotate` re-encrypts directory files. `query SET _path` works for
      pages that read the directory.
- [ ] Findings filed in `metadata/<id>.yaml` roll up to the page's personas
      and journeys.
- [ ] This proposal scores zero in Vale and reads `Status: Implemented (#PR)`.
- [ ] `meta/set-up/external-metadata.mdx`, `meta/reference/configuration.mdx`
      and `meta/reference/cli.mdx` describe the present behavior, and
      `docs:check-cli` passes.
- [ ] Tests and `test/fixtures/external-metadata-dir/` pin each behavior
      above.
- [ ] This repository's site collection reads `metadata/`, and
      `.releaserc.json` commits `metadata/**`.
- [ ] Every gate in the Docs and CI workflows passes on the migrated
      repository.
- [ ] The dogfood output is pasted into the PR description.
- [ ] The demo video assets are in `media/`, with the MP4 attached to the PR
      and not committed.
