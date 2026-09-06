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

const DOCKG_PATH = `${NS.dockg}path`;
const DCTERMS_TITLE = `${NS.dcterms}title`;
const DCTERMS_HAS_PART = `${NS.dcterms}hasPart`;
const DOCKG_LEVEL = `${NS.dockg}level`;
const DOCKG_ORDER = `${NS.dockg}order`;

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
  /** Prefix joined to each `dockg:path`, e.g. "https://site/raw/". */
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
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (open === undefined) {
      if (m && !(m[1]!.startsWith("`") && m[2]!.includes("`"))) {
        open = m[1]!;
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (
      m &&
      m[1]![0] === open[0] &&
      m[1]!.length >= open.length &&
      m[2]!.trim() === ""
    ) {
      open = undefined;
    }
  }
  return mask;
}

/**
 * Sections of a document in true document order, reconstructed from the
 * `dcterms:hasPart` tree ordered by `dockg:order` within each parent.
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
        const oa = Number.parseInt(graph.literal(a, DOCKG_ORDER) ?? "", 10);
        const ob = Number.parseInt(graph.literal(b, DOCKG_ORDER) ?? "", 10);
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
    // Keyed exactly the way `sliceSection` matches headings — trimmed and
    // case-folded. Keyed by the raw title instead, a document with `## Install`
    // and `## install` gives both sections occurrence 0, and the second one
    // then slices the first heading: wrong content under a confident citation.
    const title = rawTitle.trim().toLowerCase();
    const level = graph.literal(section, DOCKG_LEVEL) ?? "";
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
  const fenced = fencedLines(lines);
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    if (/^#{1,6}\s+/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
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
  const fenced = fencedLines(lines);
  const wanted = title.trim().toLowerCase();
  let start = -1;
  let startLevel = level ?? 0;
  let remaining = occurrence;

  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const hLevel = m[1]!.length;
    if (m[2]!.trim().toLowerCase() !== wanted) continue;
    if (level !== undefined && hLevel !== level) continue;
    if (remaining > 0) {
      remaining -= 1;
      continue;
    }
    start = i;
    startLevel = hLevel;
    break;
  }
  if (start < 0) return undefined;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (fenced[i]) continue;
    const m = /^(#{1,6})\s+/.exec(lines[i]!);
    if (m && (ownTextOnly || m[1]!.length <= startLevel)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

/**
 * A resolver that fetches document sources over HTTP. Documents map through
 * `dockg:path`; sections slice their parent document by heading.
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
      const path = graph.literal(doc, DOCKG_PATH);
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
        const levelText = graph.literal(iri, DOCKG_LEVEL);
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
