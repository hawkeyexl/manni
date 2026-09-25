# 0052: The `term` domain

- **Status:** Implemented (#40, #TBD); superseded in part by 0063
- **Serves:** Three journeys, all new to `../content-strategy/cujs.md`.
  - Sara · S6, "Define our terminology and make `concepts:` mean something".
  - Maya · M9, "Keep the terms and the docs in step".
  - Devin · D8, "Hand the termbase to localization".
- **Depends on:** Five earlier proposals.
  - [0023](0023-metadata-vocabularies.md) is the vocabulary family this joins as
    its eleventh id. Its `structure.concepts` promises the glossary that does
    not exist.
  - [0041](0041-collections.md) is where the document set is named.
  - [0034](0034-command-grammar.md) is the grammar the verbs follow.
  - [0033](0033-manni-monorepo.md) is the umbrella, and the import rule.
  - 0050, the lint domain on `tool/lint`, recorded the `tools:` key this
    proposal is the first to ship.
- **Relates to:** Three records.
  - The `kg` domain (PR #13) mints a `skos:Concept` per label. It gives that
    concept no definition.
  - [0020](0020-element-metadata.md) set the rule that a format is read for what
    its content model can say, and no further.
  - [0018](0018-write-support-shipped-for-all-three.md) set the rule that a tool
    writes where it reads.
- **Touches:** `src/term/`; `src/shared/tools.ts`; `src/cli.ts` (one
  `addCommand`); `src/meta/internal.ts`;
  `docs/proposals/0023/schemas/terminology/1.0.0-proposal.1.json`;
  `docs/proposals/0023/schemas/kg/1.0.0-proposal.4.json`;
  `docs/src/content/docs/term/`; `scripts/check-cli-reference.mjs`;
  `test/term/`
- **Verdict:** A term is a record with an identity, held in a vocabulary of its
  own at the root of a page. `manni term` reads terms from every format manni
  reads, in both the one-per-file and the many-per-file shape. It checks the
  referential integrity of the set and lints the definitions with Vale. It
  writes a Vale style from the set, and writes the set back out in any format.

## Problem

`manni:structure:1.0.0-proposal.2` describes its `concepts` field this way:

> Controlled-vocabulary terms from **your glossary** that this page is about, a
> curated list, where `keywords` (manni:core:1.0.0-proposal.1) is free words.
> The bridge into knowledge-graph tooling, and the harvest fallback of the
> deeper `kg.concepts`.

There is no glossary. Nothing in the family holds a term, holds a definition, or
checks that a `concepts:` value is a member of anything. The field names a thing
the product does not have. A page may put any string in it.

The `kg` domain is half of the missing half. `src/kg/core/derive.ts` mints a
concept per label:

```ts
const concept = (label: string): string => {
  const c = mintConceptIri(baseIri, label);
  add(c, RDF_TYPE, iri(`${NS.skos}Concept`));
  add(c, `${NS.skos}prefLabel`, lit(label));
```

and `src/kg/core/search-index.ts` records what that leaves behind:

```text
Concepts: label surface only, they are index nodes with no body of their own.
```

So a concept is a slugged string. Two consequences follow. The second is a
defect rather than a gap.

**A concept has no definition.** `manni:kg` carries `label`, `alt-labels`,
`broader`, `narrower`, `related-concepts` and `concepts`, across three draft
revisions. None of them carries `skos:definition`. The vocabulary models every
SKOS relation except the one a termbase exists for.

**A concept's identity is its spelling.** `mintConceptIri(base, label)` slugs the
label, so identical labels converge and different labels never do. A page
declaring

```yaml
kg:
  label: progressive lens
  alt-labels: [PAL]
```

and another page declaring

```yaml
kg:
  concepts: [PAL]
```

mint two unrelated nodes. `concept/progressive-lens` knows that `PAL` is one of
its labels. `concept/pal` does not. The graph already carries the symptom as a
shape. It is `dsh:Concept-prefLabel-collision`, in
`shapes/kg/dockg-1.0.0.ttl`. Its message reports a concept carrying multiple
prefLabels, the same slug under different spellings, and asks the author to
settle on one.

ISO 1087:2019 names what is being conflated. A **concept** is
language-independent and defined by its characteristics. A **term** is one
*designation* of that concept. `prefLabel`, `altLabel` and `hiddenLabel` are all
designations of one concept. A model that identifies a concept by one of its
designations cannot represent synonymy without picking a winner. Settling on one
spelling is not the fix. It is the workaround for having nowhere to say what the
concept *is*.

### A termbase cannot move

Every format manni reads has a way to write a list of terms, and they do not
agree. DITA has `<glossentry>`, one topic per term. DocBook has `<glossary>`
holding many `<glossentry>` children. HTML has `<dl>` with `<dt>` and `<dd>`,
plus `<dfn>` for the defining instance. Markdown has definition lists, from PHP
Markdown Extra by way of every implementation that copied it. AsciiDoc has a
`[glossary]` section style over a labelled list. reStructuredText has Sphinx's
`.. glossary::` directive.

A docset that holds its terms in one of those is stuck in it. Moving from a
DocBook `<glossary>` to one Markdown page per term is hand work, and so is the
reverse. The handoff to localization is no better: every published practitioner
account of it describes a spreadsheet.

That is the problem `manni meta` already solved once. Six formats each keep
metadata differently, one extractor reads each, and everything after extraction
works on one generic record. Terms want the same treatment, in both directions.

## Decision

### 1. A vocabulary of its own, at the root

`manni:terminology:1.0.0-proposal.1` joins 0023 as its eleventh id. Its fields
sit at the root of the page, flat, as every house vocabulary's do. The `kg`
envelope is the family's one exception to flattening, and a second exception
would make it a pattern.

`type: term` marks the page. `type`, `id` and `language` belong to
`manni:core`, so this vocabulary does not redeclare them. It constrains `type`
through `if`, which adds no property and keeps 0023's disjointness rule intact.

| Field | Type | Required | Maps to |
|---|---|---|---|
| `label` | string | yes | `skos:prefLabel` |
| `definition` | string | yes, unless `see` is set | `skos:definition` |
| `abstract` | string | no | the short form, for a tooltip |
| `alt-labels` | string or list | no | `skos:altLabel` |
| `hidden-labels` | string or list | no | `skos:hiddenLabel` |
| `broader` | string or list | no | `skos:broader` |
| `narrower` | string or list | no | `skos:narrower` |
| `related-terms` | string or list | no | `skos:related` |
| `see` | string | no | a redirect to another entry |
| `scope-note` | string | no | `skos:scopeNote` |

Ten fields, and no `status` among them. TBX puts an `administrativeStatus` on
each term, and DITA 1.3 had `<glossStatus>`. DITA 2.0 removed it, along with
`<glossAbbreviation>`, `<glossPartOfSpeech>`, `<glossAlternateFor>`,
`<glossProperty>`, `<glossScopeNote>` and `<glossShortForm>`. The most complete
terminology model in technical documentation cut its status vocabulary when it
met real usage.

SKOS answers the question that vocabulary was for, without a field. The **kind
of label is the status**. A `label` is preferred. An `alt-label` is admitted. A
`hidden-label` is deprecated, which is what SKOS documents `hiddenLabel` for,
naming misspellings and obsolete forms. That is the whole distinction § 6 needs
to write a Vale style, and it costs nothing to carry.

Two fields for the definition, because it serves consumers at different lengths.
A rendered entry wants the full text. A hover card wants a sentence. Kubernetes
splits it with `short_description` plus `<!--more-->`, mdbook-termlink with a
`split-pattern`, and GitLab with a measured budget of "no more than 60
characters". Three independent inventions of the same split is enough evidence.

A term page:

```markdown
---
title: Progressive lens
description: What a progressive lens is, and when a prescription calls for one.
type: term
id: progressive-lens
label: progressive lens
alt-labels: [PAL, graduated lens]
hidden-labels: [no-line bifocal]
broader: [corrective lens]
related-terms: [bifocal]
abstract: Lenses that correct presbyopia without a visible line.
definition: >-
  Corrective lenses whose optical power increases continuously from the top of
  the lens to the bottom, correcting presbyopia without the visible boundary a
  bifocal carries.
---

Prose about progressive lenses, for the reader who came to the entry.
```

Every field on that page is validated by `manni meta validate`. The record is a
vocabulary, not a new file type.

### 2. `kg` harvests the root fields

The relationship to `kg` is the one kg already defines for itself. Its harvest
rule is that the deeper declaration wins, per fact, with the page level as the
fallback. It already applies to `concepts`, `type`, `applies-to`,
`not-applicable-to` and `revision-of`.

`manni:kg:1.0.0-proposal.4` adds `definition` and `abstract`, and extends the
harvest to seven more facts.

| Root field | `kg` twin |
|---|---|
| `label` | `kg.label` |
| `alt-labels` | `kg.alt-labels` |
| `broader` | `kg.broader` |
| `narrower` | `kg.narrower` |
| `related-terms` | `kg.related-concepts` |
| `definition` | `kg.definition` |
| `abstract` | `kg.abstract` |

A page that opens a `kg` block keeps kg's behaviour exactly. A term page that
does not open one is harvested from its root fields, and kg gains a concept with
a body. The concept's IRI is minted from `id` where the page carries one, so its
identity survives a rename of the preferred label.

### 3. Two shapes, and the entry is the row

A term reaches manni in one of two shapes.

**One entry per file.** The record lives in the file's metadata channel. Every
extractor already reads that channel, so this shape works in all six formats
with no new reader. A DITA `<glossentry>` topic is this shape too, because a
glossentry is a topic, which is a file.

**Many entries per file.** The records live in the body, in whatever construct
the format has for a list of terms. The file's metadata channel declares
`type: term-set`. Self-declaring constructs are read without it: DITA's
`<glossgroup>`, DocBook's `<glossary>`, AsciiDoc's `[glossary]` and Sphinx's
`.. glossary::` all say what they are. An HTML `<dl>` and a Markdown definition
list do not, so those two are read only where the metadata channel declares the
file.

In `manni meta query` a file is a row of `docs`, and that does not change. In
the term set an **entry** is the row. A one-entry-per-file term page is both. A
`term-set` file is one row of `docs` holding many rows of the term set.

An entry's `id` comes from the record where it has one. Otherwise it comes from
the construct's own identifier, which is `<dt id>` in HTML, `xml:id` on a
DocBook `<glossentry>`, and `@id` on a DITA topic. Failing both, it is the slug
of the preferred label.

### 4. What each construct can say

A many-per-file construct carries less than a record does, and is read for
exactly what it holds. Reading a `status` out of a definition list would invent
data the source cannot express. That is the mistake 0020 avoided by taking
cardinality from the content model.

Three constructs share one convention. **Where a construct allows several terms
against one definition, the first is the preferred label and the rest are
alt-labels.** HTML allows several `<dt>` before a `<dd>`. Sphinx's glossary
allows several terms in one entry. DocBook allows `<glossterm>` beside
`<acronym>`.

| Construct | Reads |
|---|---|
| Page metadata | every field |
| DITA `<glossentry>` topic | `label`, `definition`, `alt-labels`, `scope-note`, `id` |
| DITA `<glossgroup>` | the same, per child |
| DocBook `<glossary>` | `label`, `definition`, `alt-labels`, `see`, `related-terms`, `id` |
| HTML `<dl>` | `label`, `definition`, `alt-labels`, `id` |
| HTML `<dfn>` | `label`, `alt-labels` |
| Markdown definition list | `label`, `definition`, `alt-labels` |
| AsciiDoc `[glossary]` | `label`, `definition`, `alt-labels` |
| `.. glossary::` | `label`, `definition`, `alt-labels` |
| YAML or JSON manifest | every field |

DITA's element names are the only ones that do not match the record's, so its
mapping is stated in full. `<glossdef>` is the definition. DITA specializes it
from `<abstract>`, but it is where a DITA author writes what a term means. Any
other mapping would drop every definition from a round trip through DITA.

| DITA | Record |
|---|---|
| `<glossterm>` | `label` |
| `<glossdef>` | `definition` |
| `<glossAlt><glossSynonym>` | `alt-labels` |
| `<glossAlt><glossAcronym>` | `alt-labels` |
| `<glossBody><glossUsage>` | `scope-note` |
| topic `@id` | `id` |

### 5. `write` renders the set, in place or elsewhere

A tool writes where it reads, which is 0018's rule. `manni term write` renders
the resolved set, and its arguments decide where.

With no `-f` and no `-o` it writes each entry back to its own source, in place.
A page is rewritten through the same extractor that read it. A body construct is
spliced, as `element-write.ts` and `patch-util.ts` already do for HTML and XML.

With `-f <format>` and `-o <path>` it renders the whole set somewhere new. That
is the round trip: read a DocBook `<glossary>`, write one Markdown page per
term, or the reverse.

**The path says which shape.** A path naming a directory gets one entry per
file. A path naming a file gets every entry in that one file. Nothing configures
this, because the path already answers it.

```console
$ manni term write -f markdown -o glossary.md    # one definition list
$ manni term write -f markdown -o glossary/      # one page per term
$ manni term write -f dita -o glossary.dita      # one glossgroup
$ manni term write -f dita -o terms/             # one glossentry topic per term
```

A render into a construct that cannot hold a field drops it, and says so. That
is § 4's asymmetry seen from the other side. A set with `scope-note` rendered to
a Markdown definition list loses the scope notes. The run reports how many
fields were dropped, and from which entries.

A render never writes an entry its construct's reader would not read back. A
Markdown or MDX definition list, an AsciiDoc `[glossary]` list and a
`.. glossary::` skip an entry with no definition. A `<dl>` folds a `<dt>` with
no `<dd>` into the next entry. So a `see` redirect rendered to one of them
is left out, and the run names it after the dropped fields.

`--check` renders without writing, and exits `1` when the target differs from
what it would write. It is the drift gate `manni meta query --check` already is.
`--dry-run` renders without writing, and prints what would change followed by
the dropped and skipped lines a write prints.

### 6. Vale in both directions

Terminology meets Vale twice, and the two directions are different jobs. Both
find Vale's configuration the same way.

#### Where Vale's configuration comes from

An outside tool's settings live under the top-level `tools:` key, beside
`collections:` and `encryptionKey:`, in the shape lint's 0050 recorded:

```yaml
tools:
  vale:
    config: .vale.ini
```

`tools.vale.config` is optional. Absent, Vale finds its own configuration, the
way it does when a person runs it. Present, manni passes it to Vale as
`--config`. Either way, manni asks Vale rather than reading the file:
`vale ls-config` returns the resolved configuration as JSON. Its `Paths` holds
the styles directory, its `SBaseStyles` holds each section's styles, and its
`RootINI` names the file it resolved. manni never parses an ini, so it never
disagrees with Vale about what one says.

#### `write -f vale` writes a style

It writes a style named `Terms` into the styles directory Vale reports. `-o`
names a different styles directory, and makes Vale unnecessary for the write.

| File | Vale check | Built from | Level |
|---|---|---|---|
| `Terms/Casing.yml` | `substitution` | labels and alt-labels that start with a capital or a symbol | error |
| `Terms/Lowercase.yml` | `substitution` | labels and alt-labels entirely in lowercase | error |
| `Terms/SentenceStart.yml` | `substitution` | labels and alt-labels that start lowercase and hold a capital later | error |
| `Terms/Deprecated.yml` | `substitution` | hidden-labels, each swapped for its label | warning |
| `Terms/<ACRONYM>.yml` | `conditional` | each all-caps alt-label of a label that is not all-caps | warning |

For the three-term set of a progressive lens, `API` and Kubernetes:

```yaml
# Generated by manni term write. Edit the terms, not this file.
extends: substitution
message: "Write '%[2]s' in lowercase, except to start a sentence."
level: error
ignorecase: true
nonword: true
vocab: false
swap:
  \bprogressive lens\b: "[Pp]rogressive lens"
  \bgraduated lens\b: "[Gg]raduated lens"
  \bapplication programming interface\b: "[Aa]pplication programming interface"
```

```yaml
# Generated by manni term write. Edit the terms, not this file.
extends: conditional
message: "Spell out 'PAL' on first use, as 'progressive lens (PAL)'."
level: warning
ignorecase: false
first: '\b(PAL)\b'
second: '(?i)progressive lens \((PAL)\)'
```

Every rule in that table was chosen against a real Vale 3.20.0 run, and each
obvious alternative failed it.

**No vocabulary file.** Vale's own mechanism is `accept.txt`, and the obvious
render lists every label in it. Vale turns each line into a case-enforcing
`Vale.Terms` check. On correct prose that raised three errors:
`Use 'progressive lens' instead of 'Progressive lens'` at a sentence start, the
same for `Graduated lens`, and `Use 'PAL' instead of 'pal'` on "Ask your pal".
Writing `[Pp]rogressive lens` fixes the false positives. But Vale prints the
entry verbatim, so a writer then reads
`Use '[Pp]rogressive lens' instead of 'PROGRESSIVE LENS'`. manni owns the casing
rules instead. The cost is spelling: a section with `Vale.Spelling` on can flag
a term, and nothing from the term set stops it.

**Lowercase terms get their own rule and their own message.** The `%[2]s` verb
prints what the writer wrote, so the message never shows a pattern. Only a
label that is entirely lowercase goes there. A label such as `iPhone` starts
lowercase and holds a capital later, so it goes to `SentenceStart.yml`. Its key
is the lowercased label and its value allows a capital first letter
(`[Ii]Phone`). The message there prints `%[2]s` too. It cannot go to `Casing.yml`,
whose `Use '%s' instead of '%s'.` would print the `[Ii]` class. Dogfooding found
the gap. With `meta-schema URI` in `Casing.yml`, a sentence opening
`Meta-schema URI is` raised an error, and the manni docs page for that term had
to lowercase its own title. A real Vale 3.20.0 run with `SentenceStart.yml` left
that sentence and `the meta-schema URI` alone, and flagged `Meta-Schema URI`
and `meta-schema uri`.

**Every key carries its own word boundaries.** Vale wraps a swap key in
`\b…\b` unless the rule sets `nonword`, and a Go `\b` knows only ASCII word
characters. So a term ending in a symbol never matched. A real run left `c++`
unflagged beside `C++` in the term set, and a term ending in `é` fails the same
way. The rules set `nonword: true`, and manni writes each edge itself: `\b`
beside an ASCII word character, `\B` beside anything else. For an ordinary word
that is exactly Vale's own wrapping. With it, the same run flagged `c++` and
left `c++x` and `kubernetesish` alone.

**All-caps terms get no casing rule.** Case-enforcing a three-letter string fires
on ordinary words, and at two letters (`IT`, `US`) it fires on nearly every
paragraph. What is worth enforcing about an acronym is its expansion.

**An acronym rule is written from the label, one file each.** Google and
Microsoft ship a generic rule whose second pattern needs a Title Case expansion,
`(?:\b[A-Z][a-z]+ )+\(([A-Z]{3,5})\)`. `progressive lens (PAL)` never matches
it. On a five-paragraph guide it raised five warnings and caught nothing,
including one on `PAL` inside its own expansion. A combined rule over several
acronyms is as accurate as separate ones, and a run confirmed it. The files stay
separate for the message. `%s` can only name the acronym, so a shared message
cannot say what to type.

**The label kind decides which acronyms get a rule.** `PAL` is an alt-label of
`progressive lens`, so a reader needs the expansion. `API` as a label says API is
the name, and no rule is written. `K8s` is not all caps, so it is an ordinary
alt-label.

**manni owns the directory it writes.** Every generated file opens with the
marker line. A `Terms/` holding a file without it is someone else's style, and
manni refuses to write there. A marked file the set no longer produces, such as
an acronym whose term was removed, is deleted.

**Wiring stays in the user's config.** Vale packages wire themselves through
`<StylesPath>/.vale-config/`. manni's style cannot, because `vale sync` deleted a
`9-manni-terms.ini` placed there on the first sync. manni reads `SBaseStyles`,
and when no section names `Terms` it prints the line to add and the file to add
it to. It never edits a Vale config.

`vale sync` does leave the generated files alone. They survived two syncs byte
for byte. So they can be committed, and `write -f vale --check` keeps them in
step with the set.

#### `lint` runs Vale over the definitions

A definition is prose, and a house voice already holds every other authored word
in a docset. The definitions are the one body of prose manni owns, and nothing
checks them.

`manni term lint` writes each entry's `definition`, `abstract` and `scope-note`
to a temporary file named `<id>.<field>.md`, and runs Vale once over all of them:

```
vale --output=JSON [--config <tools.vale.config>] <temporary files>
```

One process for the set, because a process per field is three times the entry
count. One file per field, because a single concatenated file would let a
document-wide rule, such as acronym first-use, reach across unrelated entries.

**The file name is the voice switch.** Vale matches a section by file name, so
`[*.definition.md]` in the same config applies to definitions alone. A run
confirmed it: that section turned off `Direct.Length`, and the same sentence in
an `abstract` file still raised it. Definitions are often one long noun phrase.
A docset relaxes the rule for them in the config it already has, and `term:`
carries no Vale key.

Findings map back to the source.

- Vale's severities fold onto `src/shared/severity.ts`: `error` to `error`,
  `warning` to `warning`, `suggestion` to `notice`.
- The rule id is `manni:term/prose/<Check>`, keeping Vale's own rule name, in
  the shape 0050 set for `manni:lint/prose/Google.Passive`. JSON also carries
  `tool: "vale"`.
- The line is the field's. A literal `|` block keeps its lines, so a finding maps
  to the exact source line. A folded `>-` block is one line once parsed, so its
  findings point at the field's own line.

This does not cross the boundary lint's ADR 01003 drew. That line is about who
judges the **documentation's** prose, and docevals does, through its `tool:vale`
grader. `term lint` judges field values manni validates, reads no page body, and
delegates to the same binary rather than reimplementing it.

### 7. What `check` does

`manni term check` reads records. It resolves the set, resolves every reference
into it, and reports what does not line up. It reads no prose, which is what
`term lint` is for.

| Rule | Default | What it means |
|---|---|---|
| `undefined-term` | error | A page's `concepts:` names a label no entry claims |
| `duplicate-id` | error | Two entries share an `id` |
| `label-collision` | error | Two entries claim the same preferred label, ignoring case |
| `alt-label-collision` | error | An entry's alt-label is another entry's preferred label, ignoring case |
| `dangling-reference` | error | `broader`, `narrower`, `related-terms` or `see` names no entry |
| `broader-cycle` | error | A `broader` chain returns to where it started |
| `see-not-empty` | error | An entry with `see` also carries a `definition` |
| `asymmetric-hierarchy` | warning | A names B as `broader`; B omits A from `narrower` |
| `abstract-too-long` | notice | `abstract` is longer than `abstractMaxLength` |
| `unused-term` | notice | No page's `concepts:` names this entry |

Collisions ignore case because the Vale style is keyed that way. `Casing.yml`,
`Lowercase.yml` and `SentenceStart.yml` are `swap` maps keyed on the lowercased term, so `API` and
`api` in one set would silently collide there, the last one written winning.

Rule ids are `manni:term/<rule>`, following cite's `RULE_ID_PREFIX`. Severities
come from `src/shared/severity.ts`, and each is overridable per rule, including
to `off`.

Each rule has prior art, which is why the list stops where it does. Sphinx warns
`term not in glossary: %(target)r` and `duplicate term description of %s, other
instance in %s`. The `reportNotMentioned` option in glossarify-md is
`unused-term`. The Kubernetes glossary shortcode fails the build with `%q is not
a valid glossary term_id`. DocBook's `<glosssee>` is a redirect, and an entry
that both redirects and defines is the contradiction `see-not-empty` catches.
kg's own shapes file names `broader-cycle` as something core SHACL cannot
express.

`unused-term` is a notice on purpose. A termbase that only defines what the docs
already say is one that cannot be written before the docs are.

## The interface

### Config

Before, this repository's own `manni.config.yaml`, abridged:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/

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

No `term:` section at all. A term is a page declaring `type: term`, so nothing
names where the entries are, and every `term:` key has a default. That is the
rule that keeps `a11y` from carrying a `urls:` key when a collection already says
where the documents are published.

The `tools:` key, top level, `additionalProperties` false at every level:

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `tools.vale.config` | path | none | no | Vale's config file, relative to `manni.config.yaml`. Passed to every Vale run as `--config`. Absent, Vale finds its own. |

The `term:` key, top level, camelCase, `additionalProperties` false:

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `manifests` | list of paths | `[]` | no | Entry sources that are not documents. Paths resolve relative to the config file. |
| `abstractMaxLength` | number | `60` | no | The length at which `abstract-too-long` fires. |
| `baseline` | path | `.manni-term-baseline.json` | no | The ratchet, as 0001 defines it. |
| `severity` | map of rule to level | the table in § 7 | no | Ten rule names to `error`, `warning`, `notice` or `off`. |
| `allowEmpty` | boolean | `false` | no | Whether an empty set is success. `false` is 0014's rule. |
| `respectGitignore` | boolean | `true` | no | As every other domain. |

`term.paths` and `term.exclude` are **refused by name**, with a message pointing
at `collections:`, as `meta.paths` and `cite.paths` are.

A manifest, for entries held outside any document:

```yaml
progressive-lens:
  label: progressive lens
  alt-labels: [PAL, graduated lens]
  hidden-labels: [no-line bifocal]
  abstract: Lenses that correct presbyopia without a visible line.
  definition: >-
    Corrective lenses whose optical power increases continuously from the top of
    the lens to the bottom.
bifocal:
  label: bifocal
  abstract: Lenses with two distinct optical powers, divided by a visible line.
```

The top-level key is the entry's `id`. The loader keeps the line of each entry,
and of each item within it, as in [0037](0037-sidecar-metadata.md). A finding
then names the entry's own line.

### Commands

```
manni term list    [paths...]          List the resolved entries
manni term get     <term> [paths...]   Show one entry
manni term check   [paths...]          Check the set and every reference into it
manni term lint    [paths...]          Run Vale over the definitions
manni term write   [paths...]          Write the set back, or render it elsewhere
manni term formats                     List the constructs read and written, per format
```

There is no default subcommand. That is 0034's grammar, and meta's default is
grandfathered rather than copied.

Shared across `list`, `get`, `check`, `lint` and `write`, per 0005's parity
baseline:

| Flag | Shape | What it does |
|---|---|---|
| `[paths...]` | positional, space-separated | Files, directories and globs. A named `.yaml`, `.yml` or `.json` file is read as a manifest, as a `term.manifests` entry is; a directory or glob walk never picks one up. Omitted, the set comes from every collection. |
| `-` | positional | stdin, alongside named paths, never instead of them. Requires `--as`. |
| `--as <format>` | one value | Forces an input format for stdin. |
| `--ext <list>` | comma-separated, given once | The extensions a directory or glob walk keeps. |
| `--exclude <glob>` | repeatable | One glob per occurrence; never comma-split. |
| `--collection <name>` | repeatable | Narrows the run to named collections. |
| `--allow-empty` | flag | An empty set is success. Wins over `term.allowEmpty`. |
| `--no-gitignore` | flag | Reads files `.gitignore` covers. Wins over `term.respectGitignore`. |
| `-c, --config <path>` | one value | The config file. |
| `--no-color` | flag | As the family's. |

These are the flags meta and cite take for the same jobs, spelled the same way.
A command typed against one domain reads the same set under another.

Per command:

| Command | Flag | Values | Default |
|---|---|---|---|
| `list` | `-f, --format` | `pretty \| json \| csv` | `pretty` |
| `get` | `-f, --format` | `pretty \| json` | `pretty` |
| `check` | `-f, --format` | `pretty \| json \| github \| sarif \| junit` | `pretty` |
| `check` | `--baseline` | none | off |
| `lint` | `-f, --format` | `pretty \| json \| github \| sarif \| junit` | `pretty` |
| `write` | `-f, --format` | `markdown \| mdx \| asciidoc \| rst \| html \| dita \| docbook \| tbx \| skos \| csv \| json \| vale` | each entry's own |
| `write` | `-o, --out <path>` | one path | see below |
| `write` | `--check` | none | off |
| `write` | `--dry-run` | none | off |
| `formats` | `-f, --format` | `pretty \| json` | `pretty` |

`check --baseline` follows the family ratchet. With no baseline file it records
the current findings and exits `0`. With one, only findings the file does not
hold fail the run. A configured `term.baseline` is compared without the flag.

`write -o` defaults differently by format, and the default is the only sensible
target in each case.

| `-f` | `-o` when omitted |
|---|---|
| none | each entry's own source, in place |
| a document format | required |
| `tbx`, `skos`, `csv`, `json` | required |
| `vale` | the styles directory Vale reports |

`write` is the one verb that renders, so `-f` covers the document formats, the
interchange formats and the Vale style alike. A second verb for interchange
would be a second surface over one behaviour.

`tbx` is TBX v2 Core. Four translation systems were surveyed: memoQ, Phrase,
Smartling and Crowdin. All four import TBX. Only Smartling names a dialect, and
it names Core. v3 renamed every structural element, and tool support for the
rename is uneven.

### The ladder

**1. The bare minimum.** Pages declare `type: term`; nothing is configured.

```console
$ manni term check
✓ 34 terms, 118 references, no findings
```

**2. See what is there.**

```console
$ manni term list
progressive-lens   progressive lens      PAL, graduated lens
bifocal            bifocal
corrective-lens    corrective lens
...
34 terms
```

**3. One term.**

```console
$ manni term get progressive-lens
progressive lens                        docs/terms/progressive-lens.md:1
  id             progressive-lens
  alt-labels     PAL, graduated lens
  hidden-labels  no-line bifocal
  broader        corrective lens
  abstract       Lenses that correct presbyopia without a visible line.
  definition     Corrective lenses whose optical power increases continuously
                 from the top of the lens to the bottom, correcting presbyopia
                 without the visible boundary a bifocal carries.
```

`<term>` is matched as an id, then as a label, then as an alt-label, the last
two without case. `manni term get PAL` prints the same entry. A miss names the
closest id or label only when it is a few edits away.

**4. The check that fails.**

```console
$ manni term check
docs/guides/fitting.md:6
  error  manni:term/undefined-term       concepts: "PAL" names no entry.
                                         "progressive lens" lists it as an alt-label.
docs/terms/glossary.md:14
  error  manni:term/label-collision      "Bifocal" is claimed by docs/terms/bifocal.md:5 as "bifocal"
docs/terms/lens.md:4
  error  manni:term/broader-cycle        broader: lens > corrective-lens > lens
docs/terms/trifocal.md:1
  notice manni:term/unused-term          no page's concepts: names this term

3 errors, 1 notice in 34 terms
$ echo $?
1
```

`undefined-term` names the alt-label that would have matched. A termbase is
mostly synonyms. The difference between "you have not defined this" and "you
have, under another name" is the whole finding.

**5. The definitions, against the house voice.**

```console
$ manni term lint terms
terms/pod.md:6
  error  manni:term/prose/Moose.EmDash   Em dash.
                                         Split or restructure the sentence rather than swapping punctuation.
terms/pod.md:7
  error  manni:term/prose/Direct.Length  Sentence runs to 33 words. Split it.
terms/pod.md:13
  error  manni:term/prose/Moose.EmDash   Em dash.
                                         Split or restructure the sentence rather than swapping punctuation.

3 errors in 1 term
$ echo $?
1
```

The `abstract` sits on line 6. The folded `definition` starts on line 7, so its
finding is there. The second line of a literal `scope-note` block is line 13,
and its finding lands on it exactly. With `[*.definition.md]` setting
`Direct.Length = NO`, the same run drops the line 7 finding and keeps the
other two.

**6. CI, annotated on the diff.**

```console
$ manni term check -f github
::error file=docs/guides/fitting.md,line=6,title=manni%3Aterm/undefined-term::concepts: "PAL" names no entry. "progressive lens" lists it as an alt-label.
```

The colon in the rule id is escaped, as it is in every domain's annotations,
because a workflow command reads `:` as a separator.

`-f sarif` and `-f junit` carry the same rule id and the finding's own message.
A SARIF rule is described in the words of the rules reference, and a `check`
rule's `helpUri` is its section of that page:

```json
{
  "id": "manni:term/undefined-term",
  "shortDescription": {
    "text": "A page's concepts: names a label no entry claims as its preferred label."
  },
  "helpUri": "https://hawkeyexl.github.io/manni/term/reference/rules/#undefined-term"
}
```

A `lint` rule is Vale's, so it is described by Vale's rule name and carries no
`helpUri`.

**7. Ramping in on a docset whose terms were never checked.**

```console
$ manni term check --baseline
✓ 41 findings recorded in .manni-term-baseline.json
$ echo $?
0
```

**8. The round trip.** Read a DocBook glossary, write one page per term.

```console
$ manni term write docs/glossary.xml -f markdown -o docs/terms/
Wrote 34 terms to docs/terms/, one file each
```

and back into a single Markdown definition list, which cannot hold every field:

```console
$ manni term write docs/terms/ -f markdown -o glossary.md
Wrote 33 terms to glossary.md
  dropped from a definition list: scope-note on 3 terms, hidden-labels on 12
  skipped 1 term a definition list cannot read without a definition: varifocal
```

`varifocal` is a redirect. It has `see` and no definition, and a definition
list would read it back as nothing.

**9. The handoff.**

```console
$ manni term write -f tbx -o build/terms.tbx
Wrote 34 terms to build/terms.tbx
```

**10. The Vale style.** No `-o`; Vale reports where its styles live.

```console
$ manni term write -f vale
Wrote 34 terms to .vale/styles/Terms
  Casing.yml      6 labels
  Lowercase.yml   21 labels
  Deprecated.yml  12 swaps
  PAL.yml         1 acronym
  ABS.yml         1 acronym
notice: no section of .vale.ini uses the Terms style. Add it to BasedOnStyles:
  [*.md]
  BasedOnStyles = Voices, Direct, Moose, Terms
```

Once wired, a guide run through Vale reads:

```console
$ vale docs/guides/fitting.md
 5:3    warning  Spell out 'PAL' on first use, as 'progressive lens (PAL)'.  Terms.PAL
 7:37   warning  Use 'progressive lens' instead of 'no-line bifocal'.        Terms.Deprecated
 11:25  error    Use 'Kubernetes' instead of 'kubernetes'.                   Terms.Casing
 13:29  warning  Use 'Kubernetes' instead of 'Kubernates'.                   Terms.Deprecated
```

**11. Keeping the style in step.**

```console
$ manni term write -f vale --check
.vale/styles/Terms is up to date
$ echo $?
0
```

After a hidden-label is added to a term:

```console
$ manni term write -f vale --check
.vale/styles/Terms/Deprecated.yml would change
$ echo $?
1
```

Each differing path is named with what would happen to it: `would change`,
`would be created` or `would be removed`. `--dry-run` prints the same lines and
writes nothing. A render that drops fields or skips entries adds the lines a
write prints.

**12. Scripting.**

```console
$ manni term list -f csv | head -2
id,label,alt-labels,abstract
progressive-lens,progressive lens,PAL|graduated lens,Lenses that correct presbyopia without a visible line.
```

**13. Every option at once.**

```console
$ manni term write docs/ - --as markdown \
    --exclude 'docs/archive/**' --exclude 'docs/drafts/**' \
    --collection site --collection blog \
    -c ./manni.config.yaml -f docbook -o build/glossary.xml \
    --dry-run --no-color
```

**14. What is read and written.**

```console
$ manni term formats
markdown   page               read  write
markdown   definition list    read  write
mdx        page               read  write
mdx        definition list    read  write
asciidoc   page               read  write
asciidoc   [glossary] list    read  write
rst        page               read  write
rst        .. glossary::      read  write
html       page               read  write
html       dl                 read  write
html       dfn                read
xml        page               read  write
xml        DITA glossentry    read  write
xml        DITA glossgroup    read  write
xml        DocBook glossary   read  write
manifest   manifest           read  write
tbx        TBX v2 Core              write
skos       JSON-LD                  write
csv                                 write
json                                write
vale       style                    write
```

The listing is built from the registered readers and writers, so it names only
what runs.

### The usage errors

| Invocation | stderr | Exit |
|---|---|---|
| `term check` with no terms anywhere | `manni: no terms found. A term is a page declaring type: term, or an entry in a file declaring type: term-set.` | 2 |
| `term.paths` in config | `manni: manni.config.yaml: term does not carry "paths". Name a collection under collections:.` | 2 |
| `term check -` with no `--as` | `manni: reading stdin needs --as <format>.` | 2 |
| `term check nowhere/` | `manni: File not found: "nowhere/".` | 2 |
| `term get missing` | `manni: no term "missing". 34 terms.` | 2 |
| `term get progressive-lenz` | `manni: no term "progressive-lenz". 34 terms; did you mean "progressive-lens"?` | 2 |
| `term write -f tmx` | `manni: unknown format "tmx". Expected markdown \| mdx \| asciidoc \| rst \| html \| dita \| docbook \| tbx \| skos \| csv \| json \| vale.` | 2 |
| `term write -f tbx` with no `-o` | `manni: -f tbx needs -o <path>.` | 2 |
| `term write -o out.md` with no `-f` | `manni: -o needs -f <format>.` | 2 |
| `term write -f json -o x.json --check --dry-run` | `manni: --check and --dry-run cannot be combined.` | 2 |
| `term write -` with no `-f` | `manni: <stdin> has nowhere to write back to. Pass -f <format> -o <path>.` | 2 |
| `term write` over a page holding `<dfn>` terms | `manni: glossary.html: a dfn cannot be written in place. Pass -f <format> -o <path>.` | 2 |
| `term write -f vale` with no Vale on PATH | `manni: vale is not on PATH. Install Vale, or pass -o <styles directory>.` | 2 |
| `term write -f vale`, no Vale config found | `manni: Vale found no config file. Set tools.vale.config in manni.config.yaml, or pass -o <styles directory>.` | 2 |
| `term write -f vale`, an unmarked file in `Terms/` | `manni: .vale/styles/Terms/Casing.yml was not written by manni. Move it, or pass -o <styles directory>.` | 2 |
| `term write -f vale`, an acronym named like a rule file | `manni: the acronym "CASING" would replace Terms/Casing.yml. Rename the alt-label.` | 2 |
| `term write -f vale`, two acronyms that share a file name | `manni: the acronyms "R&D" and "R+D" would both write Terms/R-D.yml. Rename one.` | 2 |
| `term lint` with no Vale on PATH | `manni: vale is not on PATH. Install Vale to lint definitions.` | 2 |
| `tools.vale.config: nowhere.ini` | `manni: manni.config.yaml: tools.vale.config "nowhere.ini" does not exist.` | 2 |
| `term.manifests: [terms/missing.yaml]` | `manni: manni.config.yaml: term.manifests "terms/missing.yaml" does not exist.` | 2 |
| `severity: {undefined-term: fatal}` | `manni: manni.config.yaml: term.severity.undefined-term "fatal" is not a level. Expected notice \| warning \| error \| off.` | 2 |

Exit codes are the family's. `0` is clean, `1` is an error-severity finding or
a `--check` that found drift, and `2` is operational or usage.

### The programmatic API

`src/index.ts` is unchanged. The term domain exports its own barrel,
`src/term/index.ts`, which the umbrella mounts and nothing else imports:

| Export | Kind | What it is |
|---|---|---|
| `buildProgram()` | function | The commander program `src/cli.ts` mounts |
| `Term` | interface | The generic record every reader produces |
| `TermReader` | interface | The per-construct read seam, as `MetadataExtractor` is |
| `TermWriter` | interface | The per-construct render seam |
| `TERM_RULES` | const | The ten rule names |
| `TermError` | class | `extends ToolError` |

`src/meta/internal.ts` gains the element and frontmatter splice helpers, because
the lint rule that closes `../meta/extractors/*` to sibling domains leaves it as
the one door. `src/shared/tools.ts` is new and family-wide.

Two new drafts land under `docs/proposals/0023/schemas/`. They are
`terminology/1.0.0-proposal.1.json` and `kg/1.0.0-proposal.4.json`. Nothing
registers, and 0023's review concludes before anything does.

## Stress test

**1. Why not put the fields inside `kg`?** An earlier draft did, on the grounds
that kg already carries `label` and `alt-labels`. It was wrong for two reasons.
A record that only exists inside another tool's envelope makes that tool a
dependency of writing a definition. And the `kg` envelope is the family's one
exception to flat keys, kept because a closed block catches typos on an open
page. A second exception turns an exception into a pattern. The harvest rule in
§ 2 gets the same integration without either cost, and it is kg's own mechanism.

**2. `type: term` against a closed taxonomy.** `src/meta/schemas/tgdp/1.0.json`
constrains `type` to an enum, which holds `glossary` and `terminology-system`
but not `term`. A docset composing that schema over its term pages gets a
failure. The two vocabularies are at different grains. tgdp's `glossary` is a
page that is a list of terms, which is this proposal's `term-set`. A docset
scopes the taxonomy schema to the pages it was written for, through the override
it already uses.

**3. Why not fold this into `meta`?** Much of it is meta. The record is a
vocabulary, `validate` checks the shape, and a term page is a row of `docs`. What
is left is what meta cannot do. It resolves references between entries. It reads
a body construct rather than a metadata channel. And it renders a set into a
format it did not come from. The test is whether a rule can be written as a `checks:`
statement over one row at a time. `broader-cycle` and `label-collision` both
fail it, and a `term-set` file fails it twice, because its entries are not rows.

**4. Does this duplicate `checks:` (0026)?** Partly, and deliberately. Both
`undefined-term` and `unused-term` are expressible as SQL over `json_each`.
`broader-cycle` is not, and neither is `duplicate-id` across a manifest and a
page. The ten rules could be split across two mechanisms by whether SQL happens
to reach them. That would make the set's correctness a property of where a rule
was cheapest to write.

**5. A term in two homes.** Consider a page with `id: bifocal` and a manifest
entry keyed `bifocal`. This is `duplicate-id`, at error, on both. It is not a
merge, and not a precedence rule. 0020 settled this, noting that any precedence
rule discards exactly the value nobody is checking. 0037 settled it again for
manifests. A collision is a finding there, and the document's value is kept, so
the report shows what is published.

**6. A lossy render.** § 5 reports dropped fields rather than refusing. The
alternative refuses to render a set into a construct that cannot hold it. Then a
Markdown definition list is unreachable for any set carrying a scope note.
The loss is a property of the target, it is known before the write, and
`--dry-run` shows it without touching a file.

**7. In-place write into a body construct.** Rewriting one entry of a Markdown
definition list is a body edit, and the family has only ever edited metadata in
Markdown. The splice machinery exists for HTML and XML, where the parser gives
byte ranges. For the three text formats it is new work, and it is the largest
single piece of this proposal. Without it the round trip runs one way, and a
one-way converter is a migration tool rather than a way to keep a termbase.

**8. `manni term lint` beside the `lint` domain.** Two commands carry the word
and they do different things. `manni lint` checks a document against a doctype
template. `manni term lint` checks the definitions manni holds. The alternative
names considered were `prose`, `voice` and `style`, and each is less clear about
what it runs. The domain in front of the verb is what disambiguates, which is
what 0034's grammar is for.

**9. Why `vale ls-config` rather than reading the ini.** Vale's configuration
merges a global styles directory, package configs under `.vale-config/`, and the
project file, in an order Vale defines. A reader of `.vale.ini` alone reports a
`StylesPath` Vale may not use, and misses a style a package enables. Asking Vale
costs one process and cannot disagree with the Vale run that follows it. The
price is that `write -f vale` without `-o` needs Vale installed, which a docset
running Vale already has.

**10. `abstract` against `description`.** `manni:core.description` says what the
page is about. `abstract` says what the *term* is, in a sentence. They coincide
on a well-written term page and diverge everywhere else. A manifest entry has no
page and therefore no description. An entry read from a definition list has no
description either. Deriving one from the other was considered and dropped. It
is right often enough to be trusted, and wrong often enough to be wrong silently.

**11. Localization.** The record is single-language, and `manni:core.language`
says which. TBX's `langSet` and CSV's `Term [en]` both carry a language, so a
render names the language the entry declares. Multi-language entries hold one
concept with terms in several languages. That is what TBX exists for, and what
this record cannot express. The natural shape is one set per language, joined on
`id`. Whether that is enough wants a docset that needs it.

**12. `unused-term` on a termbase written first.** A set authored ahead of the
docs is entirely unused terms, so the rule fires on every entry of a healthy new
termbase. It is a notice, it never moves the exit code, and
`severity: {unused-term: off}` turns it off. The alternative reports it only past
some threshold of use. That would make the finding depend on the size of the
thing being checked, which is not a property of any entry.

**13. Ten rules is where it stops.** The survey found no tool implementing a
check outside this set, and none implementing more than a subset. An eleventh
rule should have to name a tool that shipped one.
