# 0060: a manifest per page, as built

- **Status:** Implemented (#117)
- **Serves:** Two journeys.
  - Maya · M6, "Keep citations out of the page".
  - Devin · D5, "Gate citations in CI without blocking on prose".
- **Supersedes:** [0058](0058-a-manifest-per-page.md), which stays the design.
  This one records what its review decided and what changed when it was built.
- **Touches:** `src/shared/{page-manifest,collections,manifest-cas}.ts`,
  `src/meta/core/{external-metadata,manifest-writes,relocation,write-file}.ts`,
  `src/meta/commands/query.ts`, `src/cite/core/{sidecar,manifest}.ts`,
  `src/cite/reporters/pretty.ts`, `src/key/commands/rotate.ts`
- **Verdict:** 0058, with its four open questions answered as it leaned. Two
  refusal rows are dropped, because main already had them. Two refusals are
  added, for cases it did not reach.

## Why a second proposal

0058 was written on 2026-09-20 and left four questions for its review. Main
moved before it was built. It gained a compare-and-swap writer, a manifest
parse cache, and a release step that commits the shared manifest by name. So
the build found things the proposal could not have known.

0058 is still the design, and the right place to read it. This file exists
because the house rule allows a proposal only one edit, to its `Status:` line.
Everything else that changed is recorded here instead.

## The review's answers

Each follows 0058's own lean. Decided 2026-09-22.

1. **Two concrete entries naming one file stay legal.** Only two `{page}`
   patterns that normalize alike are refused. Refusing the concrete case too
   would be more consistent, and it would break a config that works today.
2. **`relocate`'s derived manifest stays shared.** A schema marking a key
   `external`, with no manifest declared for it, still gets
   `<collection>.metadata.yaml`. A file per page to hold one string is a layout
   nobody stated, and the tool detects layouts rather than inventing them.
3. **The migration is two `relocate` runs.** No `--from` flag. It happens once
   per repository, and the page channel already round-trips every value.
4. **A stray manifest is refused, exit 2.** That matches how an orphan entry in
   a shared manifest is treated today.

## What changed from 0058

### Two refusal rows were already there

`meta fill -` needs no refusal. 0058 found no guard, but `fill` has since
learned to skip manifest routing for a page read from stdin
(`src/meta/commands/fill.ts:766`). A piped page therefore never reaches a
manifest, which is the outcome 0058's row wanted.

`cite add -` keeps its existing refusal and text. It already refused a stdin
page whenever a citations manifest was declared. Its message names the
declared `file`, which is now the pattern, so it reads correctly unchanged:

```
manni: A page read from stdin has no path, and its citations live in {page}.citations.yaml, which is keyed by path.
```

### Creating a manifest is new work

0058 § 3 described a missing file being created as a small change to `hold()`.
Since then, every writer commits through compare-and-swap, and the loop
refused a missing file at both ends. So a per-page manifest has an absent
state, distinct from a present file that is empty. Absent at hold and absent at
commit is created. A file another writer created in between is rebased onto,
as any concurrent change is. A file present at hold and gone at commit keeps
the existing refusal. A concrete manifest that is missing is still an error.

### The release commits the manifests

The release re-anchors citations and commits the result, and its commit
listed `site.metadata.yaml` by name. After a split, that name matches nothing,
so the release would re-anchor pins and then discard them. The repository's
own migration replaces the name with a glob over the per-page files.

### Two refusals 0058 did not reach

**Two pages resolving one file.** `{page}` strips the extension, so
`install.md` and `install.mdx` in one directory both name `install.citations.yaml`.
0058's copied-manifest check would then fire on a layout nobody copied. It is
refused by name instead, exit 2:

```
manni: docs/install.md and docs/install.mdx both resolve {page} to docs/install.citations.yaml. A {page} manifest names one page, so rename one of them.
```

Renaming is the only remedy offered, on purpose. One token cannot keep the two
apart, and 0058 § 1 refuses a second token.

**Renaming a page through `meta query`.** A `_path` rename changes the manifest
`{page}` names for that page. Carried out, it would leave the values behind in
a file named after the old path. So a rename is refused, exit 2, when the page
holds any value in a per-page manifest:

```
manni: docs/a.mdx cannot move to docs/b.mdx, because its "citations" lives in docs/a.citations.yaml, a {page} manifest named after the page's path. Move the page and its manifest together, then rename the entry's key.
```

A page with no per-page value renames as it did before. Moving the manifest
with the page was considered and left out. It would make `query` write a file
the operator never named.

## What did not change

The grammar, the reading rules, the stray and copied-manifest checks, the
reporter and SARIF behaviour, and the baseline all stand as 0058 states them.
No command gains an option. A `file` without the placeholder behaves exactly as
before, and every test that existed before the change passes unedited.

## Consequences

- 0058's status becomes `Superseded by 0060`. Its text is unchanged.
- The repository's own migration lands separately, once this is released, so
  the feature reviews without 35,548 moved lines in the diff.
