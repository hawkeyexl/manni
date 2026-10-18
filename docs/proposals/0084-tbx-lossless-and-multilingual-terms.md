# 0084: TBX in both directions, lossless and multilingual

- **Status:** Accepted
- **Serves:** Two journeys.
  - Devin · D8, "Hand the termbase to localization". The termbase now comes
    back from the translation system, and he reads it.
  - Sara · S6, "Define our terminology and make `concepts:` mean something".
    One concept holds a term per language, and each carries what a translator
    needs.
- **Depends on:** Three earlier proposals.
  - [0052](0052-term-domain.md) is the `term` domain and the record this
    extends.
  - [0067](0067-registering-the-vocabularies.md) registered
    `manni:terminology:1.0.0`, and said a later version registers beside it.
  - [0066](0066-strict-vocabulary-overlays.md) is what a strict overlay may
    hold, which the picklists use.
- **Relates to:** Three records.
  - [0076](0076-artifact-evals-1-1-0-tool-order.md) is the 1.1.0 precedent:
    two ids register beside 1.0.0, and 1.0.0 keeps its bytes.
  - [0018](0018-write-support-shipped-for-all-three.md) set the rule that a
    tool writes where it reads. TBX was the one format `term` wrote and could
    not read.
  - [0063](0063-the-graph-vocabulary.md) owns the graph's harvested keys,
    which every new key name was checked against.
- **Supersedes, in part:** [0052](0052-term-domain.md), in three places. Its
  Status line is the only edit.
  - Question 11, the single-language record.
  - The verdict that `tbx` is TBX v2 Core and written only.
  - § 1's "no `status` field", for the per-designation override only. The kind
    of label is still the status when no override is written.
- **Touches:** `src/term/types.ts`, `src/term/core/readers/` (`tbx.ts` and
  `tbx-model.ts` new; `normalize.ts`, `page.ts`, `manifest.ts`,
  `structured.ts`), `src/term/core/load-set.ts`, `src/term/core/check.ts`,
  `src/term/core/writers/` (`tbx.ts`, `csv.ts`, `documents.ts`, `merge.ts`
  new, `render-util.ts`), `src/term/commands/`, `src/term/reporters/`,
  `src/meta/schemas/terminology{,-strict}/1.1.0.json` (new),
  `src/meta/core/schema-registry.ts`, `docs/src/content/docs/term/`,
  `test/term/`, `test/fixtures/term/`
- **Verdict:** A TBX file, v2 or v3, from any vendor, reads into the term set
  and writes back without loss. Each language of an entry is a term of its
  own, joined to its siblings on `id`. Every TBX-Basic and TBX-Linguist data
  category is a named field, in `manni:terminology:1.1.0`. Anything else rides
  through whole, in `tbx-elements`. `-f tbx` writes v2 and `-f tbx3` writes v3.

## Problem

### The termbase never comes back

`manni term write -f tbx` sends the set to a translation system. The
translators' termbase returns as TBX, often v3. It holds German and French
terms, part of speech, gender, usage contexts and vendor fields. memoQ, Phrase,
Smartling, Crowdin, IATE and the Microsoft collection all export it.

manni could not open it. A named `.tbx` stopped with `no reader for its
extension`, and a directory walk skipped it. Devin re-keyed translations into
pages by hand, or gave up on `term check` for the docs that are not in English.

### One language per record

0052's question 11 left the record single-language. It named the natural
shape, one set per language joined on `id`, and waited for a docset that
needed it.

That docset is the ordinary one. `docs/en/glossary/pal.md` and
`docs/de/glossary/pal.md` describe one concept. The check reported both
`duplicate-id` and `label-collision` for doing the normal i18n thing.

### Nowhere for what a translator needs

The record held ten fields. Gender, part of speech, term type and a superseded
status had nowhere to live. The TBX writer could only report them dropped.

## Decision

### 1. One term per language, joined on `id`

A TBX entry holds one concept, in a `langSet` (v2) or `langSec` (v3) per
language. Each language reads as a term of its own. Its `language` is the
section's `xml:lang`, else the root's. Every term of the entry carries the
entry's `id`, so siblings join on it.

Pages and manifests say the same thing with `manni:core`'s `language`. A
manifest entry carries `language` beside its fields. A term that names no
language counts as `en`, which every writer already assumed.

The rejected alternative was one record holding every language. Graph, Vale,
`check` and `meta query` all read `label` as one string. A map of labels by
language would change every one of them.

### 2. The record: `manni:terminology:1.1.0`

1.0.0 keeps its bytes, because a published id is immutable. 1.1.0 and its
strict overlay register beside it. Every 1.0.0 page is valid 1.1.0, and every
new key is optional.

Before, a 0052 page, still valid:

```yaml
type: term
id: progressive-lens
label: progressive lens
alt-labels: [PAL]
hidden-labels: [no-line bifocal]
definition: Corrective lenses whose power increases continuously.
```

After, the `en` term a TBX-Basic entry reads as. The `de` term is a sibling
with the same `id`.

```yaml
type: term
id: progressive-lens
language: en
label: progressive lens
alt-labels: [PAL]
hidden-labels: [no-line bifocal]
definition: Corrective lenses whose power increases continuously.
sources: [ISO 13666]
concept-entry:
  subject-field: optics
  tbx-elements:
    - <descrip type="Client">Acme</descrip>
designations:
  - term: progressive lens
    part-of-speech: noun
    term-type: fullForm
  - term: PAL
    term-type: acronym
  - term: no-line bifocal
    administrative-status: superseded
```

The level of a value is where it sits. TBX states a value at the concept, at
one language, or at one designation. Concept level goes in `concept-entry`.
Language level sits at the root. Term level goes in a `designations` item.

`label`, `alt-labels` and `hidden-labels` stay plain strings, for the readers
named above. `designations` is a list rather than a map, so TBX order and
homographs survive.

#### Aux fields, valid at all three levels

| Key | Type | TBX |
|---|---|---|
| `definition` | string | `descrip type="definition"` |
| `subject-field` | string | `descrip type="subjectField"` |
| `contexts` | string or list | `descrip type="context"` |
| `notes` | string or list | `note` |
| `sources` | string or list | `admin type="source"` |
| `customer-subsets` | string or list | `admin type="customerSubset"` |
| `project-subsets` | string or list | `admin type="projectSubset"` |
| `cross-references` | list of `{target, text?}`, or a target | `ref type="crossReference"` |
| `external-cross-references` | the same | `xref type="externalCrossReference"` |
| `graphics` | the same | `xref type="xGraphic"` |
| `transactions` | list of `{type, date?, responsibility?}` | `transacGrp` |
| `tbx-elements` | list of XML strings | anything no named field maps |

`definition` and `subject-field` hold one value. A `date` is kept as written.

#### Term-level keys, valid only in a `designations` item

| Key | Type | Strict 1.1.0 |
|---|---|---|
| `term` | string, required | one trimmed line |
| `administrative-status` | string | `preferred`, `admitted`, `deprecated`, `superseded`, `none` |
| `part-of-speech` | string | `adjective`, `noun`, `other`, `verb`, `adverb`, `properNoun` |
| `grammatical-gender` | string | `masculine`, `feminine`, `neuter`, `other` |
| `grammatical-number` | string | `singular`, `plural`, `dual`, `mass`, `otherNumber` |
| `term-type` | string | `fullForm`, `acronym`, `abbreviation`, `shortForm`, `variant`, `phrase` |
| `term-location` | string | the TBX-Basic interface picklist |
| `register` | string | the TBX-Linguist register picklist |
| `geographical-usage` | string | open |
| `reading`, `reading-note` | string | open |
| `transfer-comments` | string or list | open |

`transfer-comments` is a TBX-Linguist termNote, so it is a term-level key
only. The Linguist element types were pinned from the LTAC module files.

#### Root blocks

| Key | Type | What it holds |
|---|---|---|
| `concept-entry` | object of aux fields | The concept level, the same on every language's term of the id. |
| `designations` | list | Detail per designation, in TBX order. A label it does not name follows in label, alt-label, hidden-label order. |
| `tbx-markup` | list of inline XML strings | The marked-up form of any value whose text it matches. |

A `tbx-markup` item stands in for the plain value it matches. An item whose
value was edited matches nothing, so it is never written.

Two values of one term can read as the same text with different markup, such
as a marked-up `H<hi type="subscript">2</hi>O` and a plain `H2O`. The reader
then keeps one element whole in `tbx-elements`, never the `<term>`, so neither
value gains the other's markup. A concept-level value is held to every
language of its entry, since one concept level serves them all.

### 3. Status and the kind of label

0052 made the kind of label the status, and that still holds where nothing
overrides it. TBX carries more statuses than SKOS has kinds, so a designation
may name its own.

| TBX `administrativeStatus` | Read as |
|---|---|
| `preferredTerm-admn-sts` | `label`. A second preferred term is an alt-label with `administrative-status: preferred`. |
| `admittedTerm-admn-sts` | an alt-label |
| `deprecatedTerm-admn-sts` | a hidden-label |
| `supersededTerm-admn-sts` | a hidden-label, with `administrative-status: superseded` |
| a nonstandard value | an alt-label, with the value as written |
| none at all | an alt-label, with `administrative-status: none` |

When no designation is preferred, the first one is the label. Its item then
says `administrative-status: none`, so the write puts no status back.

### 4. What lossless means

Lossless is four claims, each tested.

1. An in-place `term write` with no edit leaves a TBX file byte-identical, with
   LF or CRLF.
2. Read, write as `tbx` or `tbx3`, and read again. The records are deep-equal,
   with every field, `designations`, `tbx-elements`, `tbx-markup` and
   `language`.
3. A file in manni's own layout exports byte-identical at its version.
4. A third-party file exports XML-equivalent at its version. The comparison
   ignores only whitespace between elements, attribute order and quote style.

The fidelity rule makes the third and fourth hold. An element maps to a named
field only when the canonical form writes it back unchanged. Anything else goes
into `tbx-elements` whole, at its level, attributes included. That covers these
cases.

- An unknown category, or a vendor one.
- An element with an extra attribute.
- A second value of a single-valued category at one level.
- A `descripGrp` holding a definition alone, a context with a source, or
  anything nested.
- A `source` or `note` beside a definition but outside its group, since the
  canonical form groups them.
- A status written as a bare `preferred` rather than its picklist value.
- A value holding a DTD entity reference such as `&acme;`. No DTD is loaded,
  so the reference reads as literal text, and a named field would write it
  escaped. A `<term>` keeps its text, and the reference rides in `tbx-markup`.

DCT style reads too. A v3 `min:`, `basic:` or `lng:` element maps to the field
its DCA spelling does. An element in an unknown namespace goes to
`tbx-elements` with its namespace declared on the item.

### 5. The header stays out of the record

The prolog, the DOCTYPE, `xml-model` instructions, the root tag, the
`martifHeader` or `tbxHeader`, and `<back>` belong to the file. A term page has
nowhere to keep them. An in-place write never touches them.

## Interface

### Config

No new key. `term.manifests` accepts a `.tbx` file, and a manifest entry may
carry `language`.

```yaml
# before
meta:
  overrides:
    - schemas: [manni:terminology:1.0.0, manni:terminology-strict:1.0.0]
term:
  manifests: [terms/extra.yaml]
```

```yaml
# after
meta:
  overrides:
    - schemas: [manni:terminology:1.1.0, manni:terminology-strict:1.1.0]
term:
  manifests: [terms/extra.yaml, terms/vendor.tbx]
```

### Reading TBX

The term loader reads `.tbx`, not a meta extractor. Put in the XML extractor,
`meta validate docs/` would hold termbases to title and description rules.
`manni meta` is unchanged.

- A named `.tbx` file is read.
- A directory or glob walk includes `.tbx`. Term's default `--ext` is meta's
  list plus `tbx`.
- `--as tbx` reads stdin.
- The version comes from the root element. `<martif>` is v2, and `<tbx>` is v3.

### Writing TBX

| `-f` | Writes |
|---|---|
| `tbx` | TBX v2, `<martif type="TBX">` |
| `tbx3` | TBX v3, `<tbx type="TBX-Basic" style="dca">`, or `TBX-Linguist` when a term carries a Linguist-only field |

Both write one entry per id, in first-appearance order, with a language
section per term. They hold every field except `abstract`, `broader`,
`narrower`, `related-terms`, `see` and `scope-note`, which are reported
dropped. The status comes from `administrative-status`, else from the kind of
label.

The root `definition` now sits in its language section. Once two languages
share an entry, an entry-level definition cannot say whose it is.

Where the terms came from decides the header.

- **All from one TBX file, at the version `-f` names.** Unchanged entries, and
  everything outside them, are copied byte for byte. A changed entry is
  written canonically, keeping the attributes and layout it was read with.
- **All from one TBX file, at the other version.** Every entry is canonical.
  The header's children and `<back>` are carried, with `refObjectList` renamed
  `refObjectSec` or back.
- **Anything else.** manni's own header, and each TBX source is reported as a
  header dropped.

Where terms sharing an id disagree on `concept-entry`, the entry keeps the
first term's value and the run says so.

### The other writers

| Writer | Change |
|---|---|
| `csv` | One row per id. The per-language columns are unchanged. Every field outside the ten 1.0.0 fields is reported dropped. |
| `json`, pages, manifests | Hold every field. |
| a page directory | `<lang>/<id>.<ext>` when the set holds more than one language. |
| a one-file document | Writes the first term's language, and names the terms left out. |
| `skos` | Unchanged. The new fields are reported dropped. |
| `vale` | Unchanged. A superseded designation is a hidden-label, so it feeds `Deprecated.yml`. |

### `term list` and `term get`

- `term list` pretty adds a language column after the id, only when the set
  holds more than one language. `-f csv` appends a `language` column. `-f json`
  keeps its shape and carries the new keys.
- `term get` pretty adds a row per new field, plus `concept-entry`,
  `designations`, a `tbx-elements` count and `other languages`. The key column
  widens only when a longer key is shown, so earlier output is unchanged.
- `term formats` gains `tbx  TBX entry  read write`, relabels `TBX v2 Core`
  as `TBX v2`, and adds `tbx3  TBX v3  write`.

### The ladder

```console
$ manni term list glossary.tbx
progressive-lens   en   progressive lens   PAL
progressive-lens   de   Gleitsichtglas     Gleitsichtbrille
bifocal            en   bifocal
bifocal            de   Bifokalglas
4 terms

$ manni term get PAL glossary.tbx
progressive lens                        glossary.tbx:15
  id               progressive-lens
  language         en
  alt-labels       PAL
  hidden-labels    no-line bifocal
  definition       Corrective lenses whose power increases continuously.
  concept-entry    subject-field: optics
  designations     progressive lens: part-of-speech noun, term-type fullForm
                   PAL: term-type acronym
                   no-line bifocal: administrative-status superseded
  tbx-elements     1 in concept-entry
  other languages  de (Gleitsichtglas)

$ manni term list - --as tbx -f csv < glossary.tbx
id,label,alt-labels,abstract,language
progressive-lens,progressive lens,PAL,,en
progressive-lens,Gleitsichtglas,Gleitsichtbrille,,de
bifocal,bifocal,,,en
bifocal,Bifokalglas,,,de

$ manni term write glossary.tbx
Nothing to write

$ manni term write glossary.tbx -f tbx -o build/v2.tbx
Wrote 4 terms to build/v2.tbx

$ manni term write glossary.tbx -f markdown -o docs/terms/
Wrote 4 terms to docs/terms/, one file each
  dropped from a page: the header of glossary.tbx

$ manni term write docs/terms/ -f tbx3 -o build/terms.tbx
Wrote 4 terms to build/terms.tbx
  kept the first language's value where languages differ: concept-entry.subject-field on 1 concept

$ manni term write docs/terms/ -f tbx3 -o build/terms.tbx --check
build/terms.tbx would change

$ manni term write glossary.tbx -f markdown -o build/glossary.md
Wrote 2 terms to build/glossary.md
  dropped from a definition list: hidden-labels on 1 term, concept-entry on 1, designations on 1
  dropped from a definition list: the header of glossary.tbx
  skipped 2 terms in another language than en: progressive-lens (de), bifocal (de)
```

The `--check` rung exits `1`. Every other rung exits `0`.

### Usage errors

Each goes to stderr and exits `2`.

| Invocation | Message |
|---|---|
| `term list notes.tbx`, root `<glossary>` | `manni: notes.tbx: is not TBX: its root element is <glossary>, not <martif> or <tbx>.` |
| `term list broken.tbx` | `manni: broken.tbx: could not be read as tbx: Invalid XML: <parser message>` |
| `term write -f tbx3` | `manni: -f tbx3 needs -o <path>.` |
| `term write -f tbx3 -o out/` | `manni: -f tbx3 writes one file, not a directory. Pass -o <file>.` |
| `term write -f tbx4 -o x` | `manni: unknown format "tbx4". Expected markdown \| mdx \| asciidoc \| rst \| html \| dita \| docbook \| tbx \| tbx3 \| skos \| csv \| json \| vale.` |
| `term write - --as tbx` | `manni: <stdin> has nowhere to write back to. Pass -f <format> -o <path>.` |
| `-o d/`, one id twice in one language of a multilingual set | `manni: two terms have the id "api" in de, and a directory holds one file per id in each language.` |
| `-o d/`, a language holding a path character | `manni: the language "../de" cannot name a directory. Give the term a language without path characters.` |

### Notices

These go to stderr and never move the exit code.

- `glossary.tbx:88: skipped a TBX entry with no term.` A language section with
  no `<term>` is left out.
- `docs/terms/pal.md:7: ignored designations item "progresive lens" on
  "progressive lens": it names no label, alt-label or hidden-label.`

A missing preferred term, a nonstandard picklist value and a pass-through item
get no notice. Nothing is lost in any of them, and the strict overlay is where
values are policed.

### Programmatic API

| Export | Change |
|---|---|
| `src/index.ts` | unchanged |
| `src/term/index.ts`, `Term` | `record` gains the 1.1.0 keys |
| `src/term/index.ts`, `TermReader` | `construct` gains `tbx-entry` |
| `src/term/index.ts`, `TermWriter` | `format` gains `tbx3` |

## `term check` is language-aware

The ten rules and their messages hold, as 0052's question 13 set them. Language
compares ignoring case, and no language counts as `en`.

| Rule | Change |
|---|---|
| `duplicate-id` | Groups by id and language. |
| `label-collision`, `alt-label-collision` | Within a language, as before. Across languages, only when the folded labels match and the spelling differs. |
| `dangling-reference`, `broader-cycle`, `asymmetric-hierarchy` | Resolve to a same-language label, then a same-language id, then any language. |
| `unused-term` | A term is used when a page names any term sharing its id. |
| the other four | Unchanged. |

The cross-language rule follows the Vale style. Its swap map is keyed on the
lowercased term, so `Kubernetes` in one language and `kubernetes` in another
would collide there silently. `API` in both is one word, and collides nowhere.

## Stress test

**A vendor file with no ids.** Microsoft's collection leaves some entries
without `id`. Such an entry takes the slug of its first language's label. An
unchanged entry is copied as it was. A rewritten one gains the attribute, which
the ceilings below record.

**Two languages that disagree on the concept.** `de` says `Optik` and `en`
says `optics` for one `subject-field`. TBX holds one concept-level value, so
the export keeps the first and reports the field. The pages keep both.

**Inline markup in a definition.** `<hi>`, `<foreign>`, `<sc>`/`<ec>` and
`<bpt>`/`<ept>` read as plain text in the field, and the marked-up form goes
to `tbx-markup`. Vale and the check see the text, and the write puts the markup
back. An edited value no longer matches, so its stale markup is not written.

**A German page that reuses the English label.** `API` in both languages is
not a collision. `Kubernetes` against `kubernetes` is, because the Vale style
cannot tell them apart.

## Ceilings and open questions

A changed entry rewritten at its own version keeps its structural attributes
and its `ntig` layout. Languages pair by `xml:lang`, and designations by text,
then by order. What it still loses is listed here.

- Siblings within a level take the canonical order.
- A comment, processing instruction or CDATA section between structural
  children is dropped. One inside a value rides in `tbx-markup`.
- A language section with no designation is dropped, with the notice.
- An `ntig`'s children are normalized to the `termGrp` layout.
- manni writes its own `id` and `xml:lang` first among the attributes.
- An entry without `id` gains one.

Across versions, more changes. A v2 to v3 export, or back, drops the prolog.
DCT style becomes DCA, and an `ntig` becomes a plain `tig` or `termSec`. The
records still compare equal.

Two ceilings hold at every version.

- UTF-8 TBX only.
- Inline tags are not converted between v2's `bpt`/`ept` and v3's `sc`/`ec`.
  A `tbx-markup` item is written as it was read.

One question is open. `broader`, `narrower`, `related-terms`, `see`, `abstract`
and `scope-note` do not survive a trip through TBX, because TBX-Basic has no
category for them. TBX can state concept relations through
`crossReference` and the concept-relation categories of other dialects.
Mapping the first three onto those is not decided.
