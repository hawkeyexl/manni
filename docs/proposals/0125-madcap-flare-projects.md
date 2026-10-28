# 0125: MadCap Flare projects

- **Status:** Accepted
- **Serves:** Five journeys, each for a docset kept in MadCap Flare.
  - Maya · M1, "Stand up metadata validation for my repo".
  - Maya · M10, "Hold every page to the shape its doctype promises".
  - Maya · M18, "See the docset as a graph, and find what nothing links to".
  - Devin · D16, "Gate every check a repo has set up, with one command". The
    gate runs on a Linux runner with no Flare install.
  - Sara · S6, "Define our terminology and make `concepts:` mean something".
    Her Flare glossary is the termbase.
- **Depends on:** Four earlier proposals.
  - [0020](0020-element-metadata.md) writes HTML metadata by splicing, and
    never by serializing.
  - [0077](0077-graph-reads-every-format-lint-parses.md) gives graph lint's
    HTML and XML trees, links included.
  - [0052](0052-term-domain.md) is the term domain whose readers a Flare
    glossary joins.
  - [0082](0082-a-site-domain-runs-the-docs-site.md) is the framework table a
    Flare project joins.
- **Supersedes in part:** [0077](0077-graph-reads-every-format-lint-parses.md)
  § 1, the HTML row of its links table, which names `<a>` and `<area>`
  alone. Its Status line is the only edit.
- **Touches:** Three parts, delivered as five pull requests.
  - **Part 1.** `src/meta/extractors/{html,html-read,html-write}.ts`,
    `src/lint/parsers/{html,xml}.ts`, `src/term/core/readers/html.ts`,
    `src/graph/core/{config,iirds-package}.ts`, and the formats and links
    reference pages.
  - **Part 2.** A new `src/shared/flare/`, `src/shared/tools.ts`,
    `src/lint/parsers/{html,xml}.ts`, `src/meta/extractors/html-read.ts`,
    `src/graph/core/analyze.ts`, `src/graph/commands/chunks.ts`, and the
    configuration reference pages.
  - **Part 3.** `src/term/core/{load-set,readers/structured}.ts`, a new
    `src/term/core/readers/flare-glossary.ts`,
    `src/meta/core/{schema-registry,resolve-schema}.ts`,
    `src/docevals/core/discover.ts`, `src/docevals/judge/prompt.ts`,
    `src/site/core/{detect,static-server}.ts`, and each domain's reference.
  - **All three.** Fixtures under `test/**/fixtures/flare/`, and a new guide
    page, `docs/src/content/docs/family/flare.mdx`.
- **Verdict:** A Flare project reads and writes like the family's other
  formats. Writes leave a topic Flare can still open. Cross-references and
  snippet references are links. A topic reads the way its target builds it.
  The glossary is a termbase and a meta tag set is a schema. docevals reads
  every format meta reads, and `site` builds and previews the project.

## Problem

MadCap Flare is a Windows authoring tool that keeps a help system as XHTML
topics and XML project files. Teams put those projects in Git. GitHub's code
search finds about 70,000 `.htm` files carrying Flare's
`MadCap:lastBlockDepth` attribute. Flare's own analysis finds broken links and
undefined variables, but only inside the desktop application. It has no
command line and no CI entry point.

manni reads `.htm` already, so a Flare project half works. A probe against a
small project, and a read of MadCap's own help source, found what reads and
what breaks.

- **meta reads.** `meta get` and `meta validate` read `<title>` and every
  `<meta>` in a topic's `<head>`. The byte-order mark Flare writes is harmless.
- **lint reads.** A topic routes by `<meta name="type">` and aligns against a
  TGDP template.
- **cite, term and strategy read.** HTML pages carry citations through a
  `{page}.citations.yaml` manifest, and term and strategy records work as
  HTML pages.
- **Titles are left to the heading.** In MadCap's own help source, 2,179 of
  3,796 topics have no `<title>`, and the rest mostly leave it empty. Flare
  titles them from their first heading. `manni:core` requires a title, so it
  fails each one.
- **Writes break the topic.** `meta derive`, `meta fill` and `graph fill`
  insert `<meta name="x" content="y">` with no closing slash. Flare's topics
  are XML, and the result no longer parses as XML.
- **Cross-references are not links.** graph harvests `<a href>` and
  `<area href>` only. A topic's `<MadCap:xref href>` makes no edge, so a broken
  one is never reported.
- **Snippets are refused or misread.** `meta get` and `lint structure` exit 2
  on a `.flsnp` file. `graph build --ext .flsnp` reads it as Markdown, with no
  sections.
- **Flare's meaning is lost.** Variables stay unresolved and snippets stay
  unexpanded. A paragraph conditioned for print counts in a web check. Index
  keywords never reach the graph.
- **The project files are unreadable.** `lint structure --as xml` on a TOC
  exits with `no known XML vocabulary matched <catapulttoc>`.
- **docevals reads Markdown alone.** It finds no pages in a Flare project.

Maya's pains are the ones her persona record names. Contributors omit
`description`, list values are misspelled, and metadata drifts. In a Flare
project she has no gate for any of them outside Flare's Analysis window.

## Worked example

Maya keeps the help for a widget in a Flare project, in Git. It is the fixture
this proposal adds, `test/fixtures/flare/widget/`.

```text
Widget.flprj
Content/Topics/Install.htm
Content/Topics/Configure.htm
Content/Resources/Snippets/BeforeYouStart.flsnp
Project/TOCs/Main.fltoc
Project/VariableSets/General.flvar
Project/ConditionTagSets/Default.flcts
Project/Targets/HTML5.fltar
Project/Targets/Print.fltar
Project/Glossaries/Glossary.flglo
Project/Advanced/Topics.flmeta
```

`Install.htm` includes the snippet, names the variable
`General.ProductVersion`, and holds a paragraph conditioned
`Default.PrintOnly`. Its cross-reference to the other topic is misspelled
`Configur.htm`. `Configure.htm` has an empty `<title>`, as Flare writes it, and
no description.

She writes one `manni.config.yaml` at the project root. Flare keeps each
author's primary target outside Git, so the file names `HTML5`.

```yaml
collections:
  - name: help
    paths:
      - "Content/**/*.htm"
      - "Content/Resources/Snippets/*.flsnp"
      - "Project/TOCs/*.fltoc"
      - "Project/Glossaries/*.flglo"
meta:
  overrides:
    - files: "Content/**/*.htm"
      defaults: false
      schemas:
        - manni:core:1.0.0
        - ./Project/Advanced/Topics.flmeta
    - files: "Content/Resources/Snippets/*.flsnp"
      defaults: false
      schemas: [./schemas/snippet.schema.json]
lint:
  template: tgdp:how-to:1.6
graph:
  out: graph/graph.ttl
tools:
  flare:
    target: HTML5
```

`schemas/snippet.schema.json` is `{}`. A snippet is a fragment, so it is held
to no page contract.

### After Part 1, the topics are safe to write

```console
$ manni meta validate
Using manni.config.yaml (.)
✗ Content/Topics/Configure.htm
    (root)  must have required property 'description'  (line 1)  [manni:core:1.0.0]
✓ Content/Topics/Install.htm
✓ Content/Resources/Snippets/BeforeYouStart.flsnp

3 files checked, 2 passed, 1 failed, 1 error
```

`Configure.htm` has a title, its first heading, as Flare shows it. The snippet
is read as HTML now. She fills the missing description.

```console
$ manni meta fill Content/Topics/Configure.htm
$ git diff --stat
 Content/Topics/Configure.htm | 1 +
$ git diff | grep '^+ '
+        <meta name="description" content="How to set the widget's options." />
```

The tag closes itself, so Flare opens the topic as before. Then she builds the
graph and asks what is broken.

```console
$ manni graph build
Wrote graph/graph.ttl (4 docs, 81 triples, 0 concepts)
$ manni graph stats --check
…
Broken internal links (1):
  Content/Topics/Install.htm -> Configur.htm
$ echo $?
1
```

The misspelled cross-reference is found. She fixes it, and asks which topics
include the snippet.

```console
$ manni graph query --predicate dcterms:references --object urn:manni:graph:doc/Content/Resources/Snippets/BeforeYouStart.flsnp
<urn:manni:graph:doc/Content/Topics/Install.htm> dcterms:references <urn:manni:graph:doc/Content/Resources/Snippets/BeforeYouStart.flsnp>

1 match(es)
```

### After Part 2, the topics read as HTML5 builds them

```console
$ manni lint structure Content/Topics/Install.htm --explain
▸ Content/Topics/Install.htm
    · flare                Widget.flprj, target HTML5 (tools.flare.target)
    · cli                  --template not given
    …
    → config-default       tgdp:how-to:1.6  config default
    alignment
      (page)                 ← "Installing the widget"
        overview               ← (missing)
        before-you-start       ← "Before you start"
        task                   ← "Steps"
        see-also               ← (missing)
```

The snippet's heading fills `before-you-start`. The print-only paragraph is
not in the HTML5 build, so no rule counts it. The graph's passages read as the
reader sees them.

```console
$ manni graph export chunks -o .manni/chunks
Wrote 7 chunks to .manni/chunks/chunks.json
$ grep -c "Version 4.2 needs Node 20" .manni/chunks/chunks.json
1
$ grep -c "MadCap:variable" .manni/chunks/chunks.json
0
```

Her index keywords are page fields, and the graph files the topic under them.

```console
$ manni meta get keywords Content/Topics/Install.htm
Content/Topics/Install.htm: keywords=["install","setup"] (asserted)
```

### After Part 3, the project's own resources join

The glossary is her termbase. A topic's `MadCap:glossaryTerm` is a
`concepts:` reference to it.

```console
$ manni term check
✓ 6 terms, 2 references, no findings
```

A contributor sets the meta tag `Status` to `Reviewd`. The meta tag set lists
`Draft`, `Reviewed` and `Published`.

```console
$ manni meta validate
✗ Content/Topics/Install.htm
    /Status  must match pattern "^(Draft|Reviewed|Published)(,(Draft|Reviewed|Published))*$"  (line 7)  [./Project/Advanced/Topics.flmeta]
      ./Project/Advanced/Topics.flmeta Status: Where the topic is in review.
```

On her Windows machine, `site` builds the target and serves it, and a11y
checks the output.

```console
$ manni site build
manni: Flare in ./. Running madbuild -project Widget.flprj -target HTML5
$ manni site preview
http://127.0.0.1:4321/
$ manni a11y check http://127.0.0.1:4321/
```

Devin's CI job runs on Linux with no Flare install, and it gates everything
but the build.

```console
$ manni check
…
skipped  cite check       no page carries citations
skipped  strategy check   no strategy records in any collection

7 checks over 9 files: 5 passed, 2 skipped
```

Maya has a gate for every pain her record names, and nobody had to leave Flare
to write a topic.

## Decision

### Part 1. Topics and snippets read and write safely

1. **XHTML is detected, never declared.** An HTML page is XHTML when it opens
   with an XML declaration, after any byte-order mark, or when its `<html>`
   element declares a namespace. Every Flare topic and snippet does both.
   There is no `--as flare` and no config key.

2. **A self-closed element holds nothing.** HTML5 parsing ignores the slash in
   `<MadCap:variable name="x"/>`, so parse5 nests the rest of the paragraph
   inside the variable. On an XHTML page each HTML reader moves those children
   back out, to follow the element. The tree then nests as the file is
   written. The readers are meta's HTML extractor, lint's HTML parser and
   term's HTML reader. Positions are untouched, so every splice offset holds.

3. **Inserted tags close themselves.** On an XHTML page a write ends each new
   tag with ` />`. A self-closed `<head />` opens into `<head>` and `</head>`
   around what the write inserts. A page with no `<head>` at all, as most
   Flare snippets are, gains one just inside `<html>`. On any other HTML page
   a write emits the bytes it emits today.

4. **A write never leaves malformed XML.** When an XHTML page parsed as XML
   before a write, the written result must too. Otherwise the write is
   refused with exit 2 and the file is untouched. The check runs inside the
   one HTML writer. So it covers `meta fill`, `derive` and `relocate`,
   `graph fill`, encryption, and `key rotate`.

5. **A Flare topic's title is the one Flare shows.** On a page that declares
   the MadCap namespace, an empty or missing `<title>` reads as the text of
   the first `h1` to `h6`. With no heading it reads as the file name, without
   its extension. A write to `title` fills the `<title>` element, or adds one
   to `<head>`.

6. **`.flsnp` is HTML.** meta's HTML extractor and lint's HTML parser claim
   it, and a directory walk collects it. graph lists it, `.fltoc` and
   `.flbrs` among the extensions that name a document. So a reference to a
   missing snippet or TOC is broken rather than an asset. iiRDS packages a
   snippet as `text/html` and a TOC as `application/xml`. Template pages
   (`.flmsp`) are layout, not prose, and stay unread.

7. **Cross-references and snippet references are links.** lint's HTML parser
   harvests `href` on `<MadCap:xref>`, and `src` on `<MadCap:snippetBlock>` and
   `<MadCap:snippetText>`. graph turns each into `dcterms:references`, as it
   does an `<a href>`. So an include is an edge, and a broken one is a broken
   link. `graph traverse --reverse` lists a snippet's includers. A target that
   names a variable, such as `href="[%=Links.Video%]"`, is not a path Part 1
   can check, so it is left out. Part 2 resolves it.

8. **The XML vocabulary error names no source file.** It reads "manni
   understands DITA, DocBook, DITA map and Flare TOC", and says nothing about
   editing `src/`.

9. **One guide page.** `docs/src/content/docs/family/flare.mdx` walks Maya
   through the worked example. It serves M1, M10, M18 and D16, and each part
   adds its section. The formats references list `.flsnp`, and graph's link
   reference lists the MadCap elements.

### Part 2. A topic reads as its target builds it

10. **The project is found, never named.** A page that declares the MadCap
    namespace belongs to the project in the nearest folder above it holding a
    `.flprj`. So does a TOC. When that folder holds more than one `.flprj`,
    the run exits 2. Flare never writes two, so the message is a guard. The
    project is read once per run. A page with no project above it still
    reads, with variables and conditions unresolved and one notice.

    graph takes a topic's language from the page's own `lang` first, then a
    route's `language`, then the project's `xml:lang`. A setting someone
    wrote wins over one manni detects.

11. **One target per run, named or the only one.** `tools.flare.target` names
    it. A project with one target uses that one. Otherwise the run uses no
    target, and says so once. Flare records the primary target per author,
    under `Project/Users`, and MadCap's guidance keeps that folder out of
    source control. With no target every condition is included and every
    variable takes its default definition.

12. **What a reader sees is resolved, and what a file says is not.** lint's
    HTML parser builds a Flare topic's tree from its resolved view.
    - **Snippets.** A snippet reference becomes the snippet's content in
      place, nested snippets included. A condition expression on the
      reference, or on the topic's root, also filters the snippet's content.
      The reference's own expression wins over the root's.
    - **Variables.** A variable becomes its default definition, the first one
      its set lists. The target's override wins over the set. A
      `MadCap:snippetVariables` override wins over both, inside its snippet. A
      definition that names other variables resolves them too, and so does a
      `[%=Set.Name%]` in text. A date and time variable keeps its reference,
      because a run reads no clock.
    - **Conditions.** Untagged content always stays. Tagged content stays when
      the target's `include` clause is true for it, and leaves when its
      `exclude` clause is. A tag is true when the element carries it. Content
      neither clause speaks to stays, unless the expression has an `include`
      clause and no `exclude` clause. `@media` clauses pick responsive styles,
      and are ignored.
    - **Markers.** Keyword, concept and glossary markers add no text. Every
      other MadCap element keeps its text.

    Links and includes are what each file says, under every condition. A
    broken cross-reference in print-only content is still broken. A link
    target that names a variable resolves through the variable set, and is
    checked as the path it resolves to.

13. **Who reads the resolved view.** lint's structure rules, graph's sections
    and its search index read it through lint's tree. A Flare topic's passage
    text in `graph export chunks` is its resolved text, and its line span is
    the source lines it came from. Passages from every other format are
    unchanged.

14. **A resolved block keeps a position in its own file.** A block that came
    from a snippet reports at the line of the snippet reference in the topic.
    A snippet checked directly reports at its own lines. That is how a fault
    inside a snippet is found and fixed once, rather than at each includer.

15. **A topic the target excludes is skipped.** A topic's root can carry
    conditions the target excludes. lint then skips it with that reason, and
    its graph document has no sections and no passages. Its links stay.

16. **Index keywords and concepts are `keywords`.** meta's HTML reader reads a
    Flare topic's `MadCap:keyword` and `MadCap:concept` terms as the page
    field `keywords`, in document order and deduplicated. A `term` value
    splits on `;`, a subentry `A:B` stays one keyword, and `\:` is a literal
    colon. A `<meta name="keywords">` in the page wins over the markers. graph
    already derives `dcterms:subject` from `keywords`, and term's
    `keyword-candidate` rule already reads it. A write to `keywords` read from
    markers is refused with exit 2.

17. **A TOC is a map.** lint's XML parser gains a `flare-toc` vocabulary for
    `CatapultToc`, the root of both `.fltoc` and `.flbrs`.
    - A `TocEntry` with a `Title` is a section, nested as written, with
      `graph:order`. A book entry with no `Link` is one too.
    - An entry titled `[%=System.LinkedTitle%]`, or untitled, is transparent.
    - Each `Link` is a link, to a topic, another TOC or another project. A
      `/Content/` or `/Project/` link resolves against the project root, with
      no `routes:` entry.
    - An entry the target excludes leaves the structure, and its link stays.

    This is the DITA map's shape exactly, so graph's shapes do not change.
    meta does not claim `.fltoc`, so `meta validate` passes over a TOC in a
    collection.

### Part 3. The project's resources join the domains that own them

18. **The glossary is a termbase.** A new term construct, `flare-glossary`,
    reads `.flglo`. Each `GlossaryEntry` is one term.
    - Its first `Term` is the label, and later ones are `alt-labels`.
    - Its `Definition` text is the definition. A definition that links to a
      topic reads as none.
    - Its id is its `glossTerm` id, the one topics cite. An older entry with
      no `glossTerm` takes term's usual id, the label's slug.
    - An entry the target excludes is not read.

    term walks `.flglo` in collections and reads it from `term.manifests`.

19. **A glossary term reference is a `concepts:` reference.** meta's HTML
    reader reads each `<MadCap:glossaryTerm glossTerm>` as an entry of the page
    field `concepts`. term's `dangling-reference` and graph's `dcterms:subject`
    then work as they do for any page. A write to `concepts` read from markers
    is refused with exit 2.

20. **A meta tag set is a schema.** A `.flmeta` path is accepted wherever a
    schema ref is, in `meta.schemas`, `meta.overrides[].schemas` and `-s`.
    meta reads it into a JSON Schema on load.
    - Each `<meta>` in the set is a property, and its `desc` is the
      property's description.
    - A `Text` tag is a string. So is a tag of any other type.
    - An `Enum` tag, Flare's list type, matches one or more of its `enum`
      values joined by commas. Flare writes a multi-value list that way.
    - Nothing is required, because Flare requires nothing.

    manni reads a meta tag set and never writes one. A `meta query` schema
    change that would write to one exits 2.

21. **docevals reads every format meta reads.** Discovery collects meta's
    extensions, and a page's metadata comes from meta's extractor.
    - On HTML and XML pages, `body` is the source between the page's metadata
      and its end. Deterministic graders read it, so their line numbers are the
      file's.
    - The judge reads an HTML or XML body as text, with tags dropped. A Flare
      topic reads resolved.
    - Markdown and MDX judging is unchanged, prompt and cache keys included.
    - An HTML or XML page keeps its evals in a manifest. When no manifest of
      its collection owns an eval key, `docevals fill`, `generate` and
      `promote --write` refuse with exit 2. They never write a YAML block
      onto markup.

22. **`site` builds a Flare project.** The framework table gains `flare`,
    detected by a `.flprj` in the site's directory.
    - `build` is `madbuild -project <flprj> -target <target>`, with the target
      decision 11 picks. A project with several targets and none named exits 2.
    - `out` is `Output/<USERNAME>/<target>`. `USERNAME` is the Windows
      account running manni, which is the account madbuild stamps into the
      path. When that folder does not exist, `preview` exits 2.
    - `preview` serves `out` with the built-in static server on port 4321.
      The server learns that `.htm` is `text/html`, and serves `Default.htm`
      at a folder with no `index.html`.
    - `start` exits 2, because Flare has no development server.
    - `site annotate` exits 2, because it does not read Flare output.
    - `madbuild` is found on `PATH`, then under `tools.flare.home`, then in the
      newest MadCap Flare install under `Program Files`.

    `graph export llms` writes `.htm` URLs for a Flare site, as Flare
    publishes them.

## Interface

### Config, before and after

No existing key changes. One namespace is added, beside `tools.vale`.

```yaml
# Before
tools:
  vale:
    config: .vale.ini

# After
tools:
  vale:
    config: .vale.ini
  flare:
    # The target conditions and variables resolve against.
    target: HTML5
    # The folder holding madbuild.exe, when it is not on PATH. On Windows,
    # Flare installs it in a folder named Flare.app.
    home: "C:/Program Files/MadCap Software/MadCap Flare 21/Flare.app"
```

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `tools.flare.target` | string | the project's only target, else none | no | The target whose conditions and variable overrides apply, in every domain. |
| `tools.flare.home` | path | none | no | The folder holding `madbuild.exe`. It resolves against the config file's folder. |

Two existing keys accept new values.

```yaml
meta:
  overrides:
    - files: "Content/**/*.htm"
      schemas:
        # Before: a built-in id, a file path, or a URL.
        # After: also a Flare meta tag set.
        - ./Project/Advanced/Topics.flmeta
term:
  # Before: SKOS, TBX, YAML or JSON. After: also a Flare glossary.
  manifests: [Project/Glossaries/Glossary.flglo]
```

### Formats

| Domain | Format | Before | After |
|---|---|---|---|
| meta, lint | html | `.html`, `.htm` | `.html`, `.htm`, `.flsnp` |
| lint, graph | xml | `.xml`, `.dita`, `.ditamap` | adds `.fltoc` and `.flbrs` |
| term | flare-glossary | none | `.flglo` |
| meta | schema ref | id, path or URL | adds a `.flmeta` path |
| docevals | pages | `.md`, `.markdown`, `.mdx` | every extension meta reads |
| site | frameworks | thirteen | adds `flare` |

`manni lint tools` prints the new extensions on the `html` and `xml` lines.
`Unsupported file type` messages list `.flsnp` among the supported
extensions.

### Command ladder

No command gains or loses a flag. The ladder shows the existing surface on a
Flare project.

1. The minimum, one snippet. Before Part 1 it exited 2 with
   `Unsupported file type ".flsnp"`.

   ```console
   $ manni meta validate Content/Resources/Snippets/BeforeYouStart.flsnp
   ✓ Content/Resources/Snippets/BeforeYouStart.flsnp

   1 file checked, 1 passed, 0 failed
   ```

2. The config fallback, over the collection.

   ```console
   $ manni meta validate
   3 files checked, 2 passed, 1 failed, 1 error
   ```

3. The CI form.

   ```console
   $ manni meta validate -f github
   ::error file=Content/Topics/Configure.htm,line=1::[manni:core:1.0.0] (root) must have required property 'description'
   ```

4. The scripting form.

   ```console
   $ manni graph query --predicate dcterms:subject -f json | jq length
   3
   ```

5. Every option at once.

   ```console
   $ manni lint structure Content/ --collection help --as html --ext .htm,.flsnp --exclude "Content/Resources/TemplatePages/**" -c manni.config.yaml --tool manni -t tgdp:how-to:1.6 --no-gitignore --allow-empty -f sarif
   ```

6. The usage errors.

   ```console
   $ manni lint check
   manni: tools.flare.target "PDF" names no target in Widget.flprj. Its targets are HTML5 and Print.
   $ echo $?
   2
   $ manni meta fill Content/Topics/Install.htm
   manni: Refusing to write "keywords": Content/Topics/Install.htm reads them from its MadCap:keyword and MadCap:concept markers. Edit the markers in Flare.
   $ echo $?
   2
   $ manni site start
   manni: Flare has no development server. Run manni site build, then manni site preview.
   $ echo $?
   2
   ```

### Messages

Every message goes to stderr.

```text
# Part 1, exit 2
Refusing to write "<key>": the result would not be well-formed XML (<parser message>). <file> is unchanged.
<file> has no <head> element; manni meta fill writes metadata into <head>. Add one, or set the field manually.

# Part 2, exit 2
tools.flare.target "<name>" names no target in <flprj>. Its targets are <list>.
<folder> holds two Flare projects, <a>.flprj and <b>.flprj. manni reads one project per folder.
Refusing to write "keywords": <file> reads them from its MadCap:keyword and MadCap:concept markers. Edit the markers in Flare.

# Part 2, a notice once per run, exit unchanged
No Flare project (.flprj) holds <file>, so its variables and conditions are left unresolved.
<flprj> has <n> targets and tools.flare.target names none, so every condition is included and every variable takes its default.

# Part 2, a warning once per name, exit unchanged
<file>: variable <Set.Name> is not defined in <flprj>. The reference is kept as text.
<file>: snippet <snippet> includes itself through <chain>. It is expanded once.

# Part 2, lint --explain
skipped: target <name> excludes the page by its conditions

# Part 3, exit 2
Refusing to write "concepts": <file> reads them from its MadCap:glossaryTerm markers. Edit the markers in Flare.
<path> is not a Flare meta tag set: its root element is <name>.
<path> is a Flare meta tag set, which manni reads and never writes.
<file> is HTML, so its evals live in a manifest. Give its collection an externalMetadata entry that owns evals.
<flprj> has <n> targets. Name the one to build with tools.flare.target.
madbuild was not found. Install MadCap Flare, or set tools.flare.home to the folder that holds madbuild.exe.
Flare has no development server. Run manni site build, then manni site preview.
No Flare output at <out>. Run manni site build first.
manni site annotate does not read Flare output.

# Part 3, site build progress, exit unchanged
# site's existing line for every framework, with Flare as the name.
Flare in <dir>. Running madbuild -project <flprj> -target <target>
```

### Output shapes

- **`lint structure --explain`** gains one line per Flare topic, before the
  routing lines: `· flare  <flprj>, target <name> (<why>)`. `<why>` is
  `tools.flare.target` or `the only target`. With no target the line reads
  `· flare  <flprj>, no target`.
- **`meta get`** shows `keywords` and `concepts` read from markers, and a
  title read from the first heading. Each is marked `(asserted)` like any page
  value.
- **`graph export chunks`** carries resolved text in a Flare topic's
  passages. The keys are unchanged.
- **`graph export llms`** writes `.htm` URLs for a Flare site.
- **graph** derives no new predicate and no new class. Shapes and the
  vocabulary keep their versions.

### Programmatic API

`src/index.ts` adds and renames nothing. `supportedExtensions()` and
`listFormats()` return `.flsnp` with the `html` format.

## Known limits

- **Inherited meta tag values are not merged.** Flare passes meta tag values
  from the set, project, target, template page and snippet down to a topic.
  They are not in the topic's source, so `meta validate` judges what the topic
  sets itself.
- **Meta values read as written.** A `<meta content>` holding
  `[%=Set.Name%]` reads with the reference, not its definition.
- **A snippet's text is in two places.** The snippet is a document of its own,
  and its text also sits in each including topic's passages.
- **One target per run.** A project with web and print targets checks the
  second by running again with another `tools.flare.target`.
- **Build-time variables stay text.** `System.Title` and `System.SourceFile`
  resolve. Dates, times, page numbers and chapter numbers keep their
  references.
- **Operator precedence is assumed.** MadCap does not document how `and`,
  `or` and `not` bind in an advanced expression. manni binds `not` tightest,
  then `and`, then `or`.
- **Glossary conversion is not read.** A target can turn plain text matching a
  glossary term into a reference at build time. Only explicit
  `MadCap:glossaryTerm` markers are `concepts:` references.
- **A topic definition reads as none.** A glossary entry whose definition is a
  linked topic has no definition, so `missing-definition` reports it.
- **Tracked changes read as both.** A topic holding unaccepted changes reads
  with the inserted and the deleted text.
- **Globs skip dot-files.** A collection path such as `Content/**/*.flsnp`
  leaves out a file whose name starts with a dot. A project with one names it
  in a path of its own.
- **A head parse5 cannot place is refused.** A stray tag before `<head>` makes
  the parser imply one. A write to that page exits 2, naming the file.
- **Unread files.** Template pages, alias files, index link sets, search filter
  sets, relationship tables, auto-suggestion sets and micro content are not
  read.
- **Flare may reformat on save.** manni changes only the bytes it means to.
  Flare's next save of the topic may still rewrite its layout.
- **The build needs Windows.** `madbuild` runs only there, so CI gates the
  source and a Windows machine builds the output.

## Rejected

- **Checking Flare's HTML5 output instead of its source.** Output has
  snippets inlined and variables resolved. But building it needs a licensed
  Windows machine, it cannot be written back, and its skin adds every page's
  navigation. a11y already checks the output.
- **Parsing XHTML pages with xmldom.** Every HTML reader walks parse5's tree,
  and each would need a second walk. Moving the children of a self-closed
  element fixes the one place the trees differ.
- **Reading the primary target from `Project/Users`.** That file is one
  author's, and it is kept out of Git. Two machines would check the same
  commit against two targets.
- **An include predicate for snippets.** The shapes are closed, so it would
  need shapes 1.5.0. `dcterms:references` already lets `traverse --reverse`
  find every includer.
- **A predicate for TOC order between documents.** DITA maps have none, and
  one belongs to both formats at once, in its own proposal.
- **A built-in rule that exempts snippets from page schemas.** meta already
  scopes schemas by file, so a repository writes a schema for its snippets.
- **Splitting comma lists in every `<meta content>`.** Commas are common in
  prose descriptions. The meta tag set says which tags are lists, so its
  pattern checks them.
- **Reading Flare concepts as `concepts:`.** A manni concept is a termbase
  entry, and a Flare concept is a topic tag. term would report every one as
  undefined.
- **Reading the auto-suggestion set (`.fltbx`) as a termbase.** It is TBX, but
  it is the editor's typing list. Its entries carry no definitions, so each
  would fail `missing-definition`.
- **A `tools.flare.project` key.** The project is the nearest `.flprj`, and
  Flare keeps one per folder.

## Open questions

1. Should a run take a target per invocation, so a CI matrix checks web and
   print without two config files? The recommendation is to wait for a team
   that needs it.
2. Should Flare's inherited meta tag values join a page's metadata, below its
   own? The recommendation is to wait until a meta tag set is in use here.
3. Should a glossary definition that links to a topic read as that topic's
   description? Every sampled glossary writes its definitions as text. The
   recommendation is to wait for one that does not.

## Verification

Each part is test-first, against fixtures under `test/fixtures/flare/` for
meta, `test/lint/fixtures/flare/` for lint and `test/graph/fixtures/flare/`
for graph.

- **Part 1.** Round trips over every writer assert the XML still parses,
  with xmldom, on each XHTML fixture. A deliberately broken insert proves the
  refusal. The tree test proves a paragraph after `<MadCap:variable/>` is its
  sibling. The title test covers a filled title, an empty one with a heading
  and an empty one without. Graph goldens are unchanged, and a new Flare
  golden pins the edges.
- **Part 2.** Fixtures cover a nested snippet, a cycle, a variable that names
  a variable, a missing variable, a target override and a snippet override.
  They also cover every row of the condition rule, an excluded element and an
  excluded topic. Each asserts the lint tree and the chunk text. Chunks from
  every non-Flare fixture are byte-identical.
- **Part 3.** The term suite reads the `.flglo` fixture, synonyms and an old
  entry with no `glossTerm` included. A meta suite validates against the
  `.flmeta` fixture. docevals's corpus is unchanged, and a new HTML corpus
  runs through the built CLI. site's planner tests assert argv, so they pass on
  every operating system.

### Dogfood

This repository has no Flare project, so the dogfood is two runs.

1. **This repository is unchanged.** `npm run docs:check-graph`,
   `node dist/cli.js meta validate`, `node dist/cli.js lint check` and
   `node dist/cli.js docevals run --deterministic-only` print what `main`
   prints. A `graph publish --collection site` is byte-identical to one from
   `main`. The diff goes in each pull request.
2. **A real Flare project builds.** MadCap's own help source is public on
   GitHub as `test1MC/Ramy-Shared925`, with thousands of topics and more than
   8,000 snippets. It is cloned shallow into a temporary directory, and
   nothing from it is committed.
   - Part 1 runs `meta validate`, `graph build` and `graph stats --check`. No
     topic fails `title`. A `meta derive` over a scratch copy writes every
     topic, and each written file parses as XML.
   - Part 2 names a target in a scratch config and runs
     `lint structure --explain` and `graph export chunks`. Its passages hold
     no `MadCap:variable` tag.
   - Part 3 runs `term check` on a glossary and `meta validate` against its
     meta tag sets. `site build` runs on a Windows machine with Flare
     installed, and `a11y check` runs against `site preview`.

   The counts each run prints go in the pull request.

## Delivery

Five pull requests, stacked.

| PR | Branch | Commit | Delivers |
|---|---|---|---|
| 1 | `claude/flare-topics` | `feat: read and write MadCap Flare topics and snippets` | Part 1 |
| 2 | `claude/flare-targets` | `feat: read Flare topics as their target builds them` | Part 2 |
| 3 | `claude/flare-resources` | `feat: read Flare glossaries and meta tag sets` | Part 3, decisions 18 to 20 |
| 4 | `claude/docevals-formats` | `feat(docevals): read every format meta reads` | Part 3, decision 21 |
| 5 | `claude/flare-site` | `feat(site): build and preview a Flare project` | Part 3, decision 22 |

The five form one linear stack above this proposal's pull request. Each
targets the branch below it, so PR 1 targets this proposal's branch and PR 5
targets PR 4's. Nothing targets `main` directly.

- **Merging.** An approved pull request merges into the branch below it, from
  the tip down, one at a time. A pull request merges only after everything
  above it has merged into it.
- **Reaching `main`.** Once the stack is one pull request, holding the
  proposal and all five parts, it merges into `main`.
- **PR 4 waits for #255.** That fix changes docevals discovery. It reaches
  the stack from `main` before PR 4 starts.

graph and lint are beta, so no part is breaking. Each implementation pull
request is a `feat:` and ships its own demo video.

## Acceptance checklist

### PR 1

- [ ] A Flare topic and snippet are detected as XHTML from their XML
      declaration. A plain HTML5 page is not.
- [ ] meta, lint and term read `<p>a <MadCap:variable name="x"/> b</p>` with
      ` b` as the variable's sibling.
- [ ] `meta fill`, `derive`, `relocate` and `graph fill` insert
      `<meta name="…" content="…" />` into an XHTML topic. The result parses
      as XML.
- [ ] A write into `<head />` produces `<head>`, the tags and `</head>`.
- [ ] A write into a plain HTML5 page is byte-identical to today's.
- [ ] A write that would leave malformed XML exits 2 with the Part 1 message,
      and the file is untouched.
- [ ] A Flare topic with an empty or missing `<title>` reads its first
      heading as `title`, or its file name with no heading. A write to `title`
      fills the element, or adds one.
- [ ] A write into an XHTML page with no `<head>` adds one inside `<html>`, and
      the result parses as XML. A head the parser had to imply is refused,
      naming the file.
- [ ] A link target holding `[%=…%]` on a Flare page is not reported broken.
- [ ] `manni meta validate x.flsnp` exits 0 on a valid snippet, and
      `lint tools` lists `.flsnp` under html.
- [ ] `graph build` derives `dcterms:references` from `MadCap:xref href`,
      `MadCap:snippetBlock src` and `MadCap:snippetText src`.
- [ ] `graph stats --check` exits 1 on a misspelled cross-reference and on a
      missing snippet.
- [ ] The XML vocabulary message names no source file.
- [ ] Fixtures exist under `test/fixtures/flare/`, `test/lint/fixtures/flare/`
      and `test/graph/fixtures/flare/`, and every existing golden is unchanged.
- [ ] `docs/src/content/docs/family/flare.mdx` exists with Part 1's section,
      and `information-architecture.md` lists it.
- [ ] `meta/reference/formats.mdx` and `graph/get-started/how-graph-works.mdx`
      list `.flsnp`, the MadCap elements and the title rule.
- [ ] This proposal's Status line reads `Accepted`, and 0077's names 0125 as
      superseding it in part.
- [ ] The dogfood output is in the pull request description.
- [ ] A demo video and its sources are in `media/`.

### PR 2

- [ ] `tools.flare.target` and `tools.flare.home` parse. Any other key under
      `tools.flare` exits 2.
- [ ] A topic resolves against the nearest `.flprj` above it. The target is
      the named one, else the only one, else none with the notice.
- [ ] An unknown target and two projects in one folder exit 2 with the Part 2
      messages.
- [ ] A topic with no project reads, and the run prints the notice once.
- [ ] lint's tree for a topic expands its snippets, nested ones included, with
      reference-level and root-level snippet conditions.
- [ ] Variables resolve with target and snippet overrides, through other
      variables and in `[%=Set.Name%]` text. Date and time variables keep
      their references.
- [ ] Each row of the condition rule has a fixture, and an excluded element's
      links stay in the graph.
- [ ] A snippet cycle and an undefined variable each warn once and exit 0.
- [ ] A topic the target excludes is skipped by lint with the explain line,
      and has no sections in the graph.
- [ ] `lint structure x.flsnp` reports findings at lines inside the snippet.
- [ ] `lint structure --explain` prints the `flare` line in each of its three
      forms.
- [ ] A Flare topic's chunk text is resolved, and every other format's chunks
      are byte-identical.
- [ ] graph takes a topic's language from its own `lang`, then a route's
      `language`, then the project's `xml:lang`.
- [ ] A TOC link to a missing `.fltoc` is a broken link.
- [ ] `meta get keywords` reads the markers, and a `keywords` meta tag wins
      over them. A write to marker keywords exits 2.
- [ ] A `.fltoc` and a `.flbrs` read as maps, book entries included, and their
      `/Content/` links resolve with no `routes:` entry.
- [ ] The configuration references document `tools.flare`, and
      `docs:check-cli` passes.
- [ ] The guide page has Part 2's section.
- [ ] The dogfood output is in the pull request description.
- [ ] A demo video and its sources are in `media/`.

### PR 3

- [ ] `term check` reads a `.flglo` from a collection and from
      `term.manifests`.
- [ ] A glossary entry's later terms are `alt-labels`, and its id is its
      `glossTerm` id or, with none, its label's slug.
- [ ] `MadCap:glossaryTerm` reads as `concepts`, a removed entry is a
      `dangling-reference`, and a write to marker concepts exits 2.
- [ ] A `.flmeta` path in `schemas:` validates `Text` tags and single and
      multiple `Enum` values. A file that is not a meta tag set exits 2.
- [ ] A `meta query` schema change that would write a `.flmeta` exits 2.
- [ ] `term/reference/configuration.mdx` and `meta/reference/formats.mdx`
      document the new files.
- [ ] The guide page has Part 3's term and meta section.
- [ ] The dogfood output is in the pull request description.
- [ ] A demo video and its sources are in `media/`.

### PR 4

- [ ] `docevals list` and `docevals run` find HTML, AsciiDoc, RST and XML
      pages.
- [ ] A deterministic grader's line numbers on an HTML page are the file's.
- [ ] The judge reads an HTML body without tags, and a Flare topic resolved.
- [ ] Markdown and MDX cache keys and prompts are unchanged, and the fixture
      corpus's exit code is unchanged.
- [ ] `docevals fill` on an HTML page whose collection has no evals manifest
      exits 2 with its message, and the page is untouched.
- [ ] `docevals/reference/frontmatter.mdx` documents where an HTML page's
      evals live.
- [ ] The dogfood output is in the pull request description.
- [ ] A demo video and its sources are in `media/`.

### PR 5

- [ ] `site build` in a Flare project plans
      `madbuild -project <flprj> -target <target>`, and several targets with
      none named exits 2.
- [ ] `site preview` serves `Output/<USERNAME>/<target>` on port 4321, with
      `.htm` as `text/html` and `Default.htm` at `/`. A missing folder exits
      2 with its message.
- [ ] `site start` and `site annotate` exit 2 with their messages, and a
      missing `madbuild` exits 2 with its message.
- [ ] `graph export llms` writes `.htm` URLs for a Flare site.
- [ ] `site/reference/cli.mdx` lists the Flare framework.
- [ ] The guide page has Part 3's site section.
- [ ] This proposal's Status line names the five pull requests that
      implemented it.
- [ ] The dogfood output, from a Windows machine, is in the pull request
      description.
- [ ] A demo video and its sources are in `media/`.
