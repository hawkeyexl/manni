/**
 * TBX's canonical form (proposal 0084): how a term set's entries are written
 * as TBX v2 or v3, DCA or DCT. The reader keeps an element in a named field
 * only when this form writes it back unchanged, ignoring whitespace and
 * attribute order, so this module is the reader's fidelity rule and the
 * writers' serializer at once.
 *
 * Within a level the order is fixed: the named fields in the order below, then
 * `tbx-elements` in source order. A level's children (a language, a term)
 * follow, as TBX's content model puts them. A definition that shares its level
 * with sources or notes is written in one `descripGrp` with them.
 */
import { DOMParser } from "@xmldom/xmldom";
import type {
  Term,
  TermAuxRecord,
  TermDesignation,
  TermDesignationField,
  TermLink,
  TermLocation,
  TermRecord,
} from "../../types.js";
import { xmlAttribute as escapeAttribute, xmlText as escapeText } from "../writers/markup.js";
import { DEFAULT_LANGUAGE } from "../writers/render-util.js";

export { escapeAttribute, escapeText };

export type TbxVersion = 2 | 3;
export type TbxStyle = "dca" | "dct";
/** The TBX v3 data-category modules, each a namespace in DCT style. */
export type TbxModule = "min" | "basic" | "lng";

/** The structural namespace of TBX v3. v2 has none. */
export const TBX_V3_NAMESPACE = "urn:iso:std:iso:30042:ed-2";

/** Each module's DCT namespace, from the LTAC module definitions. */
export const TBX_MODULE_NAMESPACES: Readonly<Record<TbxModule, string>> = {
  min: "http://www.tbxinfo.net/ns/min",
  basic: "http://www.tbxinfo.net/ns/basic",
  lng: "http://www.tbxinfo.net/ns/linguist",
};

/** What a serializer needs to know about the file it writes into. */
export interface TbxFormat {
  version: TbxVersion;
  style: TbxStyle;
  /** The prefix each module is declared with, in DCT style. Defaults to the module's name. */
  prefixes?: Partial<Record<TbxModule, string>>;
}

/** A TBX file as read: its text, its form, and where its entries sit. */
export interface TbxDocument extends TbxFormat {
  /** The file's content, exactly as read. */
  content: string;
  prefixes: Record<TbxModule, string>;
  /** The UTF-16 offsets of `<body>`'s content in `content`, `[start, end)`: between its tags. */
  body?: { start: number; end: number };
  /** The offsets of the header's content (`martifHeader` or `tbxHeader`), between its tags. */
  header?: { start: number; end: number };
  /** The offsets of `<back>`'s content, between its tags. */
  back?: { start: number; end: number };
}

/**
 * An entry's structure as read, which a rewrite at the same version keeps:
 * each structural element's attributes but those manni writes itself, as XML
 * in source order (` id="t1"`), and whether a designation was an ntig.
 */
export interface TbxEntryShape {
  /** The entry's attributes but `id`. */
  attributes: string;
  languages: TbxLanguageShape[];
  /** The language sections that hold no term, as items: no term carries them, so a rewrite writes them back after the rest. */
  unread?: string[];
}

export interface TbxLanguageShape {
  /** The language its term was read with. */
  language: string | undefined;
  /** Its attributes but `xml:lang`. */
  attributes: string;
  designations: TbxDesignationShape[];
}

export interface TbxDesignationShape {
  /** The designation's text, as its term reads. */
  term: string;
  /** The tig's, ntig's or termSec's attributes. */
  attributes: string;
  /** The `term` element's attributes. */
  termAttributes: string;
  /** The `termGrp`'s attributes, for an ntig. */
  group?: string;
}

/** Where one term's entry sits. Every term of an entry shares the span. */
export interface TbxEntrySource {
  document: TbxDocument;
  span: { start: number; end: number };
  shape?: TbxEntryShape;
}

/**
 * Keyed by location, which an edit of a term's record carries over
 * (`{ ...term, record }`), so an edited term still finds its source.
 */
const sources = new WeakMap<TermLocation, TbxEntrySource>();

export function rememberTbxSource(term: Term, source: TbxEntrySource): void {
  sources.set(term.location, source);
}

/** The TBX file and entry a term was read from, or `undefined` for a term read from anything else. */
export function tbxSourceOf(term: Term): TbxEntrySource | undefined {
  return sources.get(term.location);
}

// ---------------------------------------------------------------------------
// Data categories

/** The DCA element a category is spelled with: `<descrip type="definition">`. */
export type TbxElement = "descrip" | "admin" | "adminNote" | "termNote" | "ref" | "xref" | "transac" | "transacNote";

export interface TbxCategory {
  /** The data category, which is the DCA `type` and the DCT local name. */
  name: string;
  element: TbxElement;
  module: TbxModule;
}

function category(name: string, element: TbxElement, module: TbxModule): TbxCategory {
  return { name, element, module };
}

/** Every TBX-Basic and TBX-Linguist category, by name, with its element type as the module files give it. */
export const TBX_CATEGORIES = {
  definition: category("definition", "descrip", "basic"),
  subjectField: category("subjectField", "descrip", "min"),
  context: category("context", "descrip", "basic"),
  source: category("source", "admin", "basic"),
  customerSubset: category("customerSubset", "admin", "min"),
  projectSubset: category("projectSubset", "admin", "basic"),
  crossReference: category("crossReference", "ref", "basic"),
  externalCrossReference: category("externalCrossReference", "xref", "min"),
  xGraphic: category("xGraphic", "xref", "basic"),
  transactionType: category("transactionType", "transac", "basic"),
  responsibility: category("responsibility", "transacNote", "basic"),
  administrativeStatus: category("administrativeStatus", "termNote", "min"),
  partOfSpeech: category("partOfSpeech", "termNote", "min"),
  grammaticalGender: category("grammaticalGender", "termNote", "basic"),
  grammaticalNumber: category("grammaticalNumber", "termNote", "lng"),
  termType: category("termType", "termNote", "basic"),
  termLocation: category("termLocation", "termNote", "basic"),
  geographicalUsage: category("geographicalUsage", "termNote", "basic"),
  register: category("register", "termNote", "lng"),
  transferComment: category("transferComment", "termNote", "lng"),
  reading: category("reading", "admin", "lng"),
  readingNote: category("readingNote", "adminNote", "lng"),
} as const satisfies Record<string, TbxCategory>;
export type TbxCategoryName = keyof typeof TBX_CATEGORIES;

/** The text aux fields after `definition`, in canonical order. `sources` is written here only when no definition groups it. */
export const TBX_TEXT_FIELDS = [
  ["subject-field", "subjectField"],
  ["contexts", "context"],
  ["sources", "source"],
  ["customer-subsets", "customerSubset"],
  ["project-subsets", "projectSubset"],
] as const satisfies readonly (readonly [keyof TermAuxRecord, TbxCategoryName])[];

export const TBX_LINK_FIELDS = [
  ["cross-references", "crossReference"],
  ["external-cross-references", "externalCrossReference"],
  ["graphics", "xGraphic"],
] as const satisfies readonly (readonly [keyof TermAuxRecord, TbxCategoryName])[];

/** The termNotes of a designation, in canonical order. `transfer-comments` is a termNote in TBX-Linguist. */
export const TBX_TERM_NOTES = [
  ["administrative-status", "administrativeStatus"],
  ["part-of-speech", "partOfSpeech"],
  ["grammatical-gender", "grammaticalGender"],
  ["grammatical-number", "grammaticalNumber"],
  ["term-type", "termType"],
  ["term-location", "termLocation"],
  ["geographical-usage", "geographicalUsage"],
  ["register", "register"],
] as const satisfies readonly (readonly [TermDesignationField, TbxCategoryName])[];

/** `administrative-status` as the record spells it, and the TBX picklist value it stands for. */
export const TBX_STATUS_VALUES = {
  preferred: "preferredTerm-admn-sts",
  admitted: "admittedTerm-admn-sts",
  deprecated: "deprecatedTerm-admn-sts",
  superseded: "supersededTerm-admn-sts",
} as const;
export type TbxStatus = keyof typeof TBX_STATUS_VALUES;

/** The record's word for a designation with no administrative status. */
export const TBX_NO_STATUS = "none";

// ---------------------------------------------------------------------------
// Values

/** Line breaks as LF, the form every value and item is kept in. */
export function lf(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

const markupTexts = new Map<string, string | undefined>();

/** The text a piece of inline XML reads as, trimmed, or `undefined` when it does not parse. */
export function markupText(markup: string): string | undefined {
  if (markupTexts.has(markup)) return markupTexts.get(markup);
  let text: string | undefined;
  try {
    const errors: string[] = [];
    const doc = new DOMParser({
      onError: (level, message) => {
        // A DTD-declared entity reads as its literal text, as the reader reads it.
        if ((level === "error" || level === "fatalError") && !/entity not found/i.test(message)) errors.push(message);
      },
    }).parseFromString(`<x>${markup}</x>`, "text/xml");
    const root = doc.documentElement;
    text = errors.length > 0 || root === null ? undefined : lf(root.textContent ?? "").trim();
  } catch {
    text = undefined;
  }
  markupTexts.set(markup, text);
  return text;
}

/** A value as element content: the first `tbx-markup` item whose text it is, else the value escaped. */
export function valueXml(value: string, markup: readonly string[]): string {
  return markup.find((item) => markupText(item) === value) ?? escapeText(value);
}

// ---------------------------------------------------------------------------
// The serializer

interface Context {
  format: TbxFormat;
  markup: readonly string[];
}

function prefixOf(format: TbxFormat, module: TbxModule): string {
  return format.prefixes?.[module] ?? module;
}

/** One category element, in the file's style. An empty value with a target self-closes. */
function categoryXml(name: TbxCategoryName, value: string, ctx: Context, target?: string): string {
  const cat = TBX_CATEGORIES[name];
  const dct = ctx.format.style === "dct";
  const tag = dct ? `${prefixOf(ctx.format, cat.module)}:${cat.name}` : cat.element;
  const attributes = `${dct ? "" : ` type="${cat.name}"`}${target === undefined ? "" : ` target="${escapeAttribute(target)}"`}`;
  if (value === "") return `<${tag}${attributes}/>`;
  return `<${tag}${attributes}>${valueXml(value, ctx.markup)}</${tag}>`;
}

function plainXml(tag: string, value: string, ctx: Context, attributes = ""): string {
  return `<${tag}${attributes}>${valueXml(value, ctx.markup)}</${tag}>`;
}

/**
 * Each of `wanted` with the `pool` item it takes: the first unmatched one
 * `same` accepts, else, for one left over, the next unmatched one in order,
 * so a renamed designation keeps its element. `undefined` once the pool runs out.
 */
function pair<T, S>(wanted: readonly T[], pool: readonly S[], same: (w: T, s: S) => boolean): (S | undefined)[] {
  const used = new Set<number>();
  const found = wanted.map((w) => {
    const at = pool.findIndex((s, i) => !used.has(i) && same(w, s));
    if (at === -1) return undefined;
    used.add(at);
    return pool[at];
  });
  const left = pool.filter((_, i) => !used.has(i));
  return found.map((s) => s ?? left.shift());
}

function linkXml(name: TbxCategoryName, link: TermLink, ctx: Context): string {
  return categoryXml(name, link.text ?? "", ctx, link.target);
}

/** Each line of a block one level (two spaces) deeper. A multi-line item moves as a whole. */
function nest(lines: readonly string[]): string[] {
  return lines.map((line) => `  ${line.replaceAll("\n", "\n  ")}`);
}

/** A termNote's opening tag: DCA's `<termNote`, or a DCT termNote category under any prefix (`<min:partOfSpeech`). */
const TERM_NOTE_ITEM = new RegExp(
  `^<(?:termNote(?:Grp)?|[\\w.-]+:(?:${Object.values(TBX_CATEGORIES)
    .filter((cat) => cat.element === "termNote")
    .map((cat) => cat.name)
    .join("|")}))[\\s>/]`,
);

/** Whether a `tbx-elements` item is a termNote, which TBX places before a term's other children. */
export function isTermNoteItem(item: string): boolean {
  return TERM_NOTE_ITEM.test(item);
}

/** A level's aux fields, in canonical order, then its `tbx-elements`. */
function auxLines(aux: TermAuxRecord, ctx: Context, extra: readonly string[] = []): string[] {
  const lines: string[] = [];
  const grouped = aux.definition !== undefined && (aux.sources !== undefined || aux.notes !== undefined);
  if (aux.definition !== undefined) {
    const definition = categoryXml("definition", aux.definition, ctx);
    if (grouped) {
      lines.push(
        "<descripGrp>",
        ...nest([
          definition,
          ...(aux.sources ?? []).map((s) => categoryXml("source", s, ctx)),
          ...(aux.notes ?? []).map((n) => plainXml("note", n, ctx)),
        ]),
        "</descripGrp>",
      );
    } else {
      lines.push(definition);
    }
  }
  for (const [field, name] of TBX_TEXT_FIELDS) {
    if (field === "sources" && grouped) continue;
    const value = aux[field];
    for (const item of typeof value === "string" ? [value] : (value ?? [])) lines.push(categoryXml(name, item, ctx));
  }
  if (!grouped) for (const note of aux.notes ?? []) lines.push(plainXml("note", note, ctx));
  for (const [field, name] of TBX_LINK_FIELDS) {
    for (const link of aux[field] ?? []) lines.push(linkXml(name, link, ctx));
  }
  for (const transaction of aux.transactions ?? []) {
    lines.push(
      "<transacGrp>",
      ...nest([
        categoryXml("transactionType", transaction.type, ctx),
        ...(transaction.responsibility === undefined
          ? []
          : [categoryXml("responsibility", transaction.responsibility, ctx)]),
        ...(transaction.date === undefined ? [] : [plainXml("date", transaction.date, ctx)]),
      ]),
      "</transacGrp>",
    );
  }
  lines.push(...extra);
  return lines;
}

/** A designation as written: its item, and the status its label kind gives it when the item names none. */
export interface ResolvedDesignation {
  designation: TermDesignation;
  /** The record's `administrative-status`: the item's own, else the kind's. */
  status: string;
}

/**
 * Every designation of a term, in the order an entry writes them: the
 * `designations` items in their order, then each label they leave unnamed in
 * label, alt-label, hidden-label order. A label is preferred, an alt-label
 * admitted and a hidden-label deprecated unless its item says otherwise.
 */
export function resolveDesignations(record: TermRecord): ResolvedDesignation[] {
  const pool: { term: string; status: TbxStatus; used: boolean }[] = [
    { term: record.label, status: "preferred", used: false },
    ...(record["alt-labels"] ?? []).map((term) => ({ term, status: "admitted" as const, used: false })),
    ...(record["hidden-labels"] ?? []).map((term) => ({ term, status: "deprecated" as const, used: false })),
  ];
  const out: ResolvedDesignation[] = [];
  for (const designation of record.designations ?? []) {
    const slot = pool.find((entry) => !entry.used && entry.term === designation.term);
    if (slot !== undefined) slot.used = true;
    out.push({ designation, status: designation["administrative-status"] ?? slot?.status ?? "admitted" });
  }
  for (const slot of pool) if (!slot.used) out.push({ designation: { term: slot.term }, status: slot.status });
  return out;
}

/** The TBX value of a record status, or `undefined` for one that writes no element. */
export function statusValue(status: string): string | undefined {
  if (status === TBX_NO_STATUS) return undefined;
  return status in TBX_STATUS_VALUES ? TBX_STATUS_VALUES[status as TbxStatus] : status;
}

function designationLines(
  { designation, status }: ResolvedDesignation,
  ctx: Context,
  shape: TbxDesignationShape | undefined,
): string[] {
  const group = shape?.group;
  const tag = group !== undefined ? "ntig" : ctx.format.version === 3 ? "termSec" : "tig";
  const notes: string[] = [];
  for (const [field, name] of TBX_TERM_NOTES) {
    const value = field === "administrative-status" ? statusValue(status) : designation[field];
    if (value !== undefined) notes.push(categoryXml(name, value, ctx));
  }
  for (const comment of designation["transfer-comments"] ?? []) notes.push(categoryXml("transferComment", comment, ctx));
  const items = designation["tbx-elements"] ?? [];
  const reading: string[] = [];
  if (designation.reading !== undefined) {
    const admin = categoryXml("reading", designation.reading, ctx);
    if (designation["reading-note"] === undefined) reading.push(admin);
    else reading.push("<adminGrp>", ...nest([admin, categoryXml("readingNote", designation["reading-note"], ctx)]), "</adminGrp>");
  }
  const { "tbx-elements": _items, ...aux } = designation;
  const head = [plainXml("term", designation.term, ctx, shape?.termAttributes), ...notes, ...items.filter(isTermNoteItem)];
  const rest = auxLines(aux, ctx, [...reading, ...items.filter((item) => !isTermNoteItem(item))]);
  // An ntig groups its term and termNotes in a termGrp, and the rest follows it.
  const body = group === undefined ? [...head, ...rest] : [`<termGrp${group}>`, ...nest(head), "</termGrp>", ...rest];
  return [`<${tag}${shape?.attributes ?? ""}>`, ...nest(body), `</${tag}>`];
}

function languageLines(term: Term, ctx: Context, shape: TbxLanguageShape | undefined): string[] {
  const tag = ctx.format.version === 3 ? "langSec" : "langSet";
  const { record } = term;
  const aux: TermAuxRecord = {};
  for (const field of [
    "definition",
    "subject-field",
    "contexts",
    "notes",
    "sources",
    "customer-subsets",
    "project-subsets",
    "cross-references",
    "external-cross-references",
    "graphics",
    "transactions",
  ] as const) {
    const value = record[field];
    if (value !== undefined) Object.assign(aux, { [field]: value });
  }
  const designations = resolveDesignations(record);
  const shapes = pair(designations, shape?.designations ?? [], (d, s) => d.designation.term === s.term);
  return [
    `<${tag} xml:lang="${escapeAttribute(term.language ?? DEFAULT_LANGUAGE)}"${shape?.attributes ?? ""}>`,
    ...nest([
      ...auxLines(aux, ctx, record["tbx-elements"] ?? []),
      ...designations.flatMap((d, i) => designationLines(d, ctx, shapes[i])),
    ]),
    `</${tag}>`,
  ];
}

/**
 * One entry, at indentation zero: a `termEntry` (v2) or `conceptEntry` (v3)
 * with the first term's id and `concept-entry`, and one language per term.
 * Lines may hold a multi-line `tbx-elements` item; join them with `\n`.
 * Given the `shape` of the entry as read, which only a rewrite at its own
 * version passes, each language and designation paired with one as read
 * keeps that element's form; one with no pair is canonical.
 */
export function tbxEntryLines(terms: readonly Term[], format: TbxFormat, shape?: TbxEntryShape): string[] {
  const [head] = terms;
  if (head === undefined) return [];
  const tag = format.version === 3 ? "conceptEntry" : "termEntry";
  const concept = head.record["concept-entry"] ?? {};
  const { "tbx-elements": conceptItems, ...conceptAux } = concept;
  const languages = pair(terms, shape?.languages ?? [], (t, s) => t.language === s.language);
  return [
    `<${tag} id="${escapeAttribute(head.id)}"${shape?.attributes ?? ""}>`,
    ...nest([
      ...auxLines(conceptAux, { format, markup: head.record["tbx-markup"] ?? [] }, conceptItems ?? []),
      ...terms.flatMap((term, i) =>
        languageLines(term, { format, markup: term.record["tbx-markup"] ?? [] }, languages[i]),
      ),
      ...(shape?.unread ?? []),
    ]),
    `</${tag}>`,
  ];
}
