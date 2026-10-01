# 0067: registering the vocabularies at 1.0.0, without `locale`

- **Status:** Implemented (#130); superseded in part by 0070
- **Serves:** Sara · S1, "Define our metadata standard as a schema", and
  Maya · M1, "Stand up metadata validation for my repo". Both name a schema
  by id today only when it is a built-in.
- **Depends on:** [0023](0023-metadata-vocabularies.md), whose drafts this
  registers. [0044](0044-citations-and-drift.md), for citations.
  [0063](0063-the-graph-vocabulary.md), for `graph`.
  [0066](0066-strict-vocabulary-overlays.md), for the strict overlays.
  [0009](0009-publish-builtin-schemas.md), for how a built-in publishes.
- **Supersedes, in part:** three proposals, and in each the Status line is
  the only edit.
  - [0023](0023-metadata-vocabularies.md), for its rule that nothing
    registers before the review concludes, for `locale` in core, and for
    the default set.
  - [0044](0044-citations-and-drift.md), for citations as a vocabulary
    outside the built-ins.
  - [0066](0066-strict-vocabulary-overlays.md), for overlays named by path.
- **Touches:** `src/meta/schemas/{core,stewardship,audience,lifecycle,structure,terminology,ai-context,evals,artifact-evals,graph,citations}{,-strict}/1.0.0.json`
  (new), `src/meta/core/schema-registry.ts`, `src/meta/schemas/manifest.json`,
  `docs/public/schemas/**`, `src/cite/core/page.ts`,
  `src/cite/schema/citations.json` (removed),
  `scripts/check-published-schemas.mjs`, `test/**`,
  `docs/src/content/docs/meta/reference/schemas/**` (new),
  `docs/src/content/docs/meta/proposals/**` (removed)
- **Verdict:** The review concludes. Every draft vocabulary and every strict
  overlay registers as a built-in at `1.0.0`, 22 ids in all. Core drops
  `locale`. The default set does not change.

## Problem

The drafts work only by path. A team copies
`docs/proposals/0023/schemas/core/1.0.0-proposal.4.json` into its config,
and a path into another repository's review folder is not a contract. No URL
serves the drafts, so a page's `$schema` cannot name one. A house schema
cannot `$ref` one either, because only bundled built-ins are registered for
reference resolution. The cite docs keep a fixture whose only job is to prove
that failure.

0023 held registration back until its review concluded. The review has run
through nine rounds and 0063's rename. The maintainer closes it here.

One decision from the review is reversed on the way. Round 8 added `locale`
to core. It does not register.

## Decision

### Twenty-two ids at 1.0.0

| Id | Built from |
|---|---|
| `manni:core:1.0.0` | core proposal.4, without `locale` |
| `manni:stewardship:1.0.0` | stewardship proposal.3 |
| `manni:audience:1.0.0` | audience proposal.2 |
| `manni:lifecycle:1.0.0` | lifecycle proposal.2 |
| `manni:structure:1.0.0` | structure proposal.2 |
| `manni:terminology:1.0.0` | terminology proposal.1 |
| `manni:ai-context:1.0.0` | ai-context proposal.3 |
| `manni:evals:1.0.0` | evals proposal.4 |
| `manni:artifact-evals:1.0.0` | artifact-evals proposal.4 |
| `manni:graph:1.0.0` | graph proposal.1 |
| `manni:citations:1.0.0` | citations proposal.4 |
| `manni:<family>-strict:1.0.0` | each 0066 overlay; core's without `locale` |

Each file keeps its draft's structure. Its `$id`, its `title` and its prose
change. A description names its neighbours at `1.0.0` and speaks in the
present tense. Each overlay states `additionalProperties: true`, as every
open built-in does.

`manni:kg` does not register. 0063 replaced it with `graph`.

The drafts stay in `docs/proposals/` as the review record. No published page
names them.

### Published where every built-in is

Each id is served at
`https://hawkeyexl.github.io/manni/schemas/<family>/1.0.0.json`. A `$schema`
naming that URL resolves to the bundled copy, with no request. The legacy
docmeta base does not serve these files, so the daily check asks it only for
the 23 files it has always served.

### Adoption is a list of ids

```yaml
meta:
  schemas:
    - manni:core:1.0.0
    - manni:core-strict:1.0.0
```

A house schema reaches a vocabulary through `$ref` as well.

```json
{ "allOf": [{ "$ref": "manni:citations:1.0.0" }], "required": ["citations"] }
```

### `locale` does not register

The 2026-09-02 ruling in the design notes said a BCP 47 tag already carries
region and script. It said a second key would hold one fact twice, and that
the rest of a locale is rendering. The 2026-09-03 ruling reversed it. It
argued from the W3C's language tags and locale identifiers spec that
language and locale are two facts. An English page following German
conventions is `language: en` with `locale: de-DE`.

The first ruling holds up better in use.

- **One page, one tag.** No tool in the family reads `locale`. `manni term`
  reads `language`, and so does every standard core shares a name with. A
  second key that no tool consumes is a field authors fill in for no reader.
- **The mixed case is rare, and the tag can carry it.** A page whose
  conventions differ from its language can say so with a Unicode `-u-`
  extension. `en-u-rg-dezzzz` is English with German regional preferences.
- **The spelling split comes back.** `locale` invites `en_US`, the form
  `og:locale` uses. The strict overlay had to reject it, which is a rule
  that exists only because the key does.
- **No target.** `locale` has no RDF property and no built-in claimant, so
  nothing outside the family can use it.

A page that carries `locale` still passes. The root stays open, and no
schema claims the key.

### The default set does not change

0023 planned all nine ids for `DEFAULT_SCHEMAS`, as a breaking release. That
would make every run without a config require `title` and `description`.
Registration alone breaks nothing, so it ships first. Joining the default set
is a separate decision, with its own proposal.

### No moving alias

0023's question 10 asked whether `manni:core:1` should resolve to the latest
`1.x`. It does not. Ids resolve by exact string, and a URL that moves cannot
be pinned by its bytes. A later `1.1.0` registers beside `1.0.0`.

## Stress test

1. **A draft id after registration.** `-s manni:core:1.0.0-proposal.4` is an
   unknown built-in, exit 2. The draft still works by its path.
2. **`manni:core:1`.** Unknown, exit 2, and the message lists
   `manni:core:1.0.0` among the available ids.
3. **A page with `locale: de-DE`.** It passes core and core-strict alike.
4. **The citations composition fixture.** It compiled to exit 2 before. It
   now validates, and the cite docs teach it as the way to require citations.
5. **cite's own validation.** `manni cite` reads the registered citations
   file. It keeps no second copy, so the two cannot drift.
6. **A finding id that starts `manni:`.** `manni:cite/…` and `manni:term/…`
   name findings, with a slash. A built-in id has three colon segments, so
   the two never collide.
7. **The published check.** A new file is absent from the legacy base by
   design. The check asks the legacy base only for its own 23 files.

## Open questions

1. **The default set.** Which of the eleven vocabularies, if any, should run
   when a repository has no config?
