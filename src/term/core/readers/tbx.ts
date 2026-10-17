/**
 * TBX termbases (proposal 0084): one reader for v2 (`<martif>`) and v3
 * (`<tbx>`), DCA and DCT style, the version told by the root element. Each
 * entry yields a term per language, all sharing the entry's id, so a
 * German and an English designation of one concept are siblings joined on
 * `id`.
 *
 * A category is read into its named field only when `tbx-model.ts` writes it
 * back as it was. Anything else, a vendor category, an extra attribute, a
 * second definition, rides along whole in `tbx-elements` at its level. The
 * header is not part of any term: an in-place write never touches it.
 */
import { DOMParser, type Element } from "@xmldom/xmldom";
import { TermError } from "../../errors.js";
import {
  TERM_FIELDS,
  type Term,
  type TermAuxRecord,
  type TermDesignation,
  type TermField,
  type TermInput,
  type TermLink,
  type TermReader,
  type TermReadResult,
  type TermTransaction,
} from "../../types.js";
import { slugOf } from "../id.js";
import { reindent } from "../writers/markup.js";
import { nothing, recordOf, skipped, termOf, textOf } from "./normalize.js";
import { indentAt, lineEnding, sameFields } from "./splice.js";
import {
  TBX_CATEGORIES,
  TBX_LINK_FIELDS,
  TBX_MODULE_NAMESPACES,
  TBX_NO_STATUS,
  TBX_STATUS_VALUES,
  TBX_TERM_NOTES,
  TBX_TEXT_FIELDS,
  TBX_V3_NAMESPACE,
  escapeAttribute,
  isTermNoteItem,
  lf,
  markupText,
  rememberTbxSource,
  tbxEntryLines,
  tbxSourceOf,
  type TbxCategory,
  type TbxCategoryName,
  type TbxDesignationShape,
  type TbxDocument,
  type TbxEntryShape,
  type TbxModule,
  type TbxStatus,
} from "./tbx-model.js";
import { childrenOf, lineOfElement, lineStarts, spanOfElement, tagEnd, type ParsedXml } from "./xml.js";

const LABEL = "TBX entry";

interface Doc {
  input: TermInput;
  xml: ParsedXml;
  document: TbxDocument;
  /** The structural namespace: TBX v3's, or none for v2. */
  ns: string;
}

const parsed = new WeakMap<TermInput, Doc>();

function parseTbx(input: TermInput): Doc {
  const cached = parsed.get(input);
  if (cached !== undefined) return cached;
  const shift = input.content.charCodeAt(0) === 0xfeff ? 1 : 0;
  const body = input.content.slice(shift);
  const errors: string[] = [];
  let root: Element | null = null;
  try {
    root = new DOMParser({
      onError: (level, message) => {
        if (level !== "error" && level !== "fatalError") return;
        // A DTD-declared entity is not damage: no DTD is ever loaded (see xml.ts).
        if (/entity not found/i.test(message)) return;
        errors.push(message);
      },
    }).parseFromString(body, "text/xml").documentElement;
  } catch (error) {
    if (errors.length === 0) errors.push(error instanceof Error ? error.message : String(error));
  }
  const failure = errors[0] ?? (root === null ? "no root element" : undefined);
  if (failure !== undefined || root === null) {
    throw new TermError(`${input.file}: could not be read as tbx: Invalid XML: ${failure ?? "no root element"}`);
  }
  const local = root.localName ?? root.nodeName;
  if (local !== "martif" && local !== "tbx") {
    throw new TermError(`${input.file}: is not TBX: its root element is <${root.nodeName}>, not <martif> or <tbx>.`);
  }
  const version = local === "martif" ? 2 : 3;
  const prefixes: Record<TbxModule, string> = { min: "min", basic: "basic", lng: "lng" };
  for (let i = 0; i < root.attributes.length; i++) {
    const attribute = root.attributes.item(i);
    if (attribute === null || !attribute.name.startsWith("xmlns:")) continue;
    for (const module of Object.keys(TBX_MODULE_NAMESPACES) as TbxModule[]) {
      if (TBX_MODULE_NAMESPACES[module] === attribute.value) prefixes[module] = attribute.name.slice("xmlns:".length);
    }
  }
  const xml: ParsedXml = { root, body, shift, starts: lineStarts(body) };
  const doc: Doc = {
    input,
    xml,
    ns: root.namespaceURI ?? "",
    document: {
      content: input.content,
      version,
      style: version === 3 && root.getAttribute("style") === "dct" ? "dct" : "dca",
      prefixes,
    },
  };
  const bodyEl = structuralChildren(doc, root, "text").flatMap((text) => structuralChildren(doc, text, "body"))[0];
  if (bodyEl !== undefined) {
    const inner = innerSpan(doc, bodyEl);
    if (inner !== undefined) doc.document.body = inner;
  }
  const headerEl = structuralChildren(doc, root, version === 3 ? "tbxHeader" : "martifHeader")[0];
  const header = headerEl === undefined ? undefined : innerSpan(doc, headerEl);
  if (header !== undefined) doc.document.header = header;
  const backEl = structuralChildren(doc, root, "text").flatMap((text) => structuralChildren(doc, text, "back"))[0];
  const back = backEl === undefined ? undefined : innerSpan(doc, backEl);
  if (back !== undefined) doc.document.back = back;
  parsed.set(input, doc);
  return doc;
}

// ---------------------------------------------------------------------------
// Elements

function isStructural(doc: Doc, el: Element, local: string): boolean {
  return el.localName === local && (el.namespaceURI ?? "") === doc.ns;
}

function structuralChildren(doc: Doc, el: Element, local: string): Element[] {
  return childrenOf(el).filter((child) => isStructural(doc, child, local));
}

/** Whether every attribute but namespace declarations is one of `allowed`. */
function onlyAttributes(el: Element, allowed: readonly string[]): boolean {
  for (let i = 0; i < el.attributes.length; i++) {
    const name = el.attributes.item(i)?.name;
    if (name === undefined || name === "xmlns" || name.startsWith("xmlns:")) continue;
    if (!allowed.includes(name)) return false;
  }
  return true;
}

/** An element's attributes but those in `own`, which manni writes itself, as XML in source order: ` id="t1"`. */
function attributesOf(el: Element, own: readonly string[] = []): string {
  let out = "";
  for (let i = 0; i < el.attributes.length; i++) {
    const attribute = el.attributes.item(i);
    if (attribute !== null && !own.includes(attribute.name)) out += ` ${attribute.name}="${escapeAttribute(attribute.value)}"`;
  }
  return out;
}

/** The category an element spells in the file's style, or `undefined`. */
function categoryOf(doc: Doc, el: Element): TbxCategory | undefined {
  const dct = doc.document.style === "dct";
  for (const cat of Object.values(TBX_CATEGORIES)) {
    if (dct) {
      if (el.localName === cat.name && el.namespaceURI === TBX_MODULE_NAMESPACES[cat.module]) return cat;
    } else if (isStructural(doc, el, cat.element) && el.getAttribute("type") === cat.name) {
      return cat;
    }
  }
  return undefined;
}

function isCategory(doc: Doc, el: Element, name: TbxCategoryName): boolean {
  return categoryOf(doc, el) === TBX_CATEGORIES[name];
}

/** The attributes a category element carries in canonical form. */
function categoryAttributes(doc: Doc, cat: TbxCategory): string[] {
  const linked = cat.element === "ref" || cat.element === "xref";
  return [...(doc.document.style === "dct" ? [] : ["type"]), ...(linked ? ["target"] : [])];
}

function innerSpan(doc: Doc, el: Element): { start: number; end: number } | undefined {
  const span = spanOfElement(doc.xml, el);
  if (span === undefined) return undefined;
  const open = tagEnd(doc.xml.body, span.start - doc.xml.shift);
  if (open === undefined) return undefined;
  const start = open.end + doc.xml.shift;
  if (open.selfClosing) return { start, end: start };
  return { start, end: doc.input.content.lastIndexOf("</", span.end - 1) };
}

interface Value {
  text: string;
  /** The value's inner XML, when it holds markup or a comment. */
  markup?: string;
}

/** An element's content as a value, or `undefined` when it is empty or its markup would not write back. */
function valueOf(doc: Doc, el: Element, allowMarkup = true): Value | undefined {
  const text = lf(el.textContent ?? "").trim();
  if (text === "") return undefined;
  let marked = false;
  for (let i = 0; i < el.childNodes.length; i++) {
    const type = el.childNodes.item(i)?.nodeType;
    if (type === 1 || type === 7 || type === 8) marked = true;
  }
  if (!marked) return { text };
  if (!allowMarkup) return undefined;
  const inner = innerSpan(doc, el);
  if (inner === undefined) return undefined;
  const markup = lf(doc.input.content.slice(inner.start, inner.end)).trim();
  return markupText(markup) === text ? { text, markup } : undefined;
}

/** A category element's value, when the element is in canonical form. */
function categoryValue(doc: Doc, el: Element, name: TbxCategoryName, allowMarkup = true): Value | undefined {
  const cat = TBX_CATEGORIES[name];
  if (categoryOf(doc, el) !== cat || !onlyAttributes(el, categoryAttributes(doc, cat))) return undefined;
  return valueOf(doc, el, allowMarkup);
}

function plainValue(doc: Doc, el: Element, local: string, allowMarkup = true): Value | undefined {
  if (!isStructural(doc, el, local) || !onlyAttributes(el, [])) return undefined;
  return valueOf(doc, el, allowMarkup);
}

/** The element as a `tbx-elements` item: its source text, LF, dedented, with the namespaces it needs declared. */
function itemOf(doc: Doc, el: Element): string {
  const { content } = doc.input;
  const span = spanOfElement(doc.xml, el);
  if (span === undefined) return `<${el.nodeName}/>`;
  const indent = indentAt(content, span.start);
  const lines = lf(content.slice(span.start, span.end)).split("\n");
  const text = lines.map((line, i) => (i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line)).join("\n");
  const declarations = namespacesNeeded(doc, el)
    .map(([prefix, uri]) => ` ${prefix === "" ? "xmlns" : `xmlns:${prefix}`}="${uri.replaceAll('"', "&quot;")}"`)
    .join("");
  const nameEnd = 1 + el.nodeName.length;
  return `${text.slice(0, nameEnd)}${declarations}${text.slice(nameEnd)}`;
}

/** The prefixes an element's subtree uses and does not declare, with their in-scope namespaces. The TBX v3 namespace is never one. */
function namespacesNeeded(doc: Doc, el: Element): [string, string][] {
  const used = new Set<string>();
  const declared = new Set<string>();
  const walk = (node: Element): void => {
    if (node.prefix !== null && node.prefix !== "") used.add(node.prefix);
    for (let i = 0; i < node.attributes.length; i++) {
      const name = node.attributes.item(i)?.name ?? "";
      if (name === "xmlns") declared.add("");
      else if (name.startsWith("xmlns:")) declared.add(name.slice("xmlns:".length));
      else if (name.includes(":")) used.add(name.slice(0, name.indexOf(":")));
    }
    for (const child of childrenOf(node)) walk(child);
  };
  walk(el);
  if ((el.prefix ?? "") === "" && (el.namespaceURI ?? "") !== doc.ns && el.namespaceURI !== TBX_V3_NAMESPACE) {
    used.add("");
  }
  const out: [string, string][] = [];
  for (const prefix of used) {
    if (prefix === "xml" || declared.has(prefix)) continue;
    const uri = el.lookupNamespaceURI(prefix === "" ? null : prefix);
    if (uri !== null && uri !== "" && uri !== TBX_V3_NAMESPACE) out.push([prefix, uri]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Levels

type Level = "concept" | "language" | "term";

/** What one level reads into: its aux record (a designation at term level) and the markup of its values. */
interface LevelRead {
  aux: TermDesignation;
  markup: string[];
}

function push<K extends keyof TermAuxRecord>(aux: TermAuxRecord, field: K, item: NonNullable<TermAuxRecord[K]>[number]): void {
  const list = (aux[field] ?? []) as unknown[];
  list.push(item);
  Object.assign(aux, { [field]: list });
}

/** A descripGrp holding one definition, then its sources, then its notes: the canonical grouped definition. */
function definitionGroup(doc: Doc, el: Element): { definition: Value; sources: Value[]; notes: Value[] } | undefined {
  if (!isStructural(doc, el, "descripGrp") || !onlyAttributes(el, [])) return undefined;
  const [first, ...rest] = childrenOf(el);
  if (first === undefined || rest.length === 0) return undefined;
  const definition = categoryValue(doc, first, "definition");
  if (definition === undefined) return undefined;
  const sources: Value[] = [];
  const notes: Value[] = [];
  for (const child of rest) {
    const source = notes.length === 0 ? categoryValue(doc, child, "source") : undefined;
    const note = source === undefined ? plainValue(doc, child, "note") : undefined;
    if (source !== undefined) sources.push(source);
    else if (note !== undefined) notes.push(note);
    else return undefined;
  }
  return { definition, sources, notes };
}

function linkOf(doc: Doc, el: Element, name: TbxCategoryName): { link: TermLink; markup?: string } | undefined {
  const cat = TBX_CATEGORIES[name];
  if (categoryOf(doc, el) !== cat || !onlyAttributes(el, categoryAttributes(doc, cat))) return undefined;
  const target = el.getAttribute("target");
  if (target === null || target === "" || target !== target.trim()) return undefined;
  if (lf(el.textContent ?? "").trim() === "") return { link: { target } };
  const value = valueOf(doc, el);
  if (value === undefined) return undefined;
  return { link: { target, text: value.text }, ...(value.markup === undefined ? {} : { markup: value.markup }) };
}

/** A transacGrp of a transaction type, then its responsibility, then its date. */
function transactionOf(doc: Doc, el: Element): TermTransaction | undefined {
  if (!isStructural(doc, el, "transacGrp") || !onlyAttributes(el, [])) return undefined;
  const children = childrenOf(el);
  const [first] = children;
  const type = first === undefined ? undefined : categoryValue(doc, first, "transactionType", false);
  if (type === undefined) return undefined;
  const transaction: TermTransaction = { type: type.text };
  let i = 1;
  const next = children[i];
  const responsibility = next === undefined ? undefined : categoryValue(doc, next, "responsibility", false);
  if (responsibility !== undefined) {
    transaction.responsibility = responsibility.text;
    i += 1;
  }
  const last = children[i];
  const date = last === undefined ? undefined : plainValue(doc, last, "date", false);
  if (date !== undefined) {
    transaction.date = date.text;
    i += 1;
  }
  return i === children.length ? transaction : undefined;
}

/** An adminGrp of a reading and its reading note. */
function readingGroup(doc: Doc, el: Element): { reading: Value; note: Value } | undefined {
  if (!isStructural(doc, el, "adminGrp") || !onlyAttributes(el, [])) return undefined;
  const children = childrenOf(el);
  const [first, second] = children;
  if (children.length !== 2 || first === undefined || second === undefined) return undefined;
  const reading = categoryValue(doc, first, "reading", false);
  const note = categoryValue(doc, second, "readingNote");
  return reading === undefined || note === undefined ? undefined : { reading, note };
}

/** A record status for a termNote value, or `undefined` when the canonical form would write it differently. */
function statusOf(text: string): string | undefined {
  for (const [status, value] of Object.entries(TBX_STATUS_VALUES)) if (value === text) return status;
  return text in TBX_STATUS_VALUES || text === TBX_NO_STATUS ? undefined : text;
}

/**
 * Read one level's children into `read`. A child the canonical form would not
 * write back as it is goes whole into `tbx-elements`, in source order.
 */
function readLevel(doc: Doc, children: readonly Element[], level: Level, read: LevelRead): void {
  const { aux } = read;
  const items: string[] = [];
  const keep = (value: Value): string => {
    if (value.markup !== undefined) read.markup.push(value.markup);
    return value.text;
  };
  // The level's definition, plain or grouped. With one, the level's sources
  // and notes are written in its group, so a loose one would not write back.
  const definitionEl = children.find(
    (child) => categoryValue(doc, child, "definition") !== undefined || definitionGroup(doc, child) !== undefined,
  );

  const mapped = (child: Element): boolean => {
    if (child === definitionEl) {
      const group = definitionGroup(doc, child);
      const plain = categoryValue(doc, child, "definition");
      const definition = group?.definition ?? plain;
      if (definition === undefined) return false;
      aux.definition = keep(definition);
      for (const source of group?.sources ?? []) push(aux, "sources", keep(source));
      for (const note of group?.notes ?? []) push(aux, "notes", keep(note));
      return true;
    }
    if (definitionEl !== undefined && (isCategory(doc, child, "source") || isStructural(doc, child, "note"))) return false;
    if (isStructural(doc, child, "note")) {
      const note = plainValue(doc, child, "note");
      if (note === undefined) return false;
      push(aux, "notes", keep(note));
      return true;
    }
    if (isStructural(doc, child, "transacGrp")) {
      const transaction = transactionOf(doc, child);
      if (transaction === undefined) return false;
      push(aux, "transactions", transaction);
      return true;
    }
    if (level === "term" && isStructural(doc, child, "adminGrp")) {
      const group = readingGroup(doc, child);
      if (group === undefined || aux.reading !== undefined) return false;
      aux.reading = keep(group.reading);
      aux["reading-note"] = keep(group.note);
      return true;
    }
    for (const [field, name] of TBX_TEXT_FIELDS) {
      if (!isCategory(doc, child, name)) continue;
      const value = categoryValue(doc, child, name);
      if (value === undefined) return false;
      if (field === "subject-field") {
        if (aux["subject-field"] !== undefined) return false;
        aux["subject-field"] = keep(value);
      } else {
        push(aux, field, keep(value));
      }
      return true;
    }
    for (const [field, name] of TBX_LINK_FIELDS) {
      if (!isCategory(doc, child, name)) continue;
      const link = linkOf(doc, child, name);
      if (link === undefined) return false;
      if (link.markup !== undefined) read.markup.push(link.markup);
      push(aux, field, link.link);
      return true;
    }
    if (level !== "term") return false;
    if (isCategory(doc, child, "reading")) {
      const reading = categoryValue(doc, child, "reading", false);
      if (reading === undefined || aux.reading !== undefined) return false;
      aux.reading = reading.text;
      return true;
    }
    if (isCategory(doc, child, "transferComment")) {
      const comment = categoryValue(doc, child, "transferComment");
      if (comment === undefined || aux["transfer-comments"] !== undefined) return false;
      aux["transfer-comments"] = [keep(comment)];
      return true;
    }
    for (const [field, name] of TBX_TERM_NOTES) {
      if (!isCategory(doc, child, name)) continue;
      const value = categoryValue(doc, child, name, field !== "administrative-status");
      if (value === undefined || aux[field] !== undefined) return false;
      if (field === "administrative-status") {
        const status = statusOf(value.text);
        if (status === undefined) return false;
        aux[field] = status;
      } else {
        aux[field] = keep(value);
      }
      return true;
    }
    return false;
  };

  for (const child of children) if (!mapped(child)) items.push(itemOf(doc, child));
  // A term's termNotes precede its other children in TBX, and the canonical
  // form writes them there, so they lead its items whatever the source did.
  const ordered = level === "term" ? [...items.filter(isTermNoteItem), ...items.filter((i) => !isTermNoteItem(i))] : items;
  if (ordered.length > 0) aux["tbx-elements"] = ordered;
}

// ---------------------------------------------------------------------------
// Entries

interface DesignationRead {
  designation: TermDesignation;
  markup: string[];
  /** The status as read: a record status, a value as written, or `none`. */
  status: string;
  line: number;
  shape: TbxDesignationShape;
}

/** A tig, ntig or termSec, or `undefined` when it holds no term. */
function readDesignation(doc: Doc, el: Element): DesignationRead | undefined {
  let children = childrenOf(el);
  let group: Element | undefined;
  if (isStructural(doc, el, "ntig")) {
    [group] = structuralChildren(doc, el, "termGrp");
    if (group === undefined) return undefined;
    children = [...childrenOf(group), ...children.filter((child) => child !== group)];
  }
  const termEl = children.find((child) => isStructural(doc, child, "term"));
  const term = termEl === undefined ? undefined : valueOf(doc, termEl);
  const text = termEl === undefined ? undefined : textOf(lf(termEl.textContent ?? ""));
  if (termEl === undefined || text === undefined) return undefined;
  const read: LevelRead = { aux: { term: text }, markup: term?.markup === undefined ? [] : [term.markup] };
  readLevel(
    doc,
    children.filter((child) => child !== termEl),
    "term",
    read,
  );
  const { "administrative-status": status, ...designation } = read.aux;
  const shape: TbxDesignationShape = {
    term: text,
    attributes: attributesOf(el),
    termAttributes: attributesOf(termEl),
    ...(group === undefined ? {} : { group: attributesOf(group) }),
  };
  return { designation, markup: read.markup, status: status ?? TBX_NO_STATUS, line: lineOfElement(termEl), shape };
}

/** The label fields and designations for one language's designations, by the status rules of proposal 0084. */
function labelsOf(read: readonly DesignationRead[]): {
  label: string;
  alts: string[];
  hiddens: string[];
  designations: TermDesignation[] | undefined;
} {
  const preferred = read.findIndex((d) => d.status === "preferred");
  const labelAt = preferred === -1 ? 0 : preferred;
  const alts: string[] = [];
  const hiddens: string[] = [];
  const order: number[] = [];
  const altOrder: number[] = [];
  const hiddenOrder: number[] = [];
  const designations = read.map((d, i): TermDesignation => {
    const { status } = d;
    let kind: "label" | TbxStatus;
    if (i === labelAt) kind = "label";
    else if (status === "deprecated" || status === "superseded") kind = "deprecated";
    else kind = "admitted";
    if (kind === "admitted") {
      alts.push(d.designation.term);
      altOrder.push(i);
    } else if (kind === "deprecated") {
      hiddens.push(d.designation.term);
      hiddenOrder.push(i);
    }
    const implied = kind === "label" ? "preferred" : kind;
    return status === implied ? d.designation : { ...d.designation, "administrative-status": status };
  });
  order.push(labelAt, ...altOrder, ...hiddenOrder);
  const reordered = order.some((at, i) => at !== i);
  const detailed = designations.some((d) => Object.keys(d).length > 1);
  return {
    label: read[labelAt]?.designation.term ?? "",
    alts,
    hiddens,
    designations: reordered || detailed ? designations : undefined,
  };
}

function readEntry(doc: Doc, entry: Element, result: TermReadResult): void {
  const { input } = doc;
  const v3 = doc.document.version === 3;
  const languageTag = v3 ? "langSec" : "langSet";
  const designationTags = v3 ? ["termSec"] : ["tig", "ntig"];
  const children = childrenOf(entry);
  const concept: LevelRead = { aux: { term: "" }, markup: [] };
  readLevel(
    doc,
    children.filter((child) => !isStructural(doc, child, languageTag)),
    "concept",
    concept,
  );
  const { term: _none, ...conceptAux } = concept.aux;
  const span = spanOfElement(doc.xml, entry);
  const rootLanguage = doc.xml.root.getAttribute("xml:lang");
  const read: Term[] = [];
  let entryId = textOf(entry.getAttribute("id"));
  const shape: TbxEntryShape = { attributes: attributesOf(entry, ["id"]), languages: [] };

  for (const langEl of children.filter((child) => isStructural(doc, child, languageTag))) {
    const designations: DesignationRead[] = [];
    const others: Element[] = [];
    for (const child of childrenOf(langEl)) {
      const isDesignation = designationTags.some((tag) => isStructural(doc, child, tag));
      const designation = isDesignation ? readDesignation(doc, child) : undefined;
      if (designation !== undefined) designations.push(designation);
      else others.push(child);
    }
    if (designations.length === 0) {
      result.notices.push(skipped(input, lineOfElement(langEl), "TBX"));
      continue;
    }
    const language: LevelRead = { aux: { term: "" }, markup: [] };
    readLevel(doc, others, "language", language);
    const { term: _term, ...languageAux } = language.aux;
    const labels = labelsOf(designations);
    const markup = [...new Set([...concept.markup, ...language.markup, ...designations.flatMap((d) => d.markup)])];
    const raw: Partial<Record<TermField, unknown>> = {
      ...languageAux,
      label: labels.label,
      "alt-labels": labels.alts,
      "hidden-labels": labels.hiddens,
      ...(Object.keys(conceptAux).length === 0 ? {} : { "concept-entry": structuredClone(conceptAux) }),
      ...(labels.designations === undefined ? {} : { designations: labels.designations }),
      ...(markup.length === 0 ? {} : { "tbx-markup": markup }),
    };
    const record = recordOf(raw);
    if (record === undefined) continue;
    entryId ??= slugOf(record.label);
    const term = termOf(input, {
      record,
      language: langEl.getAttribute("xml:lang") ?? rootLanguage,
      constructId: entryId,
      construct: "tbx-entry",
      line: lineOfElement(langEl),
      lines: { label: designations[0]?.line },
      ...(span === undefined ? {} : { span }),
    });
    if (span !== undefined) rememberTbxSource(term, { document: doc.document, span, shape });
    shape.languages.push({
      language: term.language,
      attributes: attributesOf(langEl, ["xml:lang"]),
      designations: designations.map((d) => d.shape),
    });
    read.push(term);
  }
  result.terms.push(...read);
}

function readTbx(input: TermInput): TermReadResult {
  const doc = parseTbx(input);
  const result = nothing();
  const body = doc.document.body;
  if (body === undefined) return result;
  const entryTag = doc.document.version === 3 ? "conceptEntry" : "termEntry";
  for (const text of structuralChildren(doc, doc.xml.root, "text")) {
    for (const bodyEl of structuralChildren(doc, text, "body")) {
      for (const entry of structuralChildren(doc, bodyEl, entryTag)) readEntry(doc, entry, result);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// In place

function sameTerm(a: Term, b: Term): boolean {
  return a.id === b.id && a.language === b.language && sameFields(a.record, b.record, TERM_FIELDS);
}

/**
 * Rewrite the entries whose terms changed, each as a whole in canonical form,
 * indented where it sat and in the file's line endings. An entry none of
 * whose terms changed keeps its bytes, and so does the header.
 */
function applyTbx(input: TermInput, terms: readonly Term[]): string {
  return spliceEntries(input, terms, false);
}

/**
 * The TBX document the terms were all read from, written with the terms as
 * they are now (a same-source export): unchanged entries and everything
 * outside them keep their bytes, a changed entry is written canonically in
 * the document's version and style, and an entry none of whose terms is
 * given is left out.
 */
export function exportTbxSource(document: TbxDocument, file: string, terms: readonly Term[]): string {
  const input: TermInput = { content: document.content, file, format: "tbx", metadata: {}, lineFor: () => undefined };
  return spliceEntries(input, terms, true);
}

/** `content` without `[start, end)`, and without the line it sat on when nothing else is on it. */
function removeSpan(content: string, start: number, end: number): string {
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const after = /^[ \t]*(\r?\n|$)/.exec(content.slice(end))?.[0];
  if (!/^[ \t]*$/.test(content.slice(lineStart, start)) || after === undefined) {
    return content.slice(0, start) + content.slice(end);
  }
  return content.slice(0, lineStart) + content.slice(end + after.length);
}

/**
 * The entries of `input` with `terms` written over them. In place, an entry
 * given no terms, or only some of its languages, keeps the rest as read; an
 * export writes exactly the terms given.
 */
function spliceEntries(input: TermInput, terms: readonly Term[], exporting: boolean): string {
  const doc = parseTbx(input);
  const { content } = input;
  const groups = new Map<number, { end: number; current: Term[]; next: Term[] }>();
  for (const term of readTbx(input).terms) {
    const span = term.location.span;
    if (span === undefined) continue;
    const group = groups.get(span.start) ?? { end: span.end, current: [], next: [] };
    group.current.push(term);
    groups.set(span.start, group);
  }
  for (const term of terms) {
    const span = term.location.span;
    if (span === undefined) {
      throw new TermError(
        `${input.file}: term "${term.id}" cannot be written in place, because its entry has no position in the file.`,
      );
    }
    const group = groups.get(span.start);
    if (group?.end !== span.end) {
      throw new TermError(
        `${input.file}: term "${term.id}" does not match an entry in the file. Read the file again before writing it.`,
      );
    }
    group.next.push(term);
  }

  const eol = lineEnding(content);
  let next = content;
  for (const [start, group] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    if (group.next.length === 0) {
      if (exporting) next = removeSpan(next, start, group.end);
      continue;
    }
    const written =
      exporting || group.next.length >= group.current.length ? group.next : merge(group.current, group.next);
    const unchanged = written.length === group.current.length && written.every((t, i) => {
      const was = group.current[i];
      return was !== undefined && sameTerm(was, t);
    });
    if (unchanged) continue;
    // At the file's own version, each element keeps the attributes and ntig it was read with.
    const shape = group.current[0] === undefined ? undefined : tbxSourceOf(group.current[0])?.shape;
    const text = reindent(tbxEntryLines(written, doc.document, shape).join("\n"), indentAt(content, start), eol);
    next = next.slice(0, start) + text + next.slice(group.end);
  }
  return next;
}

/** The entry's terms with each one the caller handed in, matched on language, in place of the one read. */
function merge(current: readonly Term[], given: readonly Term[]): Term[] {
  const left = [...given];
  return current.map((term) => {
    const at = left.findIndex((t) => t.language === term.language);
    return at === -1 ? term : (left.splice(at, 1)[0] ?? term);
  });
}

export const tbxEntryReader: TermReader = {
  construct: "tbx-entry",
  label: LABEL,
  formats: ["tbx"],
  read: readTbx,
  apply: applyTbx,
};
