# 0070: the vocabularies by default, registered schemas and `strict`

- **Status:** Implemented (#134)
- **Serves:** Maya · M1, "Stand up metadata validation for my repo", and
  Sara · S1, "Define our metadata standard as a schema". Both write a
  `meta:` block, and today that block repeats the whole default set to add
  one schema.
- **Depends on:** [0023](0023-metadata-vocabularies.md), whose vocabularies
  this puts in the default set. [0066](0066-strict-vocabulary-overlays.md),
  for the `-strict` naming. [0067](0067-registering-the-vocabularies.md),
  which registered them and left the default set open.
  [0015](0015-schema-trust-boundary.md), for which refs a document may
  name. [0069](0069-merge-safe-stamps.md), whose default fields derive now
  scopes.
- **Supersedes, in part:** two proposals, and in each the Status line is the
  only edit.
  - [0067](0067-registering-the-vocabularies.md), for "the default set does
    not change". This answers its open question 1.
  - [0023](0023-metadata-vocabularies.md), for its placement intent, which
    appended nine ids. The default set gains nine, but citations joins and
    terminology does not.
- **Touches:** `src/meta/core/{config,resolve-schema,schema-registry,validator,page-marks}.ts`,
  `src/meta/commands/{schemas,query,derive,validate}.ts`, `test/**`,
  `manni.config.yaml`, `docs/src/content/docs/meta/**`, `README.md`
- **Verdict:** The default set grows to eleven schemas. `meta.schemas` adds
  to it, and `defaults: false` restores replacement. `meta.register` names
  local schemas by `$id`. `strict: true` stacks each strict version beside
  its base. Overrides keep replacing unless they ask for the defaults.

## Problem

This repository's config lists about 42 schema lines across two override
entries. Each entry names the house schema, Starlight and one more schema.
The other eighteen lines are the nine vocabularies and their nine strict
overlays, repeated in both entries.

Three rules produce that list.

1. **`meta.schemas` replaces the default set.** A team that wants the
   defaults plus one schema writes the defaults out again.
2. **An override replaces too.** It inherits neither `meta.schemas` nor the
   defaults, so each entry carries the whole list.
3. **The vocabularies are outside the default set.** 0067 registered them
   and deferred the placement to its own proposal. This is that proposal.

A fourth gap sits beside them. A local schema has no name. It is referred to
by path, in every entry, and a `$ref` to it from another schema does not
resolve. Nothing pairs a house schema with a strict version the way the
manni overlays pair.

## Decision

### The default set

`DEFAULT_SCHEMAS` becomes eleven ids.

| Before | After |
|---|---|
| `google:okf:0.1`, `passo-uno:seven-action:1.0` | those two, then `manni:core:1.0.0`, `manni:audience:1.0.0`, `manni:structure:1.0.0`, `manni:stewardship:1.0.0`, `manni:lifecycle:1.0.0`, `manni:ai-context:1.0.0`, `manni:evals:1.0.0`, `manni:graph:1.0.0`, `manni:citations:1.0.0` |

Terminology stays out. A term page is a special kind of page, and a corpus
of guides has none. Artifact-evals stays out for the same reason. No strict
overlay is a default.

A bare run now requires `title` and `description`, which core requires. A
field a vocabulary prefers in a manifest draws a `location:external`
warning when it sits on the page. Warnings do not fail a run.

### Additive schemas

`meta.defaults` takes `true` or `false` and defaults to `true`. With `true`,
a file no override matches gets the default set first, then `meta.schemas`.
With `false`, `meta.schemas` replaces the defaults, which is the old rule.

An override entry takes the same key, with a different default.
`overrides[].defaults` defaults to `false`, so an override written today
keeps replacing its set exactly as before. An override never inherits
`meta.schemas`. Only the defaults can be asked for.

The joined set lists the defaults first, then the listed schemas. A
duplicate keeps its first place.

### Registered schemas

`meta.register` lists paths relative to the config file. A path is a JSON
schema file, or a directory whose `*.json` files register, recursively. Each
schema is loaded once and named by its `$id`.

A registered `$id` has the built-in shape `vendor:name:version`, or is an
absolute `https://` URL. It works anywhere a built-in id works.

- In `meta.schemas` and `overrides[].schemas`.
- In `-s/--schema`.
- In a document's `$schema`. It counts as a built-in under 0015, because
  the config vouches for the file. `documentRefs: local` admits it.
- In a `$ref` from any schema. Every registered schema joins each validator
  before any compile, as the built-ins do.

A registered URL id answers from the file, so no fetch is made. Under
`--no-config` nothing registers, and a registered id is unknown.

A registered id may not reuse a built-in id, or another file's id. It may
not claim a reserved vendor. Those are `manni`, `check`, `external`,
`encrypted` and `derived`, the vendors the family's own ids and findings
use.

### `strict`

`meta.strict` and `overrides[].strict` take `true` or `false`, and default
to `false`. With `true`, each schema in the set that is a default or a
registered schema gets its strict version stacked right after it, when one
exists. A strict version is named by the base id with `-strict` after the
name. `manni:core:1.0.0` pairs with `manni:core-strict:1.0.0`, and a
registered `house:page:1.0.0` pairs with `house:page-strict:1.0.0`.

A listed built-in outside the default set is left alone. The site's
`tgdp:templates:1.1` stays open under `strict: true`. A team that wants it
closed lists `tgdp:templates-strict:1.1` itself.

### Precedence

| # | Tier | Behaviour |
|---|---|---|
| 1 | `-s/--schema` | Replaces everything, as before. Registered ids resolve |
| 2 | a document's `$schema` | Replaces for that file, as before. Registered ids resolve |
| 3 | the first matching override with `schemas` | Replaces, unless the entry sets `defaults: true`. Its `strict` then applies |
| 4 | `meta.schemas` | Joins the defaults unless `meta.defaults: false`. Then `meta.strict` applies |
| 5 | no `meta.schemas` | The default set, unless `meta.defaults: false`. Then `meta.strict` applies |

`-s` stays a full replacement. A person who names one schema at the keyboard
wants that schema judged alone.

### Derive's scope

`meta.derive.collections` lists collection names. With it set, derive
manages fields only on their members, and other files are neither stamped
nor compared. Without it, derive manages every validated file, as before.

0069 made derive manage the merge-safe fields each page's schemas claim.
With stewardship now a default, a fixture under the repository root claims
`owner`. This repository's docs gate would then compare stamps on test
fixtures. The key keeps derive on the pages it was set up for.

### This repository's config

```yaml
meta:
  derive:
    collections: [site]
    sources: [git, codeowners]
    codeowners: docs/content-strategy/OWNERS
    machines: ["*[bot]", "noreply@anthropic.com"]
  overrides:
    - files: "docs/src/content/docs/meta/reference/glossary/!(index).mdx"
      defaults: true
      strict: true
      schemas:
        - ./docs/doc-frontmatter.schema.json
        - astro:starlight:0.41
        - manni:terminology:1.0.0
        - manni:terminology-strict:1.0.0
    - collection: site
      defaults: true
      strict: true
      schemas:
        - ./docs/doc-frontmatter.schema.json
        - astro:starlight:0.41
        - tgdp:templates:1.1
```

That is seven schema lines where there were about 42. The house schema stays
a path. It is named once per entry, so registering it gains nothing.

### Messages

Each is a config error, exit 2, with the config path as its prefix.

- `meta.defaults must be true or false`
- `meta.strict must be true or false`
- `meta.overrides[<i>].defaults must be true or false`
- `meta.overrides[<i>].strict must be true or false`
- `meta.defaults: false with no meta.schemas leaves files with no schema. List schemas, or remove defaults.`
- `meta.overrides[<i>] sets <key>, which applies to the entry's schemas. Add schemas, or remove <key>.` The key is `defaults` or `strict`. With both, it reads `sets defaults and strict, which apply to the entry's schemas. Add schemas, or remove them.`
- `meta.derive.collections names "<name>", which no collection declares.`
- `meta.register[<i>] names <path>, which does not exist.`
- `meta.register[<i>] names a directory with no .json files.`
- `meta.register: <file> is not valid JSON.`
- `meta.register: <file> has no $id. A registered schema is named by its $id.`
- `meta.register: <file>'s $id "<id>" is neither vendor:name:version nor an https URL.`
- `meta.register: <file> and <file> both register "<id>".`
- `meta.register: <file> registers "<id>", which is a built-in id.`
- `meta.register: <file> registers "<id>" under the reserved "<vendor>" vendor.`

An unknown id at run time exits 2. The message points at `manni meta
schemas` for the built-in ids, which are too many for one line, and names
the registered ones.

```text
Unknown schema "<id>". manni meta schemas lists the built-in ids. Registered by meta.register: none.
```

`manni meta schemas` lists the registered ids in a section of their own, each
with its file. A config that fails to load does not stop it. The error goes
to stderr with `Registered schemas are not listed.`, and the built-ins still
list, exit 0. Its JSON output gains `registered`, an array of `{id, file}`.

### Breaking

- A bare run requires `title` and `description`.
- `meta.schemas` joins the defaults. `defaults: false` restores the old rule.
  Overrides are unchanged.
- `DEFAULT_SCHEMAS` changed.

The release is a major one, through a `feat(meta)!:` commit.

## Stress test

1. **A repository with no config.** Every page now needs `title` and
   `description`. That is the floor every docs gate in this family already
   enforces, and 0023 planned it as a breaking change for that reason.
2. **A config written for the old rule.** `schemas: [./house.json]` now
   judges the defaults too. A page missing `description` fails where it
   passed. The team adds `defaults: false`, and the old run returns.
3. **An override written today.** It still replaces. `overrides[].defaults`
   defaults to `false` for exactly this case.
4. **An override with only `elements`.** It has no set to apply defaults or
   strict to, so either key there is refused rather than ignored.
5. **`strict: true` with `tgdp:templates:1.1` listed.** TGDP stays open,
   because it is neither a default nor registered. The site keeps its open
   template enum.
6. **A registered id reused by a second file.** The run refuses before it
   validates anything. Picking one would make the result depend on
   directory order.
7. **A registered `manni:` id.** Refused. The vendor names the family's own
   schemas, and a local file must not shadow a future one.
8. **A document's `$schema` names a registered id under `documentRefs:
   local`.** Admitted. The file is in the repository, and the config named
   it, which is what `local` asks.
9. **`-s house:page:1.0.0 --no-config`.** Unknown, exit 2, and the message
   says nothing was registered. The id belongs to a config that did not run.
10. **A strict version registered without its base.** It is a schema like
    any other and can be listed. `strict: true` pairs only a base that is in
    the set, so nothing stacks it unasked.
11. **A bare `fill`.** It now offers every optional field the eleven
    defaults declare, about 35 per page. 0023 accepted that on purpose,
    because the default set is the menu for what frontmatter should hold.
    `-s` narrows it to the schemas a team cares about.
12. **A fixture validated from the repository root.** It passes the defaults
    once it carries `title` and `description`. Derive leaves it alone,
    because `derive.collections` names only `site`.

## Open questions

None.
