/**
 * XML -> generic blocks, through a declarative vocabulary mapping.
 *
 * ADR 01001 puts XML last "because structure comes from the document's own
 * element nesting and needs a small per-vocabulary mapping". This is that
 * mapping, and the reason it exists: XML has no headings. Markdown says `##`,
 * AsciiDoc says `==`, HTML says `<h2>` - one universal rule each. XML says
 * whatever its schema says. DITA nests `<topic>`/`<section>` and titles them
 * with `<title>`; DocBook nests `<chapter>`/`<section>`/`<sect1>` and titles
 * them with `<title>` too, but calls a paragraph `<para>` where DITA calls it
 * `<p>`; a house schema calls them something else again. Hardcoding DITA would
 * make "the XML parser" a lie.
 *
 * ## The mapping
 *
 * An `XmlVocabulary` sorts element names into four buckets and says nothing
 * about anything else:
 *
 *  - `sections`   open a section, titled by the first `titles` element among
 *                 their children (or inside a `titleWrappers` child, which is
 *                 how DocBook 5 hides `<title>` in `<info>`).
 *  - `transparent` are structural wrappers with no meaning of their own -
 *                 DITA's `<body>`, `<taskbody>`, `<context>`. The walk passes
 *                 straight through them at the same level.
 *  - `paragraphs` / `code` / `unorderedLists` / `orderedLists` / `listItems` /
 *                 `tables` / `admonitions` / `images` / `blockquotes` /
 *                 `definitionLists` are the format-neutral content kinds of
 *                 `types.ts`. The last five are optional buckets: a vocabulary
 *                 that leaves one out never emits that kind, same as leaving
 *                 an entry out of `kinds`.
 *  - everything else is **skipped, with its subtree**, exactly as the Markdown
 *    parser skips a blockquote. A DITA `<related-links>` is not a paragraph,
 *    and its contents must not be counted as one, or `paragraphs: {max: 3}`
 *    fails documents a reader would say satisfy it.
 *
 * That last rule is why `transparent` has to exist as its own bucket: without
 * it, skipping the unmapped `<body>` would skip the whole topic.
 *
 * ## Extending it for a bespoke schema
 *
 * Add one entry to `XML_VOCABULARIES` (or pass your own array to `parseXml`):
 *
 *     { name: "acme", label: "Acme Docs",
 *       namespaces: ["https://acme.example/docs"], roots: ["manual"],
 *       sections: ["manual", "chapter"], titles: ["heading"],
 *       titleWrappers: [], transparent: ["content"],
 *       paragraphs: ["text"], code: ["sample"], codeLangAttributes: ["lang"],
 *       unorderedLists: ["bullets"], orderedLists: ["steps"],
 *       listItems: ["item"] }
 *
 * Tables, admonitions, images, blockquotes and definition lists are five more
 * buckets, all optional - a schema that never names one simply never emits
 * that kind. See each field's own doc comment below for the shape it expects.
 *
 * Nothing else changes: the walk, the levels, the positions, and the fold are
 * vocabulary-independent. This is deliberately not wired to `manni.config.yaml`
 * yet - the shape is the commitment, the config surface is a later decision.
 *
 * ## Which vocabulary a document is in
 *
 * Scored, not guessed: a declared namespace is decisive, then elements only
 * one candidate claims, then the root element name, then the elements they
 * share. That ordering is what settles the ambiguous cases - `<section>`,
 * `<title>` and `<reference>` belong to both built-ins, so a `<section>`-rooted
 * file is decided by whether its prose is in `<p>` or `<para>`. Nothing
 * recognized at all is an error, not an empty tree: see `chooseVocabulary`.
 *
 * ## Levels
 *
 * `sectionize` folds by heading *level*, so nesting is expressed as one: the
 * level is the number of enclosing elements that actually opened a section,
 * plus one. Transparent wrappers do not count, and neither does a section
 * element with no title - an untitled DITA `<section>` is legal, and the honest
 * reading is that it adds no heading and so no level, its content belonging to
 * the section that encloses it. Levels clamp at 6, the range `SectionNode`
 * declares.
 *
 * ## Positions
 *
 * `@xmldom/xmldom` records `lineNumber` (1-based, despite its `index.d.ts`
 * saying "zero based") and `columnNumber` (1-based) on every node, pointing at
 * the `<` of an element's start tag and at the first character of a text node.
 * There is no end position. But *every* node carries a start, including the
 * whitespace text nodes between elements, so the exclusive end of an element is
 * the start of the next node in document order - for indented XML that is the
 * character right after `</tag>`, exactly. Only when a node is last all the way
 * up to the root does that fall back to the end of the document, per the
 * house rule for formats whose parser reports no end.
 */
import { DOMParser } from "@xmldom/xmldom";
import type { Element as XmlElement, Node as XmlNode } from "@xmldom/xmldom";
import { extractorForExtension } from "../../meta/index.js";
import type {
  AdmonitionNode,
  ContentNode,
  DefinitionItemNode,
  DefinitionListNode,
  DocumentParser,
  DocumentTree,
  ImageNode,
  ListItemNode,
  Point,
  Position,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "../types.js";
import { LintError } from "../types.js";
import { errorMessage } from "../../shared/errors.js";
import type { Fragment } from "./sectionize.js";
import { sectionize } from "./sectionize.js";

/**
 * One schema's answer to "what is a section, and what is content?".
 *
 * Every list is of lowercased local names - the prefix and namespace of an
 * element are not part of the match, so a document that binds DocBook to `db:`
 * maps the same as one that uses the default namespace.
 */
export interface XmlVocabulary {
  /** Stable id, used in error messages. */
  name: string;
  /** Human-readable label. */
  label: string;
  /** Namespace URIs that identify this vocabulary outright. */
  namespaces: readonly string[];
  /** Root element names that identify it. */
  roots: readonly string[];
  /** Elements that open a section when they carry a title. */
  sections: readonly string[];
  /** Elements that carry a section's title. */
  titles: readonly string[];
  /** Children to look inside for a title (DocBook's `<info>`). */
  titleWrappers: readonly string[];
  /** Structural wrappers: no section, no content, walk through. */
  transparent: readonly string[];
  /** Elements that are one paragraph. */
  paragraphs: readonly string[];
  /** Elements that are one code block. */
  code: readonly string[];
  /** Attributes carrying a code block's language, first one present wins. */
  codeLangAttributes: readonly string[];
  /** Elements that are an unordered list. */
  unorderedLists: readonly string[];
  /** Elements that are an ordered list. */
  orderedLists: readonly string[];
  /** Elements that are one item of a list. */
  listItems: readonly string[];

  /** Elements that are a table, CALS-shaped or simple. */
  tables?: readonly string[];
  /** Elements whose direct children are cells: a header row or a body row. */
  tableRows?: readonly string[];
  /** Elements that are one cell of a row. */
  tableCells?: readonly string[];
  /** Wrapper elements whose descendant rows are all header rows (CALS `<thead>`). */
  tableHeaderWrappers?: readonly string[];
  /** Row elements that are inherently a header row on their own (DITA `<sthead>`). */
  tableHeaderRows?: readonly string[];

  /** Elements that may be an admonition. */
  admonitions?: readonly string[];
  /**
   * Attribute naming the admonition's variant (DITA's `<note>` `@type`). When
   * absent, an admonition element's own lowercased name is its variant -
   * DocBook's five admonition elements are themselves named `note`, `tip`,
   * `important`, `caution` and `warning`. Either way, a name outside the six
   * `AdmonitionNode` knows produces an admonition with no `variant` set,
   * rather than an invented equivalence - DITA's `restriction` and `fastpath`
   * are real `@type` values this model does not have a word for.
   */
  admonitionVariantAttribute?: string;

  /** Elements that are an image, standing alone or wrapping one. */
  images?: readonly string[];
  /**
   * Element carrying the image's own url attribute - itself, for a
   * self-contained image (DITA's `<image href>`), or a descendant found by
   * name (DocBook's `<imagedata fileref>` inside a `<mediaobject>`).
   */
  imageDataElements?: readonly string[];
  /** Attribute on an `imageDataElements` match that carries the url. */
  imageUrlAttribute?: string;
  /** Direct child of an `imageDataElements` match carrying the alt text. */
  imageAltElements?: readonly string[];

  /** Elements that are a block quote. */
  blockquotes?: readonly string[];

  /** Elements that are a definition list. */
  definitionLists?: readonly string[];
  /** Elements that are one entry, pairing a term with a definition. */
  definitionItems?: readonly string[];
  /** Elements that carry an entry's term(s); more than one join with ", ". */
  definitionTerms?: readonly string[];
  /** Elements that carry an entry's definition body. */
  definitionBodies?: readonly string[];
}

/**
 * DITA. No default namespace to detect on (DITA is conventionally
 * namespace-free, with only `ditaarch:` bound on the root), so recognition
 * leans on the topic types and on `<p>`/`<codeblock>`/`<body>`.
 *
 * `<prereq>`, `<context>`, `<result>` and friends are transparent rather than
 * sections: they are untitled parts of a task body that render as continuous
 * prose, so their paragraphs belong to the task. `<related-links>` and
 * `<prolog>` are in no bucket at all, so they and their contents are skipped -
 * the blockquote rule.
 *
 * A CALS `<table>` and an OASIS `<simpletable>` share one row/cell reading:
 * `<row>`/`<entry>` for the former, `<strow>`/`<stentry>` for the latter. A row
 * inside `<thead>` is a header row (the CALS shape); `<sthead>` is a header row
 * on its own, holding `<stentry>` cells directly rather than wrapping a row.
 */
const DITA: XmlVocabulary = {
  name: "dita",
  label: "DITA",
  namespaces: [],
  roots: ["dita", "topic", "concept", "task", "reference", "glossentry"],
  sections: [
    "topic",
    "concept",
    "task",
    "reference",
    "glossentry",
    "section",
    "example",
  ],
  // `<glossterm>` is how a `<glossentry>` titles itself. It never carries a
  // `<title>`, so a vocabulary listing `title` alone reads every real glossary
  // topic as untitled and refuses the whole file. DITA-OT's own docset has
  // thirteen of them. `src/term/core/readers/dita.ts` has always read
  // `<glossterm>` as the term, so the two halves of this package disagreed
  // until the vendored corpus made it visible.
  titles: ["title", "glossterm"],
  titleWrappers: [],
  transparent: [
    "dita",
    "body",
    "conbody",
    "taskbody",
    "refbody",
    "glossbody",
    "abstract",
    "prereq",
    "context",
    "result",
    "postreq",
    "div",
    "bodydiv",
    "sectiondiv",
  ],
  // `<cmd>` is the imperative line of a `<step>`; treating it as a paragraph is
  // what makes a DITA `<steps>` item shaped like a Markdown list item.
  //
  // `<glossdef>` is the definition, and it holds prose either directly or in
  // `<p>`s. A paragraph rather than a wrapper, because a wrapper would drop the
  // direct-text spelling, which is the common one.
  paragraphs: ["p", "shortdesc", "cmd", "info", "glossdef"],
  code: ["codeblock", "pre"],
  codeLangAttributes: ["outputclass"],
  unorderedLists: ["ul", "sl", "steps-unordered"],
  orderedLists: ["ol", "steps", "substeps"],
  listItems: ["li", "sli", "step", "substep"],

  tables: ["table", "simpletable"],
  tableRows: ["row", "strow", "sthead"],
  tableCells: ["entry", "stentry"],
  tableHeaderWrappers: ["thead"],
  tableHeaderRows: ["sthead"],

  admonitions: ["note"],
  admonitionVariantAttribute: "type",

  images: ["image", "fig"],
  imageDataElements: ["image"],
  imageUrlAttribute: "href",
  imageAltElements: ["alt"],

  blockquotes: ["lq"],

  definitionLists: ["dl"],
  definitionItems: ["dlentry"],
  definitionTerms: ["dt"],
  definitionBodies: ["dd"],
};

/**
 * DocBook 5 (and the DocBook 4 `<sectN>`/`<*info>` spellings, which cost two
 * entries and save a whole second vocabulary).
 */
const DOCBOOK: XmlVocabulary = {
  name: "docbook",
  label: "DocBook",
  namespaces: ["http://docbook.org/ns/docbook"],
  roots: [
    "book",
    "article",
    "chapter",
    "section",
    "sect1",
    "part",
    "appendix",
    "preface",
    "reference",
  ],
  sections: [
    "book",
    "article",
    "part",
    "chapter",
    "appendix",
    "preface",
    "section",
    "simplesect",
    "sect1",
    "sect2",
    "sect3",
    "sect4",
    "sect5",
  ],
  titles: ["title"],
  titleWrappers: [
    "info",
    "bookinfo",
    "articleinfo",
    "chapterinfo",
    "sectioninfo",
  ],
  transparent: ["formalpara"],
  paragraphs: ["para", "simpara"],
  code: ["programlisting", "screen", "literallayout", "synopsis"],
  codeLangAttributes: ["language"],
  unorderedLists: ["itemizedlist", "simplelist"],
  orderedLists: ["orderedlist", "procedure"],
  listItems: ["listitem", "member", "step"],

  tables: ["table", "informaltable"],
  tableRows: ["row"],
  tableCells: ["entry"],
  tableHeaderWrappers: ["thead"],
  tableHeaderRows: [],

  // No `admonitionVariantAttribute`: DocBook's five admonition elements are
  // themselves named `note`/`warning`/`caution`/`tip`/`important`.
  admonitions: ["note", "warning", "caution", "tip", "important"],

  images: ["mediaobject", "figure"],
  imageDataElements: ["imagedata"],
  imageUrlAttribute: "fileref",
  imageAltElements: [],

  blockquotes: ["blockquote"],

  definitionLists: ["variablelist"],
  definitionItems: ["varlistentry"],
  definitionTerms: ["term"],
  // DocBook reuses `<listitem>` for a variable list's own body, distinct from
  // the `listItems` bucket above which reads it inside `<itemizedlist>`.
  definitionBodies: ["listitem"],
};

/**
 * The vocabularies tried, in declaration order (which breaks scoring ties).
 * Exported so a bespoke schema is an array entry rather than a fork.
 */
export const XML_VOCABULARIES: readonly XmlVocabulary[] = [DITA, DOCBOOK];

/** Precomputed lookups for one vocabulary. */
interface Compiled {
  vocab: XmlVocabulary;
  sections: Set<string>;
  titles: Set<string>;
  titleWrappers: Set<string>;
  transparent: Set<string>;
  paragraphs: Set<string>;
  code: Set<string>;
  unordered: Set<string>;
  ordered: Set<string>;
  items: Set<string>;
  tables: Set<string>;
  tableRows: Set<string>;
  tableCells: Set<string>;
  tableHeaderWrappers: Set<string>;
  tableHeaderRows: Set<string>;
  admonitions: Set<string>;
  images: Set<string>;
  imageDataElements: Set<string>;
  imageAltElements: Set<string>;
  blockquotes: Set<string>;
  definitionLists: Set<string>;
  definitionItems: Set<string>;
  definitionTerms: Set<string>;
  definitionBodies: Set<string>;
  /** Every name the vocabulary claims, for scoring. */
  known: Set<string>;
}

const lower = (names: readonly string[] = []): Set<string> =>
  new Set(names.map((n) => n.toLowerCase()));

function compile(vocab: XmlVocabulary): Compiled {
  const c: Compiled = {
    vocab,
    sections: lower(vocab.sections),
    titles: lower(vocab.titles),
    titleWrappers: lower(vocab.titleWrappers),
    transparent: lower(vocab.transparent),
    paragraphs: lower(vocab.paragraphs),
    code: lower(vocab.code),
    unordered: lower(vocab.unorderedLists),
    ordered: lower(vocab.orderedLists),
    items: lower(vocab.listItems),
    tables: lower(vocab.tables),
    tableRows: lower(vocab.tableRows),
    tableCells: lower(vocab.tableCells),
    tableHeaderWrappers: lower(vocab.tableHeaderWrappers),
    tableHeaderRows: lower(vocab.tableHeaderRows),
    admonitions: lower(vocab.admonitions),
    images: lower(vocab.images),
    imageDataElements: lower(vocab.imageDataElements),
    imageAltElements: lower(vocab.imageAltElements),
    blockquotes: lower(vocab.blockquotes),
    definitionLists: lower(vocab.definitionLists),
    definitionItems: lower(vocab.definitionItems),
    definitionTerms: lower(vocab.definitionTerms),
    definitionBodies: lower(vocab.definitionBodies),
    known: new Set(),
  };
  for (const set of [
    c.sections,
    c.titles,
    c.titleWrappers,
    c.transparent,
    c.paragraphs,
    c.code,
    c.unordered,
    c.ordered,
    c.items,
    c.tables,
    c.tableRows,
    c.tableCells,
    c.tableHeaderWrappers,
    c.tableHeaderRows,
    c.admonitions,
    c.images,
    c.imageDataElements,
    c.imageAltElements,
    c.blockquotes,
    c.definitionLists,
    c.definitionItems,
    c.definitionTerms,
    c.definitionBodies,
  ]) {
    for (const name of set) c.known.add(name);
  }
  return c;
}

const ELEMENT_NODE = 1;

/** Lowercased local name, prefix and namespace discarded. */
function localName(node: XmlNode): string {
  const el = node as XmlElement;
  const name = el.localName ?? node.nodeName.split(":").pop() ?? node.nodeName;
  return name.toLowerCase();
}

function* elementChildren(el: XmlNode): Generator<XmlElement> {
  for (let child = el.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === ELEMENT_NODE) yield child as XmlElement;
  }
}

/** First direct child matching one of `names`, or null. */
function findDirectChild(el: XmlElement, names: Set<string>): XmlElement | null {
  for (const child of elementChildren(el)) {
    if (names.has(localName(child))) return child;
  }
  return null;
}

/** First descendant matching one of `names`, in document order, or null. */
function findDescendant(el: XmlElement, names: Set<string>): XmlElement | null {
  for (const child of elementChildren(el)) {
    if (names.has(localName(child))) return child;
    const nested = findDescendant(child, names);
    if (nested) return nested;
  }
  return null;
}

/** Collapse XML's indentation whitespace into the single spaces a reader sees. */
function flatten(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * A code block's text, minus the layout the source added around it: the newline
 * that follows the start tag when the code is on its own line, and the
 * indentation before the end tag. Everything between is significant and is left
 * exactly as written, which is what mdast does with a fenced block's value.
 */
function codeText(text: string | null): string {
  return (text ?? "").replace(/^[^\S\n]*\n/, "").replace(/\n[^\S\n]*$/, "");
}

/** The six variants `AdmonitionNode` knows. A name outside this set names no variant. */
type Variant = Exclude<AdmonitionNode["variant"], undefined>;
const ADMONITION_VARIANTS = new Set<Variant>([
  "note",
  "tip",
  "important",
  "caution",
  "warning",
  "danger",
]);

function isAdmonitionVariant(name: string): name is Variant {
  return (ADMONITION_VARIANTS as ReadonlySet<string>).has(name);
}

/** Weights for `chooseVocabulary`, in the order they are meant to dominate. */
const NAMESPACE_MATCH = 1000;
const EXCLUSIVE_ELEMENT = 10;
const ROOT_NAME = 5;
const SHARED_ELEMENT = 1;

/**
 * Score every vocabulary against the document and take the best.
 *
 * A namespace match on the root is decisive: a document that declares its
 * namespace has already said what it is. Failing that, what counts is elements
 * only one candidate claims - `<para>` and `<programlisting>` are DocBook's
 * alone, `<p>` and `<taskbody>` DITA's - because those are the ones whose
 * presence is an argument. Elements the candidates share (`<section>`,
 * `<title>`) are worth a point as a tiebreak and no more, since they are
 * evidence for everyone and therefore for no one.
 *
 * The root element name is weaker still, and deliberately weaker than a single
 * exclusive element. `<section>` is a DocBook root, so a bare `<section>` whose
 * prose is in `<p>` would otherwise be read as DocBook - and every `<p>` in it
 * would then be an unmapped element, silently skipped, leaving a titled section
 * with no content and no complaint. One `<p>` is better evidence about what a
 * file is than the name of its outermost tag.
 */
function chooseVocabulary(
  root: XmlElement,
  compiled: Compiled[],
): { best: Compiled; score: number } {
  const counts = new Map<string, number>();
  const tally = (node: XmlNode): void => {
    for (const child of elementChildren(node)) {
      const name = localName(child);
      counts.set(name, (counts.get(name) ?? 0) + 1);
      tally(child);
    }
  };
  counts.set(localName(root), 1);
  tally(root);

  /** How many candidates claim each name; 1 means the name is decisive. */
  const claims = new Map<string, number>();
  for (const c of compiled) {
    for (const name of c.known) claims.set(name, (claims.get(name) ?? 0) + 1);
  }

  const ns = (root.namespaceURI ?? "").toLowerCase();
  const rootName = localName(root);

  let best: Compiled | undefined;
  let bestScore = -1;
  for (const c of compiled) {
    let score = 0;
    if (ns && c.vocab.namespaces.some((u) => u.toLowerCase() === ns)) {
      score += NAMESPACE_MATCH;
    }
    if (lower(c.vocab.roots).has(rootName)) score += ROOT_NAME;
    for (const [name, n] of counts) {
      if (!c.known.has(name)) continue;
      score += n * (claims.get(name) === 1 ? EXCLUSIVE_ELEMENT : SHARED_ELEMENT);
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (!best) {
    // The vocabulary list is the registry's own and is never empty; the loop
    // assigns on its first pass, because every score beats the -1 it starts
    // from. Saying so out loud beats returning a vocabulary nobody chose.
    throw new LintError("No XML vocabularies are registered.");
  }
  return { best, score: bestScore };
}

/**
 * Line/column -> offset, over the content as it was read.
 *
 * xmldom normalizes line endings before parsing, so its line and column are
 * against a LF-only copy. Line *numbers* survive that normalization unchanged
 * and CRLF only ever differs at a line terminator, so indexing the original
 * content's line starts with xmldom's (line, column) lands on the same
 * character - which is what keeps `offset` an index into the file the reporter
 * will quote, not into a normalized copy of it.
 */
class SourceMap {
  private readonly lineStarts: number[] = [0];
  /** Byte-order mark length, added back to every offset. */
  private readonly bom: number;
  private readonly body: string;
  readonly docEnd: Point;

  constructor(content: string) {
    this.bom = content.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.body = content.slice(this.bom);
    for (let i = 0; i < this.body.length; i++) {
      const ch = this.body[i];
      if (ch === "\n") this.lineStarts.push(i + 1);
      else if (ch === "\r") {
        if (this.body[i + 1] === "\n") i++;
        this.lineStarts.push(i + 1);
      }
    }
    // `lineStarts` opens with 0 and is only ever appended to, so the fallback
    // is unreachable - and it is the start of the one and only line anyway.
    const lastStart = this.lineStarts.at(-1) ?? 0;
    this.docEnd = {
      line: this.lineStarts.length,
      column: this.body.length - lastStart + 1,
      offset: content.length,
    };
  }

  /** The source text, for the parser to hand to xmldom without the BOM. */
  get text(): string {
    return this.body;
  }

  /** Start point of a node, or null when the locator recorded none. */
  point(node: XmlNode | null | undefined): Point | null {
    if (!node) return null;
    const line = node.lineNumber;
    const column = node.columnNumber;
    if (typeof line !== "number" || typeof column !== "number") return null;
    const start = this.lineStarts[line - 1];
    if (start === undefined) return null;
    const offset = Math.min(start + column - 1, this.body.length) + this.bom;
    return { line, column, offset };
  }

  /** End of the line a point sits on, exclusive of its terminator. */
  endOfLine(line: number): Point {
    const start = this.lineStarts[line - 1];
    if (start === undefined) return { ...this.docEnd };
    const next = this.lineStarts[line];
    const end = next === undefined ? this.body.length : next - 1;
    return { line, column: end - start + 1, offset: end + this.bom };
  }
}

/**
 * The exclusive end of an element: where the next node in document order
 * starts. Whitespace text nodes carry positions too, so for indented XML that
 * is the character immediately after `</tag>`.
 */
function nextInDocumentOrder(el: XmlNode): XmlNode | null {
  let node: XmlNode = el;
  for (;;) {
    if (node.nextSibling) return node.nextSibling;
    const parent: XmlNode | null = node.parentNode;
    if (!parent || parent.nodeType !== ELEMENT_NODE) return null;
    node = parent;
  }
}

/** Flattens one document into ordered fragments under one vocabulary. */
class Flattener {
  readonly fragments: Fragment[] = [];

  constructor(
    private readonly c: Compiled,
    private readonly map: SourceMap,
  ) {}

  private span(el: XmlNode): Position {
    const start = this.map.point(el) ?? { ...this.map.docEnd };
    const end =
      this.map.point(nextInDocumentOrder(el)) ?? { ...this.map.docEnd };
    // A malformed locator (or an element that ends the document) must never
    // produce a backwards span; rules sort findings by offset.
    return end.offset < start.offset ? { start, end: { ...start } } : { start, end };
  }

  /** The title element of a section container, direct or inside a wrapper. */
  private titleOf(el: XmlElement): XmlElement | null {
    for (const child of elementChildren(el)) {
      if (this.c.titles.has(localName(child))) return child;
    }
    for (const child of elementChildren(el)) {
      if (!this.c.titleWrappers.has(localName(child))) continue;
      for (const inner of elementChildren(child)) {
        if (this.c.titles.has(localName(inner))) return inner;
      }
    }
    return null;
  }

  /** Walk one element: section, wrapper, content, or skipped subtree. */
  visit(el: XmlElement, level: number): void {
    const name = localName(el);

    if (this.c.sections.has(name)) {
      const title = this.titleOf(el);
      if (!title) {
        // An untitled section container adds no heading, so it adds no level
        // either; its content belongs to the section that encloses it.
        this.walkChildren(el, level);
        return;
      }
      const next = Math.min(level + 1, 6);
      this.fragments.push({
        type: "heading",
        level: next,
        title: flatten(title.textContent),
        // From the container's start tag through the end of its title: the
        // container is the section, so a section that began at its `<title>`
        // would leave its own opening tag outside itself and stop adjacent
        // sections from tiling the document.
        position: { start: this.span(el).start, end: this.span(title).end },
      });
      this.walkChildren(el, next);
      return;
    }

    if (this.c.transparent.has(name)) {
      this.walkChildren(el, level);
      return;
    }

    const node = this.content(el);
    if (node) this.fragments.push({ type: "content", node });
    // Unmapped: skipped with its subtree, like a Markdown blockquote.
  }

  private walkChildren(el: XmlElement, level: number): void {
    for (const child of elementChildren(el)) this.visit(child, level);
  }

  /** One element as a content node, or null when it is not one. */
  private content(el: XmlElement): ContentNode | null {
    const name = localName(el);
    const position = this.span(el);

    if (this.c.paragraphs.has(name)) {
      return { kind: "paragraph", position, text: flatten(el.textContent) };
    }

    if (this.c.code.has(name)) {
      const lang = this.langOf(el);
      return {
        kind: "codeBlock",
        position,
        text: codeText(el.textContent),
        ...(lang ? { language: lang } : {}),
      };
    }

    const ordered = this.c.ordered.has(name);
    if (ordered || this.c.unordered.has(name)) {
      return {
        kind: "list",
        position,
        text: flatten(el.textContent),
        ordered,
        items: [...elementChildren(el)]
          .filter((item) => this.c.items.has(localName(item)))
          .map((item): ListItemNode => ({
            kind: "listItem",
            position: this.span(item),
            text: flatten(item.textContent),
            children: this.blockContent(item),
          })),
      };
    }

    if (this.c.tables.has(name)) return this.tableNode(el, position);

    if (this.c.admonitions.has(name)) {
      const variant = this.admonitionVariantOf(el, name);
      return {
        kind: "admonition",
        position,
        text: flatten(el.textContent),
        // A `@type`/name outside the six variants `AdmonitionNode` knows
        // leaves `variant` unset, rather than inventing an equivalence.
        ...(variant ? { variant } : {}),
        children: this.blockContent(el),
      };
    }

    if (this.c.images.has(name)) return this.imageNode(el, position);

    if (this.c.blockquotes.has(name)) {
      return {
        kind: "blockquote",
        position,
        text: flatten(el.textContent),
        children: this.blockContent(el),
      };
    }

    if (this.c.definitionLists.has(name)) return this.definitionListNode(el, position);

    return null;
  }

  /** A table's rows, from any of its CALS wrappers (`tgroup`, `tbody`, `thead`). */
  private tableNode(el: XmlElement, position: Position): TableNode {
    return {
      kind: "table",
      position,
      text: flatten(el.textContent),
      children: this.tableRowsOf(el, false),
    };
  }

  /**
   * Rows found anywhere under `el`, recursing through every wrapper - `tgroup`,
   * `tbody`, `thead` and the like - regardless of whether it is known
   * elsewhere. A table's internal grouping elements carry no content of their
   * own; only the rows and cells inside them do.
   *
   * `inheritedHeader` tracks whether an enclosing `tableHeaderWrappers` element
   * (CALS's `<thead>`) has been entered; `tableHeaderRows` (DITA's `<sthead>`)
   * marks a row as a header on its own, without a wrapper.
   */
  private tableRowsOf(el: XmlElement, inheritedHeader: boolean): TableRowNode[] {
    const rows: TableRowNode[] = [];
    for (const child of elementChildren(el)) {
      const name = localName(child);
      if (this.c.tableRows.has(name)) {
        rows.push(this.tableRow(child, inheritedHeader || this.c.tableHeaderRows.has(name)));
        continue;
      }
      rows.push(
        ...this.tableRowsOf(child, inheritedHeader || this.c.tableHeaderWrappers.has(name)),
      );
    }
    return rows;
  }

  private tableRow(el: XmlElement, header: boolean): TableRowNode {
    const cells: TableCellNode[] = [];
    for (const child of elementChildren(el)) {
      if (!this.c.tableCells.has(localName(child))) continue;
      cells.push({
        kind: "tableCell",
        position: this.span(child),
        text: flatten(child.textContent),
        children: this.blockContent(child),
      });
    }
    return {
      kind: "tableRow",
      position: this.span(el),
      text: flatten(el.textContent),
      header,
      children: cells,
    };
  }

  /**
   * An admonition's variant: the value of `admonitionVariantAttribute` when the
   * vocabulary names one (DITA's `<note type>`, defaulting to `note` when the
   * attribute is absent - DITA's own default), or the element's own lowercased
   * name otherwise (DocBook's `<warning>`, `<tip>`, and so on). Undefined when
   * neither names one of the six variants `AdmonitionNode` knows.
   */
  private admonitionVariantOf(el: XmlElement, name: string): Variant | undefined {
    const attr = this.c.vocab.admonitionVariantAttribute;
    const raw = (attr ? el.getAttribute(attr) : "") || name;
    const variant = raw.toLowerCase();
    return isAdmonitionVariant(variant) ? variant : undefined;
  }

  /**
   * An image, standing alone or wrapping one. `imageDataElements` names the
   * element carrying the url - `el` itself for a self-contained image (DITA's
   * `<image href>`), or a descendant found by name otherwise (DocBook's
   * `<imagedata fileref>` inside a `<mediaobject>`/`<figure>`). The caption
   * reuses `titleOf`, the same lookup a section uses for its heading - DITA's
   * `<fig><title>` and DocBook's `<figure><title>` are both a direct `<title>`
   * child.
   */
  private imageNode(el: XmlElement, position: Position): ImageNode {
    const name = localName(el);
    const dataEl = this.c.imageDataElements.has(name)
      ? el
      : findDescendant(el, this.c.imageDataElements);
    const attr = this.c.vocab.imageUrlAttribute;
    const url = (dataEl && attr ? dataEl.getAttribute(attr) : "") || "";
    const altEl = dataEl ? findDirectChild(dataEl, this.c.imageAltElements) : null;
    const title = this.titleOf(el);
    return {
      kind: "image",
      position,
      text: flatten(el.textContent),
      url,
      alt: altEl ? flatten(altEl.textContent) : "",
      ...(title ? { title: flatten(title.textContent) } : {}),
    };
  }

  private definitionListNode(el: XmlElement, position: Position): DefinitionListNode {
    const children: DefinitionItemNode[] = [];
    for (const child of elementChildren(el)) {
      if (this.c.definitionItems.has(localName(child))) {
        children.push(this.definitionItem(child));
      }
    }
    return {
      kind: "definitionList",
      position,
      text: flatten(el.textContent),
      children,
    };
  }

  /** One entry, pairing its term(s) - joined with ", " when more than one - with its definition body. */
  private definitionItem(el: XmlElement): DefinitionItemNode {
    const terms: string[] = [];
    let body: XmlElement | null = null;
    for (const child of elementChildren(el)) {
      const name = localName(child);
      if (this.c.definitionTerms.has(name)) {
        terms.push(flatten(child.textContent));
      } else if (body === null && this.c.definitionBodies.has(name)) {
        body = child;
      }
    }
    return {
      kind: "definitionItem",
      position: this.span(el),
      text: flatten(el.textContent),
      term: terms.join(", "),
      definition: body ? this.blockContent(body) : [],
    };
  }

  /**
   * One container's content, with its own loose prose kept as a paragraph.
   * Shared by list items, table cells, admonitions, block quotes, and a
   * definition's body - anywhere the content model asks for a container's
   * `children` rather than a single block.
   *
   * mdast puts a list item's principal text in a `paragraph` child regardless
   * of markup, and `lists: {items: {paragraphs: {min: 1}}}` has to count the
   * same thing in every format. So the loose text is gathered into one, in the
   * position it occupies among the container's blocks.
   *
   * Gathering it rather than checking whether the container has any children is
   * what makes the two cases agree. `<li>bare text</li>` was already
   * reconciled; `<li>Parent<ul>…</ul></li>` was not, because the nested list is
   * a child, so the item looked accounted for and `Parent` became prose
   * nothing counted - while its Markdown, HTML, AsciiDoc, and reST twins all
   * counted one. This is the same fix `html.ts` carries, and the two should
   * stay in step.
   *
   * Unmapped elements contribute their text rather than being skipped, which is
   * what the old whole-item `textContent` did: inside a container they are
   * inline markup - DITA's `<b>`, `<xref>` - not structure worth dropping.
   */
  private blockContent(container: XmlElement): ContentNode[] {
    const out: ContentNode[] = [];
    let text = "";

    const flush = (): void => {
      const value = flatten(text);
      text = "";
      if (value.length === 0) return;
      out.push({ kind: "paragraph", position: this.span(container), text: value });
    };

    for (let child = container.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== ELEMENT_NODE) {
        text += child.nodeValue ?? "";
        continue;
      }

      const el = child as XmlElement;
      const nested = this.c.transparent.has(localName(el))
        ? this.contentChildren(el)
        : [this.content(el)].filter((n): n is ContentNode => n !== null);

      if (nested.length > 0) {
        flush();
        out.push(...nested);
        continue;
      }
      text += el.textContent ?? "";
    }

    flush();
    return out;
  }

  private contentChildren(el: XmlElement): ContentNode[] {
    const out: ContentNode[] = [];
    for (const child of elementChildren(el)) {
      if (this.c.transparent.has(localName(child))) {
        out.push(...this.contentChildren(child));
        continue;
      }
      const node = this.content(child);
      if (node) out.push(node);
    }
    return out;
  }

  /** A code block's language, with a `language-` prefix stripped. */
  private langOf(el: XmlElement): string | undefined {
    for (const attr of this.c.vocab.codeLangAttributes) {
      const value = el.getAttribute(attr);
      if (value) return value.replace(/^language-/, "");
    }
    return undefined;
  }
}

/**
 * Parse, refusing anything xmldom had to guess at.
 *
 * xmldom is lenient: it throws only on a `fatalError`, and reports `error` and
 * `warning` through the handler while carrying on with a repaired tree. The
 * line between them is drawn at `error` because in XML the element tree *is*
 * the structure - there is no second signal like a `##` to fall back on - so
 * linting a tree xmldom guessed at reports on a document nobody wrote. A
 * mismatched end tag or a stray `<` puts every following element at the wrong
 * depth, and the findings would be confident nonsense. `warning` is left alone:
 * xmldom recovers from an unquoted attribute value without changing the element
 * tree at all, and attributes here are metadata, not structure.
 *
 * This is also the line docmeta's XML extractor draws, so a file manni lint
 * lints is exactly a file docmeta will read metadata from.
 */
function parseDocument(source: string, filePath: string): XmlElement {
  const problems: string[] = [];
  let doc;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        if (level === "error" || level === "fatalError") problems.push(message);
      },
    }).parseFromString(source, "text/xml");
  } catch (err) {
    const detail = problems[0] ?? errorMessage(err);
    throw new LintError(
      `${filePath}: could not parse as XML: ${firstLine(detail)}`,
    );
  }

  const [firstProblem] = problems;
  if (firstProblem !== undefined) {
    throw new LintError(
      `${filePath}: could not parse as XML: ${firstLine(firstProblem)}`,
    );
  }

  const root = doc.documentElement;
  if (!root) {
    throw new LintError(`${filePath}: could not parse as XML: no root element`);
  }
  return root;
}

/** xmldom appends the offending source to some messages; one line is enough. */
function firstLine(message: string): string {
  const [first] = message.split("\n");
  return (first ?? message).trim();
}

/**
 * Metadata for routing, from docmeta.
 *
 * **Not `extractFrontmatter`.** `src/parsers/markdown.ts` calls it because for
 * Markdown it is the whole story, but in docmeta that function is specifically
 * the *fenced* `---` block reader ("core front matter extraction shared by the
 * markdown, mdx, adoc, rst formats"). An XML file has no fenced block, so
 * `extractFrontmatter(content, "xml")` returns `{ data: {}, present: false }`
 * for every XML document ever written, and `type:` routing for `.xml` would
 * silently never fire. docmeta's *registry* is the right door: its XML
 * extractor reads the root element's attributes (`<task type="how-to">` ->
 * `{ type: "how-to" }`, minus `xmlns*`, with values parsed as YAML scalars)
 * plus the text of simple direct children as dotted keys (`task.title`). That
 * is a real `type`, so an `.xml` page does route.
 *
 * The HTML parser merges a fenced block with its native reading, fenced
 * winning a collision. This one does not, because an `.xml` file cannot carry a
 * fenced block and still be XML: a leading `---` is character data outside the
 * root element, which xmldom reports as an error and `parseDocument` refuses
 * before metadata is ever read. (HTML has no such rule - a comment or stray
 * text before `<html>` parses fine - which is why the merge is right there and
 * would be unreachable code here.)
 *
 * It throws on malformed XML, the same line `parseDocument` draws, but it is
 * called after the parse so in practice it cannot be the one to complain.
 */
function readMetadata(
  content: string,
  filePath: string,
): Record<string, unknown> | null {
  const extractor = extractorForExtension(".xml");
  if (!extractor) return null;
  try {
    const meta = extractor.extract(content, filePath);
    return meta.present ? meta.data : null;
  } catch (err) {
    throw new LintError(
      `${filePath}: could not read XML metadata: ${firstLine(errorMessage(err))}`,
    );
  }
}

/**
 * Note on the frontmatter-title rule.
 *
 * `withFrontmatterTitle` in the Markdown parser synthesizes an H1 from
 * `title:` when the body has none, because Docusaurus and Hugo render the page
 * title from frontmatter and their pages legitimately start at `##`. That
 * reasoning does not carry to XML and the rule is deliberately not applied
 * here. An XML document's title is an element - `<title>` - in the body, in
 * document order, exactly where the section fold already looks for it; there is
 * no publishing convention that moves it out. And what docmeta calls this
 * document's "frontmatter" is the *root element's own attributes*, so a `title`
 * attribute would be a second title on the very element that already carries
 * the real one: synthesizing a section from it would nest the document's actual
 * title underneath a duplicate of itself. A document with no title element at
 * all is not a page missing its H1, it is a document with no structure to lint,
 * and `parseXml` says so.
 */

/**
 * Parse XML into the generic tree.
 *
 * @param vocabularies Overrides the built-ins; the extension point for a
 *                     bespoke schema until there is a config surface for it.
 */
export function parseXml(
  content: string,
  filePath: string,
  vocabularies: readonly XmlVocabulary[] = XML_VOCABULARIES,
): DocumentTree {
  const map = new SourceMap(content);
  const root = parseDocument(map.text, filePath);

  const compiled = vocabularies.map(compile);
  if (compiled.length === 0) {
    throw new LintError(`${filePath}: no XML vocabularies are configured.`);
  }

  const { best, score } = chooseVocabulary(root, compiled);
  const names = compiled.map((c) => c.vocab.label).join(", ");

  // Nothing recognized is an error rather than an empty tree. An empty tree
  // would lint as a document that is missing every section its template asks
  // for - a cascade of findings that says nothing about the page and points
  // nowhere useful. The gap is in the mapping, and this is where to say so.
  if (score <= 0) {
    throw new LintError(
      `${filePath}: no known XML vocabulary matched <${localName(root)}>. ` +
        `manni lint understands ${names}; add an entry to XML_VOCABULARIES ` +
        `in src/parsers/xml.ts to describe another schema.`,
    );
  }

  const flattener = new Flattener(best, map);
  flattener.visit(root, 0);
  const fragments = flattener.fragments;

  if (!fragments.some((b) => b.type === "heading")) {
    throw new LintError(
      `${filePath}: read as ${best.vocab.label}, but no titled section was found. ` +
        `A ${best.vocab.label} section is one of <${best.vocab.sections.join(">, <")}> ` +
        `carrying a <${best.vocab.titles.join(">/<")}>; without one the document has ` +
        `no structure to check.`,
    );
  }

  const frontmatter = readMetadata(content, filePath);

  return {
    format: "xml",
    filePath,
    frontmatter,
    // The metadata block is the root element's start tag: from its `<` to the
    // character after its `>`, which is where its first child begins.
    frontmatterPosition: frontmatter
      ? {
          start: map.point(root) ?? { ...map.docEnd },
          end:
            map.point(root.firstChild) ??
            map.endOfLine(map.point(root)?.line ?? 1),
        }
      : null,
    sections: sectionize(fragments, map.docEnd),
  };
}

export const xmlParser: DocumentParser = {
  name: "xml",
  label: "XML",
  kinds: [
    "paragraph",
    "codeBlock",
    "list",
    "listItem",
    "table",
    "tableRow",
    "tableCell",
    "admonition",
    "image",
    "blockquote",
    "definitionList",
    "definitionItem",
  ],
  /**
   * `.dita` as well as `.xml`, because that is what a DITA topic is actually
   * called on disk and docmeta registers it too — a docset whose topics this
   * parser was written for would otherwise be walked past entirely.
   *
   * Not `.ditamap`: a map is a table of contents, with no titled section and no
   * prose, so every map in a docset would report as unparseable. A map is not a
   * page and has no doctype to check.
   */
  extensions: [".xml", ".dita"],
  /**
   * A directory walk collects `.dita` but not `.xml`. A `.dita` file is a
   * documentation topic by definition; `.xml` is a container a repository uses
   * for build files, sitemaps, and project metadata, none of which match a
   * documentation vocabulary. Sweeping those in made one `pom.xml` fail an
   * otherwise clean tree. Naming an `.xml` file explicitly still parses it.
   */
  walkExtensions: [".dita"],
  parse: (content, filePath) => parseXml(content, filePath),
};
