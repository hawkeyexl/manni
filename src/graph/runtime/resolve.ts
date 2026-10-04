/**
 * Content resolution (ADR 01018): graph node → the text it stands for.
 *
 * The graph is an index over documents ([ADR 01008](../../adrs/01008-graph-as-index-not-corpus.md)),
 * so retrieval must go back to the source to get text. The seam is a
 * `ContentResolver`; the shipped implementation uses `fetch`, which works
 * unchanged in browsers and in Node ≥18, and is injectable for tests.
 *
 * Section nodes (`doc.md#slug`) resolve by fetching the parent document and
 * slicing it at the heading whose text matches the section's `dcterms:title`
 * — so no line-span predicates need to be added to the graph.
 *
 * Platform-neutral: no `node:` imports, no npm dependencies.
 */
import { NS } from "../core/vocab.js";
import type { GraphIndex } from "./graph.js";
import type { QueryTrace } from "./trace.js";

const GRAPH_PATH = `${NS.graph}path`;
const DCTERMS_TITLE = `${NS.dcterms}title`;
const DCTERMS_HAS_PART = `${NS.dcterms}hasPart`;
const GRAPH_LEVEL = `${NS.graph}level`;
const GRAPH_ORDER = `${NS.graph}order`;

export interface ResolvedContent {
  iri: string;
  text: string;
  sourceUrl: string;
  title?: string;
}

export interface ContentResolver {
  /** Text for a node, or undefined when the node has no content. */
  resolve(iri: string): Promise<ResolvedContent | undefined>;
}

type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface FetchResolverOptions {
  /** Prefix joined to each `graph:path`, e.g. "https://site/raw/". */
  baseUrl?: string;
  /** Full control over path → URL. Overrides `baseUrl`. */
  pathToUrl?: (path: string) => string;
  /** Injectable fetch (defaults to the global). */
  fetch?: FetchLike;
  /** Record resolutions here. */
  trace?: QueryTrace;
}

/** Split a section IRI into its document IRI and fragment. */
export function splitFragment(iri: string): { doc: string; fragment?: string } {
  const hash = iri.indexOf("#");
  return hash < 0
    ? { doc: iri }
    : { doc: iri.slice(0, hash), fragment: iri.slice(hash + 1) };
}

/**
 * Mark every line that sits inside a fenced code block (including the fence
 * delimiters themselves). Without this, a shell comment in a code sample —
 * `# Set the API key` — reads as an h1 and truncates the surrounding section,
 * which silently drops most of the retrieved content.
 *
 * CommonMark rules, minus the ones a heading scan cannot observe: a fence opens
 * on 3+ backticks or tildes indented at most 3 spaces, a backtick fence's info
 * string may not contain a backtick, and it closes on a delimiter of the same
 * character that is at least as long and carries no info string. An unclosed
 * fence runs to end of document.
 */
function fencedLines(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let open: string | undefined;
  for (const [i, line] of lines.entries()) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // Both groups are mandatory in the pattern, so a match carries both.
    // Requiring them is the check that proves it, and it replaces the bare
    // `m &&` the branches already tested — no condition is added, only
    // sharpened.
    const delimiter = m?.[1];
    const info = m?.[2];
    const isFence = delimiter !== undefined && info !== undefined;
    if (open === undefined) {
      if (isFence && !(delimiter.startsWith("`") && info.includes("`"))) {
        open = delimiter;
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (
      isFence &&
      delimiter[0] === open[0] &&
      delimiter.length >= open.length &&
      info.trim() === ""
    ) {
      open = undefined;
    }
  }
  return mask;
}

/** One heading as the source spells it, located by the line it starts on. */
interface SourceHeading {
  /** First line: the `#` line, or a setext heading's first line of text. */
  start: number;
  level: number;
  /** The heading's raw inline text, markdown and all. */
  text: string;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;

/**
 * Whether a line can be paragraph text, which a setext underline turns into a
 * heading. A blank line, an ATX heading, a list item, a block quote, a
 * thematic break and indented code cannot.
 */
function isParagraphLine(line: string): boolean {
  if (line.trim() === "") return false;
  if (ATX.test(line)) return false;
  if (/^ {0,3}([-+*]|\d{1,9}[.)])([ \t]|$)/.test(line)) return false;
  if (/^ {0,3}>/.test(line)) return false;
  if (/^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) return false;
  return !/^ {4}/.test(line);
}

/**
 * How many leading lines a YAML frontmatter block takes, delimiters included.
 * Its closing `---` follows a line of text, so without this the scan would
 * read the last frontmatter key as a setext heading.
 */
function frontmatterLength(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (line === "---" || line === "...") return i + 1;
  }
  return 0;
}

/**
 * Every heading in a markdown source, in order. ATX headings may sit up to
 * three spaces in and lose any closing `#` run. Setext headings are
 * underlined with `=` or `-`. Fenced code and frontmatter hold none.
 *
 * Line-based, so a shape remark reads and this does not is possible. The
 * common ones are covered, and a miss leaves one section unindexed.
 */
function sourceHeadings(lines: string[]): SourceHeading[] {
  const fenced = fencedLines(lines);
  const skip = frontmatterLength(lines);
  const headings: SourceHeading[] = [];
  /** First line of the paragraph the scan is inside, or -1. */
  let paragraph = -1;
  for (const [i, line] of lines.entries()) {
    if (i < skip || fenced[i]) {
      paragraph = -1;
      continue;
    }
    const atx = ATX.exec(line);
    const hashes = atx?.[1];
    if (hashes !== undefined) {
      // A closing run is `#`s after whitespace, or the whole content.
      const text = (atx?.[2] ?? "").replace(/(^|[ \t]+)#+$/, "");
      headings.push({ start: i, level: hashes.length, text });
      paragraph = -1;
      continue;
    }
    const underline = SETEXT_UNDERLINE.exec(line)?.[1];
    if (underline !== undefined && paragraph >= 0) {
      headings.push({
        start: paragraph,
        level: underline.startsWith("=") ? 1 : 2,
        text: lines.slice(paragraph, i).join("\n"),
      });
      paragraph = -1;
      continue;
    }
    if (isParagraphLine(line)) {
      if (paragraph < 0) paragraph = i;
    } else {
      paragraph = -1;
    }
  }
  return headings;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the character references a heading is likely to carry. */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (whole, name: string) => {
      if (name.startsWith("#")) {
        const hex = name[1] === "x" || name[1] === "X";
        const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isNaN(code) || code > 0x10ffff
          ? whole
          : String.fromCodePoint(code);
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    },
  );
}

/**
 * The key a heading is matched by, from either side. One side is the
 * plain-text title the build recorded, the other the source text after
 * `stripInline`. Markup characters go, whitespace collapses, and case folds.
 * Both sides pass through it, so a character it drops cannot make them differ.
 */
export function headingKey(text: string): string {
  return text
    .replace(/[`*_~\\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Raw heading source to the text remark reads from it. Links and images keep
 * their text, autolinks their target, and character references decode.
 */
function stripInline(raw: string): string {
  return decodeEntities(
    raw
      .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
      .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/<((?:https?|mailto):[^>\s]+)>/gi, "$1"),
  );
}

/**
 * Sections of a document in true document order, reconstructed from the
 * `dcterms:hasPart` tree ordered by `graph:order` within each parent.
 *
 * Needed because heading text is not unique: a document with two `## Install`
 * headings produces two section nodes, and matching by title alone would give
 * both the *first* heading's text — wrong content under a confident citation.
 */
export function documentSectionOrder(
  graph: GraphIndex,
  docIri: string,
): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const childrenOf = (iri: string): string[] =>
    graph
      .out(iri, DCTERMS_HAS_PART)
      .map((e) => e.target)
      .sort((a, b) => {
        const oa = Number.parseInt(graph.literal(a, GRAPH_ORDER) ?? "", 10);
        const ob = Number.parseInt(graph.literal(b, GRAPH_ORDER) ?? "", 10);
        if (Number.isNaN(oa) || Number.isNaN(ob) || oa === ob) {
          return a < b ? -1 : a > b ? 1 : 0;
        }
        return oa - ob;
      });

  const walk = (iri: string): void => {
    for (const child of childrenOf(iri)) {
      if (seen.has(child)) continue;
      seen.add(child);
      ordered.push(child);
      walk(child);
    }
  };
  walk(docIri);
  return ordered;
}

/**
 * Occurrence number of every section of a document, in one walk: section IRI →
 * how many earlier sections share its heading text and level.
 *
 * Batched because the per-section form is quadratic — a document with N
 * sections would otherwise rebuild the whole `hasPart` order N times, once per
 * section indexed or resolved.
 */
export function sectionOccurrences(
  graph: GraphIndex,
  docIri: string,
): Map<string, number> {
  const occurrences = new Map<string, number>();
  // title → level → how many carrying that pair have been seen so far. Nested
  // rather than a joined key, so no separator has to be safe in either field.
  const counts = new Map<string, Map<string, number>>();

  for (const section of documentSectionOrder(graph, docIri)) {
    const rawTitle = graph.literal(section, DCTERMS_TITLE);
    if (rawTitle === undefined) {
      occurrences.set(section, 0);
      continue;
    }
    // Keyed exactly the way `sliceSection` matches headings, by `headingKey`.
    // Keyed by the raw title instead, a document with `## Install`
    // and `## install` gives both sections occurrence 0, and the second one
    // then slices the first heading: wrong content under a confident citation.
    const title = headingKey(rawTitle);
    const level = graph.literal(section, GRAPH_LEVEL) ?? "";
    let byLevel = counts.get(title);
    if (!byLevel) {
      byLevel = new Map();
      counts.set(title, byLevel);
    }
    const seen = byLevel.get(level) ?? 0;
    occurrences.set(section, seen);
    byLevel.set(level, seen + 1);
  }
  return occurrences;
}

/**
 * Which occurrence of its heading text a section is (0-based) — the number of
 * earlier same-title, same-level sections in the same document. A section the
 * `hasPart` tree does not reach counts as the first (0).
 */
export function sectionOccurrence(
  graph: GraphIndex,
  sectionIri: string,
): number {
  const { doc } = splitFragment(sectionIri);
  return sectionOccurrences(graph, doc).get(sectionIri) ?? 0;
}

/**
 * The prose before a document's first heading — the text that belongs to no
 * section, and so would otherwise be indexed nowhere in a document that has
 * sections.
 *
 * Fence-aware for the same reason `sliceSection` is: a `#` comment inside a
 * leading code block is not a heading, and treating it as one would cut the
 * preamble short. Frontmatter is *not* stripped here — the caller decides,
 * since only the search index cares about that.
 */
export function documentPreamble(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const end = sourceHeadings(lines)[0]?.start ?? lines.length;
  const text = lines.slice(0, end).join("\n").trim();
  return text === "" ? undefined : text;
}

/**
 * Slice a markdown document at the heading whose text matches `title`,
 * returning that heading through to the next heading of the same or higher
 * rank. Returns undefined when no such heading exists. Handles CRLF, and
 * ignores `#` lines inside fenced code blocks.
 *
 * `occurrence` selects among repeated headings (0 = the first). Heading text is
 * not unique, so callers with a specific section node in hand should pass
 * `sectionOccurrence(graph, iri)` rather than defaulting to the first match.
 */
export function sliceSection(
  markdown: string,
  title: string,
  level?: number,
  occurrence = 0,
): string | undefined {
  return slice(markdown, title, level, occurrence, false);
}

/**
 * The text a section *owns*: its heading down to the next heading of **any**
 * rank, so nested subsections are excluded.
 *
 * `sliceSection` keeps the subtree because that is what retrieval wants — ask
 * for "Configuration" and you should get its subsections too. Indexing wants
 * the opposite: with the subtree, a parent section matches everything its
 * children match and outranks them, so an H1 section shadows every heading
 * beneath it. Same granularity rule as Document vs Section, one level down.
 */
export function sectionOwnText(
  markdown: string,
  title: string,
  level?: number,
  occurrence = 0,
): string | undefined {
  return slice(markdown, title, level, occurrence, true);
}

function slice(
  markdown: string,
  title: string,
  level: number | undefined,
  occurrence: number,
  ownTextOnly: boolean,
): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const headings = sourceHeadings(lines);
  const wanted = headingKey(title);
  let remaining = occurrence;
  let found = -1;

  for (const [n, heading] of headings.entries()) {
    if (level !== undefined && heading.level !== level) continue;
    if (headingKey(stripInline(heading.text)) !== wanted) continue;
    if (remaining > 0) {
      remaining -= 1;
      continue;
    }
    found = n;
    break;
  }
  const match = headings[found];
  if (match === undefined) return undefined;

  const next = headings
    .slice(found + 1)
    .find((h) => ownTextOnly || h.level <= match.level);
  const end = next?.start ?? lines.length;
  return lines.slice(match.start, end).join("\n").trimEnd();
}

/**
 * A resolver that fetches document sources over HTTP. Documents map through
 * `graph:path`; sections slice their parent document by heading.
 */
export function createFetchResolver(
  graph: GraphIndex,
  options: FetchResolverOptions = {},
): ContentResolver {
  const doFetch: FetchLike =
    options.fetch ?? ((url: string) => globalThis.fetch(url));
  const toUrl =
    options.pathToUrl ?? ((path: string) => `${options.baseUrl ?? ""}${path}`);
  const cache = new Map<string, Promise<string | undefined>>();
  // `assemble` resolves many sections of the same document; the occurrence walk
  // is per-document, so compute it once and reuse it.
  const occurrenceCache = new Map<string, Map<string, number>>();

  const occurrenceOf = (docIri: string, sectionIri: string): number => {
    let map = occurrenceCache.get(docIri);
    if (!map) {
      map = sectionOccurrences(graph, docIri);
      occurrenceCache.set(docIri, map);
    }
    return map.get(sectionIri) ?? 0;
  };

  const fetchDoc = (url: string): Promise<string | undefined> => {
    let pending = cache.get(url);
    if (!pending) {
      pending = doFetch(url)
        .then((r) => (r.ok ? r.text() : undefined))
        .catch(() => undefined);
      cache.set(url, pending);
    }
    return pending;
  };

  return {
    async resolve(iri: string): Promise<ResolvedContent | undefined> {
      const { doc, fragment } = splitFragment(iri);
      const path = graph.literal(doc, GRAPH_PATH);
      if (!path) return undefined;

      const sourceUrl = toUrl(path);
      const body = await fetchDoc(sourceUrl);
      const title = graph.literal(iri, DCTERMS_TITLE);

      if (body === undefined) {
        options.trace?.resolutions.push({
          iri,
          sourceUrl,
          ok: false,
          error: "fetch failed",
        });
        return undefined;
      }

      let text = body;
      if (fragment) {
        const levelText = graph.literal(iri, GRAPH_LEVEL);
        const level = levelText ? Number.parseInt(levelText, 10) : undefined;
        const slice =
          title === undefined
            ? undefined
            : sliceSection(
                body,
                title,
                Number.isNaN(level) ? undefined : level,
                occurrenceOf(doc, iri),
              );
        if (slice === undefined) {
          options.trace?.resolutions.push({
            iri,
            sourceUrl,
            ok: false,
            error: "section heading not found",
          });
          return undefined;
        }
        text = slice;
      }

      options.trace?.resolutions.push({ iri, sourceUrl, ok: true });
      return { iri, text, sourceUrl, title };
    },
  };
}
