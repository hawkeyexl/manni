# 0077: graph reads every format lint parses

- **Status:** Proposed
- **Serves:** Maya · M18, "See the docset as a graph, and find what nothing
  links to", M19, "See what a change to one page affects before making it",
  and M20, "Fill the categorization nobody wrote", for docsets that are not
  Markdown.
- **Depends on:** [0051](0051-graph-domain.md), the domain and its input
  surface. [0020](0020-element-metadata.md), for where HTML and DITA metadata
  lives and how meta writes it.
- **Relates to:** hawkeyexl/moose-kg#49, which built the same reading for
  dockg before the fold and never merged. Its reviews are where most of the
  rules below come from.
- **Supersedes, in part:** [0051](0051-graph-domain.md) § 1, for the
  known-format list behind `--as` and the `--ext` default. Its Status line is
  the only edit. [0046](0046-provenance-pins.md), for the sentence that
  leaves `meta-provenance` out of HTML and XML pages because an attribute
  cannot hold a list. § 4 below makes the list fit.
- **Touches:** `src/lint/types.ts`, `src/lint/parsers/{index,sectionize,metadata,html,xml,asciidoc,rst}.ts`,
  `src/lint/commands/lint.ts`, `src/meta/extractors/{html-write,xml-write}.ts`,
  `src/graph/core/{analyze,discover,config,search-index,iirds-package,external,fill-guard}.ts`,
  `src/graph/commands/fill.ts`, `src/graph/cli.ts`, `test/**`,
  `docs/src/content/docs/graph/**`
- **Verdict:** graph reads HTML, XML (DITA, DITA maps and DocBook), AsciiDoc
  and reStructuredText through lint's parsers. Markdown and MDX keep graph's
  own reader and every golden. `--ext` defaults to lint's walk set. `fill`
  writes into those pages through meta's per-format writers.

## Problem

`manni graph` reads Markdown and MDX. Every other format either refuses or,
worse, reads as Markdown:

- `--as html` exits 2 with `Unknown format "html". Known formats: markdown, mdx.`
- `--ext .html` or a glob over `*.html` is accepted, and the analyzer maps
  every extension but `.mdx` to Markdown. An HTML corpus builds a clean graph
  with no sections and no links, and nothing says why.
- A named `page.html` is filtered out and reported as `No input files matched`.
- `graph fill` on an HTML page would prepend a YAML fence before `<!DOCTYPE`.

Meanwhile the family already parses those formats twice. `manni meta` reads
and writes their metadata, and `manni lint` builds a section tree for each.
lint's `SectionNode` was shaped after graph's `Section` for exactly this
reuse. What its tree did not keep is what a graph is made of: link targets
and the source's own anchors. Every parser met them and threw them away.

## Decision

### 1. lint's tree keeps links and ids

`DocumentTree` gains `links`, the raw targets in document order.
`SectionNode` and the heading fragment it is built from gain an optional
`id`, the source's own anchor. `slug` is still the slugged title, so no lint
rule or finding moves. lint's own suite passing unchanged is the proof.

Each parser keeps the value at the place it used to drop it:

| Format | Links | Section id |
|---|---|---|
| HTML | `href` on `<a>` and `<area>`, minus a heading's link to its own anchor | the heading's `id`, else the `id` of an enclosing `<section>` or `<article>`, for its first heading only |
| DITA, DITA map | `<xref href>`, `<link href>` including inside `<related-links>`, and the map's `topicref`-family `href` | `@id` |
| DocBook | `<link xlink:href>`, `<ulink url>`, and `linkend` as `#id` | `xml:id` |
| AsciiDoc | every `href` in the converted inline HTML, minus an unresolved `include::` | Asciidoctor's own id, `_install` and all |
| reStructuredText | embedded URIs, named references resolved against the page's own targets, and Sphinx `:doc:` | a `.. _label:` directly above a title |

Three rules come from moose-kg#49 and its review, each because the
alternative produced a wrong edge rather than a missing one:

- `href` comes from hyperlink elements only. `<link rel="stylesheet">` sits
  in the head of every page, and reading it would put a broken link on every
  page in the corpus.
- A DITA href without a scheme, `file.dita#topic/element`, addresses
  `#element`. One with a scheme is never rewritten. An external URL whose
  fragment holds a slash stays the URL its author wrote.
- AsciiDoc's cross-file xref keeps its `.adoc` suffix (`relfilesuffix`),
  because graph resolves links against sources. An unresolved `include::`,
  which Asciidoctor renders as an anchor, is not a link. Includes are never
  read: a graph must not depend on files outside the corpus.

### 2. graph builds non-Markdown documents from that tree

Markdown and MDX keep graph's mdast walk. It is what every golden pins, and
it reads link references and JSX attributes that lint's tree flattens.

Every other format takes lint's tree, meta's extractor for its metadata, and
graph's `classifyLink` for its links, so a link resolves the same way
whatever page it was written in. A section's anchor is the source's id
verbatim when an IRI fragment accepts it unchanged, else the slugged title.
`GUID-A1B2-C3D4` stays `GUID-A1B2-C3D4`, so a link written to it reaches it.
An id holding a space or a non-ASCII character is slugged, because a section
IRI is never percent-encoded. The level-0 lead and the heading lint adds from
a metadata title are not sections.

The `iirds:format` of a document is its source's media type rather than
always `text/markdown`. A search entry's text is its section's prose from the
tree. Markdown entries are byte-identical.

### 3. The input surface

| Flag | Was | Is |
|---|---|---|
| `--as <format>` | `markdown` or `mdx` | `asciidoc`, `html`, `markdown`, `mdx`, `rst` or `xml` |
| `--ext <list>` | `.md,.mdx,.markdown` | lint's walk set, read from lint's registry |

`.xml` is read when named and never collected from a walk, as in lint, so a
`pom.xml` is never swept into a graph. A named file no parser claims is
skipped with lint's own warning, now one function both domains call.

The default route `extensions` and the relative-link extensions widen to the
same list, Markdown first. A corpus holding `install.md` and a built
`install.html` resolves a pretty URL to the source. A link to a missing
`.html` page, which was an asset, is now a broken link: an HTML page is now a
document.

### 4. `fill` writes through meta

Page writes for Markdown and MDX keep graph's YAML editor. Every other format
goes through its meta extractor's `apply`, with the merged `graph` map, so
HTML gets a `<meta name="graph">`, DITA an `<othermeta>`, and a fenced
AsciiDoc or reStructuredText page its fence. The fill guard simulates with
the same function, so what is checked is what is written. A writer's refusal
becomes that page's `error`, with meta's message verbatim.

That needed one change in meta. Its HTML and XML writers refused any value
that serializes to more than one line, which every map does in block YAML.
They now write a collection as one line of YAML flow style, which their
readers already parse. Every scalar they wrote before is byte-identical.

So `manni meta fill` now writes its `meta-provenance` entry into HTML and XML
pages too, where it used to skip it as `unwritable`. A long value that YAML
used to fold at 80 columns, and the writers then refused, is written on one
line as well.

## Known limits

1. **DITA specialization is read by name.** lint's XML vocabulary matches
   elements by tag, not by `@class` ancestry. A specialized element is read
   only when the vocabulary lists it.
2. **Indirection derives nothing.** DITA `keyref`, `conkeyref` and `conref`,
   reStructuredText `:ref:` and AsciiDoc `include::` give no edge and no
   broken-link finding. A missing edge is the conservative direction, and a
   finding for something graph cannot resolve is one the author cannot act on.
3. **Markdown `{#anchor}` ids are still unread**, as before this proposal.
4. **The runtime resolver slices Markdown only.** It is built
   `platform: neutral`, and lint's parsers are not.
5. **An AsciiDoc or reStructuredText page with no YAML fence cannot be
   filled.** meta's writer says so, and the page is an `error`.

## Stress test

### 1. Why lint's parsers, not graph's own?

moose-kg#49 built a body-analyzer registry beside docmeta's, with an
analyzer per format. In manni that would be the third parse of each format
and the second section tree. lint's parsers are already maintained, already
tested against real documents, and already shaped like graph's sections.
What they lacked was additive.

### 2. Why not route Markdown through lint too?

Its graph would change. lint's Markdown tree drops link references,
definitions and JSX attributes, which graph reads, and every golden would move
to prove a refactor. The two readers can converge later as a change of its
own.

### 3. Why widen `--ext` rather than make the new formats opt-in?

A docset's format is not a preference. An opt-in default reproduces the
problem this proposal exists for: an HTML corpus builds an empty graph and
says nothing. A `docs/` tree that also holds built HTML can pass the old list
with `--ext`.

### 4. Why not write fill output to `{page}.meta.yaml` for every non-Markdown page?

It would be the smaller change. It would also put a page's categorization in
a second file the page's own tooling never reads, when meta already writes
each format in its native place.

## Consequences

- Good. HTML, DITA, DocBook, AsciiDoc and reStructuredText corpora derive
  sections, links, images and code languages, and a link resolves across
  formats in both directions.
- Good. `--as` and `--ext` list only formats that are read.
- Good. One message for an unclaimed file, in lint and in graph.
- Bad. A corpus that relied on `.html` links being assets will see them as
  broken links when the page is missing.
- Neutral. No predicate or node type is added, so the SHACL shapes are
  unchanged.

## Release

Three commits, `feat(lint)`, `feat(meta)` and `feat(graph)`, squash-merged as
`feat(graph): read html, xml, asciidoc and restructuredtext`, a minor.
