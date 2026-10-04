---
status: accepted
date: 2026-08-31
decision-makers: hawkeyexl
---

# Retrieval artifacts fan out per locale, behind a manifest

## Context and Problem Statement

[ADR 01037](01037-language-as-a-scope-dimension.md) put language in the graph. The retrieval
artifacts still ignore it, and in two ways that a green test suite cannot see.

**One flat lexical index over every locale.** `search.json` carries `id`, `type`, `title`,
`labels`, `description`, `text` and nothing else, so a German query ranks against English entries
with no way to exclude them. MiniSearch's default tokenizer splits on Unicode whitespace and
punctuation. CJK content therefore indexes as roughly one token per paragraph, so a corpus
can be present in the index and unfindable in it.

**One vector sidecar, one model.** The default is `granite-embedding-small-english-r2`. Embedding
German or Japanese under it does not fail. It returns confident, meaningless vectors.
`vectors.bin` refuses on the wrong model, the wrong dimensions, or a stale corpus digest, the
three mismatches ADR 01020 anticipated. It cannot refuse *"this text is not in this model's
language"*, because nothing in either artifact records what language the text is.

There is a third pressure the localized corpus makes concrete. The runtime is browser-native and
fetches whole artifacts. ADR 01020 records ~1.1 MB of float32 per 1000 sections. A reader who
wants German should not download every locale to get it. Today there is no shape of the
problem in which they can avoid it.

## Decision Drivers

- **Ranking across a locale boundary is the edge contamination this project exists to prevent.**
  It is on the axis where a wrong answer is most obvious to the reader.
- **A mismatch must be refusable** (ADR 01020, "mismatch is refused, not ranked"). A refusal
  needs a fact to compare, and language is not currently recorded anywhere in either artifact.
- **The runtime stays browser-safe and dependency-light** (ADR 01018). Whatever navigates the
  artifacts must be plain JSON with no `node:` imports.
- **One rule beats a special case.** A filename that changes shape the day someone adds a
  translation is a trap for every script that consumes it.
- **Pre-release, breaking changes are fine** (DESIGN.md), stated honestly in the commit.

## Considered Options

**How the indexes are split:**

1. **One index per language, unconditionally**, plus a manifest.
2. **One index carrying a `language` field per entry**, filtered at query time.
3. **Hybrid.** Fan out only when the corpus has more than one language.

**How a consumer finds them:**

- **A. A manifest file** listing every localization and its artifacts.
- **B. Convention only.** Derive `search.<lang>.json` from a language the host already knows.

**How a language gets its own embedding model:**

- **i. `embed.byLanguage`**, a language-keyed map overriding `embed.model`/`dtype`.
- **ii. One model for the whole corpus**, with the user pointing it at a multilingual one.

## Decision Outcome

**The split is option 1.** `dockg export --format search` writes `kg/search.<lang>.json` per
language, and `dockg embed` mirrors it into `kg/vectors.<lang>.bin`. A document declaring no
language lands in **`und`**, BCP-47's tag for undetermined. It is a real tag that sorts, filters
and names a file like any other, rather than a dockg invention consumers have to learn.

Sections take their document's language. That is containment, not inference: a section is part of
exactly one document and has no language of its own. Every document and section lands in exactly
one index and none is dropped, which the partition test asserts by counting.

**Concepts are the exception, and belong to every locale.** A `skos:Concept` is shared vocabulary
minted from labels across the corpus, not a document written in some language. So each language's
index carries all of them. Filing them under `und` instead was the first implementation, and it
had two visible costs, both caught in review. `--lang de` could never return a concept. And a
corpus whose every document declared a language still grew a **phantom `und` localization**
holding nothing but concepts. That made `dockg search` demand `--lang` on what is, to its author,
a single-language corpus. Replication is also free at build time. The vector cache is keyed on
text, model and dtype, so a concept is embedded once however many locales carry it.

Option 2 was rejected because it solves the ranking problem and none of the others. The browser
still downloads every locale, and one model still has to serve every language. Option 3 was
rejected because data-dependent filenames make every consuming script conditional on a fact it
cannot know in advance.

A language tag becomes a **filename**, so `export` refuses one that is not a BCP-47 tag rather
than passing it to `writeFileSync`. The shapes already constrain `dcterms:language`, but only
`dockg check` runs them. `export` reads whatever the graph says, and an unvalidated literal is a
path segment. The grammar therefore lives in three places (config schema, shapes, and
`LANGUAGE_TAG` in `localizations.ts`), pinned to each other by a drift guard.

**Discovery is option A.** `kg/localizations.json` lists each language with its document count and
its index's path, entry count and digest. Once `dockg embed` has run it also lists the sidecar's
path, model, dtype, dims and count. A browser fetches one small file, learns what exists and what
each costs, and downloads only the pair it needs. Convention alone (option B) cannot answer "what
localizations does this corpus have?", which is the question a language switcher asks first.

The manifest is also the work list. `dockg embed` iterates it rather than globbing, so it never
guesses which files exist or what language each holds. It also **refuses a manifest whose
recorded digest does not match the index on disk**. Embedding a drifted pair would produce a
sidecar keyed to bytes nobody has.

**Models: option i.** `embed.byLanguage: { de: { model, dtype } }` overrides the corpus default
per language. The sidecar header records the model that produced it and the manifest exposes it,
so the pairing is inspectable rather than assumed. This is the knob that makes the fan-out worth
having: without it the artifacts are split and still embedded by one English model.

The config schema gains its **first `patternProperties` map**, keyed on the same BCP-47 pattern
`shapes/dockg-1.0.0.ttl` uses. `additionalProperties: false` still applies, so a key nobody meant
(`German:`) fails loudly, which is the property CLAUDE.md asks of every config object.

### The vector header learns its language

`VectorIndexHeader` gains `language`, and the format version goes to **2**. A version-1 sidecar is
refused by `decodeVectorIndex` rather than read as if it had the field. Decoded as v2 it would
report `undefined` for the one fact that says which locale it covers. A host would then pair it
with whatever index it happened to fetch.

### `search` refuses to guess

`dockg search --lang <tag>` selects the localization. With one language the choice is unambiguous
and made silently. With more, an unspecified `--lang` is a **structured refusal naming what is
available**, not a default. Answering a German question out of the English index is the failure
this ADR exists to prevent. Picking silently would hide it behind a confident result. This is
runtime invariant 4 (ADR 01018) applied at the entry point.

### Consequences

- Good. A locale boundary is now enforceable end to end. It is declared in `routes`, in the graph,
  in the artifacts, and at the query.
- Good. A browser downloads one locale, not all of them, so the artifact-size ceiling stops
  compounding per language.
- Good. The wrong-model-for-this-language failure becomes visible in the manifest, where a human
  reviewing a build can see `model` beside `language`.
- Bad. **Breaking.** `search.json` and `vectors.bin` no longer exist under those names, and
  `embed.out` is a directory rather than a file. Every consumer reading them by path changes.
  Pre-release, and the manifest is the thing to read instead.
- Bad. The golden inventory grows from six files to eleven. Four indexes, four sidecars, the
  manifest, plus the graph, JSON-LD, RDF/XML and traverse goldens. More files, each smaller, and
  the fan-out is exactly what they now have to prove.
- Bad. A monolingual corpus pays a filename it did not ask for (`search.und.json`) and a
  `--lang` flag it never needs. That is accepted for the one-rule property, and the
  single-language case is still silent at the CLI.
- Neutral. No language *fallback*. `de-AT` does not fall back to `de`, and a query for one does
  not search the other. Fallback is an inference about locale relatedness, and this project does
  not infer. A corpus that wants them together labels them the same.

### Confirmation

- `test/integration/search.test.ts` holds per-language goldens and a manifest golden compared on
  the half `export` owns. A partition test asserts no entry is duplicated or dropped
  across buckets. It also covers the multi-localization refusal, an unknown `--lang` naming what
  exists, and a `--lang de` search returning only German nodes.
- `test/integration/embed.test.ts` holds per-language vector goldens, the header's language, the
  manifest's `vectors` block filled for every language, and determinism across two runs.
- In `test/unit/vector-index.test.ts`, the language round-trips and a version-1 sidecar is refused.
- In `test/unit/config.test.ts`, `byLanguage` parses, a non-tag key is rejected, and an unknown key
  inside an entry is rejected by path.
- `test/unit/localizations.test.ts` holds the manifest ladder. What `parseLocalizations` accepts,
  and ten shapes it must refuse rather than hand on. Those include the entry without a `search`
  block that otherwise reaches a caller as a raw TypeError. It also covers the tag grammar's
  positives and the filename-unsafe negatives (`../escaped`, `a/b`).
- In `test/unit/search-index.test.ts`, a concept lands in every bucket, and a corpus whose
  documents all declare a language grows no `und` bucket at all.
- In `test/unit/schema-sync.test.ts`, the BCP-47 pattern is identical in the config schema, the
  bundled shapes, and `LANGUAGE_TAG`. It is verified to fail when any one of them is edited.

## Pros and Cons of the Options

### Splitting

**1. One index per language, always**, chosen

- Good. One rule; no consumer branches on how many locales a corpus happens to have.
- Good. The browser fetches one locale.
- Good. Each language can have its own model, because each has its own file.
- Bad. A monolingual corpus gets `search.und.json` rather than `search.json`.

**2. One index with a per-entry language field**

- Good. One file; no manifest; no rename.
- Bad. The browser still downloads every locale to search one. That is directly against the size
  pressure that motivates this.
- Bad. One model still has to cover every language, so the confidently-meaningless vectors
  survive untouched.

**3. Fan out only when there is more than one language**

- Good. Monolingual corpora keep today's filenames.
- Bad. The artifact layout changes shape when a corpus gains its first translation. That silently
  breaks every script that hardcoded `search.json`, at exactly the moment someone is busy
  doing something else.

### Discovery

**A. A manifest**, chosen

- Good. Answers "which localizations exist?" in one fetch, which convention cannot.
- Good. Carries digests, so a stale pair is detectable before it is ranked against.
- Good. Gives `embed` a work list instead of a glob.
- Bad. One more artifact to keep in step; mitigated by both writers rewriting it.

**B. Convention only**

- Good. Nothing extra to generate.
- Bad. A language switcher would have to probe for files, and a 404 is not an answer.

### Per-language models

**i. `embed.byLanguage`**, chosen

- Good. Closes the silent-wrong-vectors hole in the same change that creates the fan-out.
- Good. Recorded per sidecar and surfaced in the manifest, so the pairing is auditable.
- Bad. A new config surface, and the schema's first pattern-keyed map.

**ii. One model for everything**

- Good. No new config.
- Bad. Leaves the defect this ADR names in the problem statement exactly as it was, while adding
  the files that make it look solved.
