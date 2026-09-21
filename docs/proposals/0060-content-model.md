# 0060: One content model for the family, and for Doc Detective

- **Status:** Proposed
- **Serves:** No journey of its own. It is the vocabulary three other proposals
  write in, so its readers are the people implementing them.
  - [0061](0061-lint-template-grammar.md) is the first consumer. A template
    names content kinds, so the kinds have to be named first.
  - Doc Detective's AST detection work is the second. Two tools over one docset
    should not describe a code block in two vocabularies.
- **Depends on:** Two.
  - [0050](0050-lint-domain.md) folded lint in, with the three-kind content
    model it arrived with: paragraph, code, list.
  - [0033](0033-manni-monorepo.md) is why this is a family document rather than
    a lint document. A second domain that reads documents will want the same
    words.
- **Relates to:** [0023](0023-metadata-vocabularies.md), which does the same job
  for metadata field names. This is that, for the body of a page.
- **Touches (planned):** `src/lint/types.ts`, `src/lint/parsers/**`,
  `docs/src/content/docs/lint/reference/templates.mdx`.

## Problem

`manni lint` models a document as sections holding three kinds of content:
paragraph, code, list. Everything else each parser meets is dropped with its
subtree. Five of the six parsers say so in a comment, and the reasoning is
always the same. A blockquote is not a paragraph, and counting it as one
would fail a document a reader would say is fine.

That was the right call for three kinds. It is the wrong call for the corpora
the tool is now pointed at.

- Every reference page in this repository's own docs is defined by its tables.
  `manni lint` cannot see a table.
- The shipped `tgdp:reference:1.6` template carries no content rules at all,
  and the file says why: the parser does not model tables.
- Thirty-four sections across twenty-five of this repository's pages have no
  content whatsoever as far as the linter is concerned. Their bodies are
  Starlight components, and the Markdown parser drops every JSX element
  whole.
- Doc Detective is building an AST layer over the same documents, with its own
  names for the same things. Two tools in one repository, describing one page,
  in two vocabularies.

There is a second problem hiding in the first. When a kind is added, six
parsers, a rule module, a reporter and a docs table all have to agree on what
it is called. Nothing today says where that name comes from, so the next one
will be argued from taste.

## Decision

### The method, before the names

A name is chosen in this order, and the order is the point:

1. **What the ASTs already call it.** Eight are in scope, because the family
   parses or will parse all of them. They are unist and mdast,
   mdast-util-mdx, hast, parse5, Asciidoctor, docutils, DITA, and DocBook.
2. **The plurality among them**, where one exists.
3. **Clarity**, which overrules the plurality only for an abbreviation, an
   ambiguity, or a word that is specific to one format.

Nothing here is chosen because a tool already ships it. Neither tool has
shipped this vocabulary, which is what makes the question answerable once.

### The node model

```ts
/** A point in a source file. Line and column are 1-based, offset 0-based. */
interface Point { line: number; column: number; offset: number }

/** A half-open source span: start inclusive, end exclusive. */
interface Position { start: Point; end: Point }

type ContentKind =
  | "paragraph" | "codeBlock" | "list" | "listItem"
  | "table" | "tableRow" | "tableCell"
  | "admonition" | "image" | "blockquote"
  | "definitionList" | "definitionItem"
  | "element";

interface ContentNodeBase {
  kind: ContentKind;
  position: Position;
  /** Rendered plain text, inline markup flattened. Never raw source. */
  text: string;
  /** Raw source of this node's own payload, where it has one. */
  value?: string;
}
```

Each kind carries what that kind needs, and nothing more. `codeBlock` gets a
`language` and a `fenceInfo`. `list` gets an `ordered` flag and `items`.
`table` rows carry a `header` flag that says which is the header row.
`admonition` gets a `variant`, and `image` gets a `url` and an `alt`.
`definitionItem` gets a `term`, and `element` gets a `name` and its literal
`attributes`.

### The six overrules, each one named

| Concept | Plurality | Chosen | Why the plurality loses |
|---|---|---|---|
| code block | mdast's `code` | `codeBlock` | mdast itself had to add `inlineCode` to disambiguate, which is the proof the short word does not carry. DITA spells it `codeblock`. |
| its language | mdast's `lang` | `language` | An abbreviation. DocBook, Asciidoctor and Doc Detective all spell it out. |
| named wrapper | hast's `tagName` | `element`, with `name` | `tagName` is the one HTML-specific word in a model whose premise is that a rule written once holds for six formats. |
| image source | none | `url` | mdast puts `url` on `link` and `image` alike, so one word covers "where this points". |
| admonition type | none | `variant` | So that no field anywhere in the model is named `type`. That is a rule a reader can grep for. |
| heading level | mdast's `depth` | `level` | The section tree already has a depth, and a level skip makes the two differ. Two numbers must not share a word. |

One invention is flagged as such. `variant` is nobody's word: Asciidoctor says
`style`, DITA says `@type`, docutils and DocBook encode it in the element name.
It is chosen for the property it has rather than the pedigree it lacks.

### The table header, which is not a convention anywhere else

GFM guarantees the first row of a table is its header, so mdast has no header
marker. reStructuredText, DITA and DocBook all carry a real `thead`, and a
table in those formats may have none at all. A positional convention that holds
in one format of six is not a model. `tableRow` carries `header: boolean`.

### Three collisions, settled by rule

**`content` is retired.** It means a raw source string to one tool and a
section's child array to the other. That is the worst kind of shared word.
unist already has both: `children` for a container's children, `value` for a
node's own payload. `SectionNode.content` becomes `children`, which also ends
an inconsistency inside lint, where `ListItemNode.children` already spelled it
that way.

**`text` is a field, never a kind.** It is the flattened rendering, and every
node has one. A `text` kind beside a `text` field, with different meanings,
would be indefensible.

**`block` names the grouping, not the pipeline stage.** lint's `Block` union is
an intermediate between a parser and `sectionize`, and it never leaves
`src/lint/parsers/`. It becomes `Fragment`, freeing "block" for its ordinary
meaning: block-level content.

### The discriminant is `kind`, not `type`

unist says `type`, and four of the eight ASTs follow it. `type` is
nevertheless unavailable on both sides. A finding's `type` is a wire key that
`manni docevals` parses rather than validates, so renaming it silently yields
zero findings. A page's `type:` frontmatter is what routes it to a template.
`kind` is free, and in TypeScript it is the conventional discriminant for a
closed union, which is what this is.

### Positions are unist's, everywhere

`position: { start, end }` with line, column and offset. Flat offsets are not
cheaper. Three of the eight formats cannot produce a byte offset at all,
since docutils exposes a line and Asciidoctor a line number. A tool that
requires offsets is unimplementable over them. A model that asks for a
position degrades gracefully where only a line is known.

### What a parser promises

A `DocumentParser` declares `kinds`, the list it actually emits, and `manni
lint tools` prints that matrix. A rule about a kind a file's format cannot
emit is reported as a warning rather than silently passing. The alternative
is to let every rule appear to hold everywhere. That makes a green run mean
two different things depending on the file's extension.

## Stress test

### 1. Why not just use mdast, and convert the other five?

Because five of the six formats are not Markdown, and the conversions are
lossy in both directions. DITA's `<note>` has no mdast node; mdast's
`definition` has no DITA element. A converted tree would also carry mdast's
inline model, which this model deliberately does not have. lint matches
structure, and flattening inline markup into `text` is what lets one rule
hold for six formats.

### 2. Is an open kind list not just "add everything"?

No. A kind earns its place by being something a template needs to assert. Each
of the nine additions here has a rule behind it in 0061 and a corpus behind
that rule. The inline kinds link, strong and emphasis are deliberately
absent. Nothing asks for them yet, and the model is cheaper to widen later
than to narrow.

### 3. `element` is a leaky word. Isn't `component` friendlier?

`component` is what an MDX author calls it, and it is also already taken in a
template file, where `components:` names reusable fragments. The kind must
serve HTML and DITA later, where "component" is wrong. The friendliness is
bought back on the field instead: `tag` is what an author of any of the three
would call the name.

### 4. Why is an element's content not the section's content?

Because a section that holds a `<Steps>` component holds one thing, not the
four paragraphs inside it. Counting through the wrapper would make
`paragraphs: { max: 3 }` fail a page a reader would say is fine. That is the
same argument that kept blockquotes out of the paragraph count. The template
reaches inside deliberately, by naming the element.

### 5. A heading inside a component disappears. Is that acceptable?

It is a real cost, and it is bounded: eight headings in two pages of this
repository, all inside `<TabItem>`. Those are alternative renderings of one
step rather than the page's spine. Treating them as sections would mean a
page's shape changed with the tab it happens to show. Letting an element
carry its own section rules is the way out if someone needs it.

### 6. Does this bind the family to Doc Detective's release schedule?

No. This proposal states the model. Each tool adopts it on its own branch, and
a tool that has not adopted it yet is wrong rather than blocked. The shared
artefact is a document, not a package, precisely so neither repository waits on
the other's build.

### 7. What happens the next time a format needs a kind nobody modelled?

The method above answers it. Find what the eight ASTs call it, take the
plurality, and overrule only for an abbreviation, an ambiguity or a
format-specific word. Then declare it in the parsers that emit it, and let
`manni lint tools` say who does not.

## Verification

- `src/lint/types.ts` holds the union above, and every node in it carries a
  `kind`.
- `manni lint tools` prints a kind per format, and the table in the templates
  reference is generated from the same source rather than written by hand.
- `test/lint/integration/cross-format.test.ts` asserts that a rule about a kind
  holds for every format that declares it.
- No field named `type` exists on any node. A test greps for it.

## Not breaking

`manni lint` has not shipped. The JSON reporter's wire shape is unchanged:
`{ file, success, errors, skipped }`, with each error keeping `type`, `ruleId`,
`tool`, `heading`, `message` and `position`. The renames in this proposal are
internal to the parsers and the node model.

## Consequences

- Adding a kind is now a five-step recipe with an owner for each step, rather
  than a debate.
- Six parsers gain a capability list, which makes "this rule did not run"
  reportable for the first time.
- The family has a second shared vocabulary document, after 0023. If a third
  appears, they want an index.
- Doc Detective and manni can be checked against one page of prose rather than
  against each other's source.
