# 0063: the `graph` vocabulary

- **Status:** Proposed
- **Serves:** Two readers of one block.
  - Sara · S1, "Define our metadata standard as a schema". She composes the
    0023 drafts, and a block named for a tool reads as that tool's private
    setting rather than a shared vocabulary.
  - Maya · M1, "Stand up metadata validation for my repo". She writes the
    block on her pages, and it should say what it describes.
- **Depends on:** [0023](0023-metadata-vocabularies.md), whose kg draft this
  renames. [0052](0052-term-domain.md), which cut `manni:kg:1.0.0-proposal.4`
  and made `manni term` read the block.
- **Relates to:** 0051, the `kg` domain, on the `tool/kg` branch (#13). It
  builds the graph from this block, and it takes this vocabulary when it
  rebases onto main.
- **Supersedes, in part:** four proposals, and in each the Status line is the
  only edit.
  - [0023](0023-metadata-vocabularies.md), for `manni:kg` in its set of ids,
    and for `kg` among the companion keys no house id may claim.
  - [0046](0046-provenance-pins.md), for its `/kg/label` examples.
  - [0047](0047-field-location.md), for its table row
    `manni:kg:1.0.0-proposal.3 | kg`.
  - [0052](0052-term-domain.md), for §2. The seven terminology fields fall
    back into `graph`, and `manni term` reads `graph.concepts`.
- **Touches:** `docs/proposals/0023/schemas/graph/1.0.0-proposal.1.json`
  (new), `docs/proposals/0023/ladders/{graph-examples,compat-check}.cjs`,
  `src/term/core/load-set.ts`, `src/term/types.ts`, `test/term/**`,
  `test/default-schema.test.ts`, `test/fixtures/**`,
  `docs/src/content/docs/meta/proposals/**`,
  `docs/src/content/docs/meta/{schemas,set-up}/**`,
  `docs/src/content/docs/term/reference/**`, `docs/astro.config.mjs`
- **Verdict:** The page block `kg:` becomes `graph:`, and the vocabulary that
  defines it becomes `manni:graph:1.0.0-proposal.1`. It is
  `manni:kg:1.0.0-proposal.4` with the block renamed and its prose to match.
  `manni term` reads `graph.concepts` and no longer reads `kg.concepts`. The
  kg drafts stay byte for byte as the family's history.

## Problem

The block was named for the tool that first read it. 0023 drafted it as
`docmeta:kg`, a knowledge-graph vocabulary, and `kg` was the tool's name
before it was the block's.

Two things follow from that, and both got worse as the family grew.

A tool name on a page reads as that tool's setting. A schema author composing
the 0023 drafts sees `kg:` beside `evals:` and `metadata:`, and takes it for a
companion namespace owned by one tool. It is a vocabulary. `manni term`
already reads it, and any graph builder is meant to.

The name also collides. The `kg` tool on the `tool/kg` branch emits RDF under
the prefix `kg:`, and reads its settings from the `kg:` section of
`manni.config.yaml`. It also reads the page block `kg:`. Three things share
one spelling, and the tool's own guidance had to warn contributors not to
conflate the key and the prefix. A name that needs that warning is the wrong
name.

## Decision

### 1. The block is `graph:`

A page writes `graph:`, and a JSON Pointer into it starts `/graph/`.

```yaml
graph:
  label: Lens
  definition: The glass that focuses light.
  concepts: [optics]
meta-provenance:
  - generated-by: claude-sonnet-5
    fields: [/graph/label]
```

`graph` says what the block describes, which is the page's place in a graph of
concepts. It leaves `kg` meaning the tool wherever that tool appears.

### 2. The vocabulary is a new family, `manni:graph`

The draft is `docs/proposals/0023/schemas/graph/1.0.0-proposal.1.json`. It is
`kg/1.0.0-proposal.4.json` with the root property renamed. The `$id`, the
title and every description that names the block or points into it change to
match. Every field inside the block keeps its name, its type, its dependencies
and the closed `additionalProperties: false`. `x-manni-location: page` stays on
the root property.

It is a new family rather than a proposal.5, because a draft's id names the
vocabulary. Keeping `manni:kg` over a `graph` block was possible, since
`manni:artifact-evals` already claims `metadata`. It would have put the same
mismatch back one level up.

`kg/1.0.0-proposal.1` through `proposal.4` stay exactly as they are. They are
this family's history, and published drafts do not change.

### 3. `manni term` reads `graph.concepts`

0052 did not define `kg.concepts` as a reference. The code did, in
`referencesOf`, and the term rules page says so. That reader moves to the new
block and reads nothing else.

| Page carries | Before | After |
|---|---|---|
| `concepts: [optics]` | a reference to `optics` | unchanged |
| `kg: { concepts: [optics] }` | a reference to `optics` | nothing |
| `graph: { concepts: [optics] }` | nothing | a reference to `optics` |

A page that still carries `kg.concepts` stops contributing references. A term
only that page cited can then show up as `unused-term`. No command, flag,
config key or message changes.

### 4. The terminology fallback points at `graph`

0052 §2 named `manni:kg:1.0.0-proposal.4` as the draft whose facts the seven
terminology root fields fall back into. The same seven now fall back into the
`graph` block, from `graph.label` through `graph.abstract`. Nothing else about
the harvest rule changes.

### 5. The review page moves, and its old URL redirects

The vocabulary's review page moves from `/manni/meta/proposals/kg/` to
`/manni/meta/proposals/graph/`. The old URL is live, so the site redirects it,
as it already redirects one moved page.

## Known limits

1. **Seven drafts still name the old block in prose.** The terminology draft
   calls its fields "the harvest fallback of their kg twins". Ai-context
   proposal.2 and proposal.3 use `/kg/label` as an example, and so do
   artifact-evals proposal.3 and proposal.4. Core proposal.1 through
   proposal.4 mention `kg.type`, and structure proposal.1 and proposal.2
   mention `kg` fields. Published drafts are immutable, and a new revision of
   each for example prose is out of proportion. Each one's next revision
   carries the new name.
2. **A page still carrying `kg:` is not warned about.** It validates, because
   the page root is open, and nothing reads it. Nothing registered either id,
   so this is a draft diff and gets no migration.

## Stress test

### 1. Why not keep reading `kg.concepts` too?

It would be a second spelling for one thing, permanently. The repository's
rule against aliases exists for exactly that. The vocabulary is an
unregistered draft, so no page depends on the old key in a way this
repository promised to keep.

### 2. Why not wait for the `kg` tool to land and rename there?

The `kg` tool's branch waits on another branch. Meanwhile `manni term` is
released and reads the block on main, and the review page names the draft in
public. Renaming on main first settles the name before any tool that builds
the graph ships against it.

## Consequences

- A page's block is `graph:`, validated by `manni:graph:1.0.0-proposal.1`.
- `manni term` counts `graph.concepts` as a reference, and ignores
  `kg.concepts`.
- The `kg` tool takes this draft, with its `definition` and `abstract`
  fields, when it rebases onto main.

## Release

`feat(term)`, a minor. The vocabulary is a draft and nothing registers it, so
the change to what `manni term` reads is not a breaking one.
