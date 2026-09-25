/**
 * Read a page's citations and its markers.
 *
 * Entries come from the frontmatter (via meta's extractor for the format), or
 * from `CheckPageOptions.citations` when a manifest owns them; either way each
 * one is validated against the bundled draft schema and carries where it sits.
 * Markers are `cite <id> [<id>…]` comments in the body, resolved to the
 * entries they name, so each citation knows what anchors it. Every id one
 * marker names anchors the same text, so every claim under it pins the same
 * bytes and holds the same hash (proposal 0056).
 *
 * The findings made here are the ones that need no source: `entry-invalid`,
 * `marker-invalid`, `marker-orphan`, `marker-repeated` and `anchor-invalid`.
 */
import { extname } from "node:path";
import * as Ajv2020Ns from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import citationsSchema from "../../meta/schemas/citations/1.0.0.json" with { type: "json" };
import {
  extractorForExtension,
  locateFrontmatter,
  supportedExtensions,
  type ExtractedMetadata,
  type MetadataExtractor,
} from "../../meta/index.js";
import { extractorByName, hasFrontmatterFence } from "../../meta/internal.js";
import { isEncryptedValue } from "../../shared/encryption.js";
import { CiteError } from "../errors.js";
import type {
  Citation,
  CitationFinding,
  CitationInput,
  CitationOrigin,
  CiteRule,
  PageCitation,
  PageCitations,
} from "../types.js";
import { isKeyedPin } from "./hash.js";
import { parseLines, spellSource, tooWide } from "./range.js";
import { DEFAULT_SEVERITY, ruleId } from "./severity.js";
import { lineAt, parseStatements } from "./statements.js";

export { MAX_IDS_PER_MARKER } from "./statements.js";

export const MAX_MARKERS_PER_PAGE = 500;

/** Formats whose leading fenced block is frontmatter meta would read. */
const ELEMENT_BACKED = new Set(["html", "xml"]);
/** Formats whose only metadata channel is a fenced block. */
const FENCE_ONLY = new Set(["markdown", "mdx"]);

/** What a marker with a JSON payload is told, since an entry never lives in the body. */
export const MARKER_JSON =
  "A marker names an entry by id. Write the entry in frontmatter or the sidecar.";

export interface ReadPageOptions {
  /** Extractor name; derived from the file's extension when absent. */
  format?: string;
  /**
   * The page's citations as a manifest owns them, already merged. Given, the
   * page's own frontmatter `citations` is not read.
   */
  citations?: readonly CitationInput[];
  /**
   * The manifest that owns this page's `citations`, when one does. A page
   * that also carries its own is `entry-invalid`: neither channel wins, and
   * the discarded value would be exactly the one nobody checked.
   */
  owned?: { file: string; collection: string };
}

/** Meta's `external:owned` sentence, said by `cite check` under `entry-invalid`. */
export function ownedMessage(owner: { file: string; collection: string }): string {
  return `"citations" is owned by manifest ${owner.file} (collection ${owner.collection}); remove it from the document`;
}

// ajv is CommonJS with a default export; under NodeNext the constructor lives
// on `.default`, as src/meta/core/validator.ts notes.
type AjvCtor = typeof import("ajv/dist/2020.js").default;
const Ajv2020 = Ajv2020Ns.default as unknown as AjvCtor;

let entryValidator: ValidateFunction | undefined;

function compileEntryValidator(): ValidateFunction {
  if (entryValidator) return entryValidator;
  const ajv = new Ajv2020({ allErrors: false, strict: false });
  ajv.addSchema(citationsSchema);
  entryValidator = ajv.compile({
    $ref: `${citationsSchema.$id}#/$defs/citationEntry`,
  });
  return entryValidator;
}

/** Ajv validation of one entry object against `$defs.citationEntry`; the first error text, or undefined. */
export function validateEntry(entry: unknown): string | undefined {
  const validate = compileEntryValidator();
  if (validate(entry)) return undefined;
  const first = validate.errors?.[0];
  if (!first) return "invalid entry";
  return `${first.instancePath} ${first.message ?? "is invalid"}`.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copy a validated entry into the `Citation` shape, field by field. */
function toCitation(entry: Record<string, unknown>): Citation {
  const source = isRecord(entry.source) ? entry.source : {};
  const citation: Citation = {
    source: {
      file: String(source.file),
      integrity: String(source.integrity),
    },
  };
  if (typeof source.lines === "number" || typeof source.lines === "string") {
    citation.source.lines = source.lines;
  }
  if (typeof source["commit-sha"] === "string") {
    citation.source["commit-sha"] = source["commit-sha"];
  }
  if (typeof entry.id === "string") citation.id = entry.id;
  if (isRecord(entry.claim)) {
    const claim = entry.claim;
    citation.claim = { integrity: String(claim.integrity) };
    if (typeof claim.lines === "number" || typeof claim.lines === "string") {
      citation.claim.lines = claim.lines;
    }
  }
  if (typeof entry.quote === "boolean") citation.quote = entry.quote;
  return citation;
}

type FindingExtra = Pick<CitationFinding, "line" | "id" | "src" | "index" | "file">;

function finding(rule: CiteRule, message: string, extra: FindingExtra): CitationFinding {
  const level = DEFAULT_SEVERITY[rule];
  const out: CitationFinding = {
    rule,
    ruleId: ruleId(rule),
    // The caller re-applies the configured severity table; no page-side rule
    // defaults to `off`, so there is nothing to collapse.
    severity: level === "off" ? "error" : level,
    message,
  };
  if (extra.line !== undefined) out.line = extra.line;
  if (extra.file !== undefined) out.file = extra.file;
  if (extra.id !== undefined) out.id = extra.id;
  if (extra.src !== undefined) out.src = extra.src;
  if (extra.index !== undefined) out.index = extra.index;
  return out;
}

/** `<id>: <text>`, or the text alone for an entry with no id. */
function named(id: string | undefined, text: string): string {
  return id === undefined ? text : `${id}: ${text}`;
}

/** The `id`/`src` a finding carries for an entry that may not have validated. */
function subjectOf(entry: unknown): Pick<FindingExtra, "id" | "src"> {
  const out: Pick<FindingExtra, "id" | "src"> = {};
  if (!isRecord(entry)) return out;
  if (typeof entry.id === "string") out.id = entry.id;
  if (isRecord(entry.source) && typeof entry.source.file === "string") out.src = entry.source.file;
  return out;
}

export function pickExtractor(file: string, format: string | undefined): MetadataExtractor {
  if (format !== undefined) {
    const forced = extractorByName(format);
    if (forced === undefined) {
      throw new CiteError(
        `Unknown format "${format}". Supported extensions: ${supportedExtensions().join(", ")}.`,
      );
    }
    return forced;
  }
  const extension = extname(file);
  const byExt = extractorForExtension(extension);
  if (!byExt) {
    throw new CiteError(
      `Unsupported file type "${extension}" for "${file}". Supported: ${supportedExtensions().join(", ")}. Use --as to override.`,
    );
  }
  return byExt;
}

function byLine(a: CitationFinding, b: CitationFinding): number {
  return (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
}

/** File line of body line 1: the first line after the frontmatter, or 1. */
export function bodyLineOf(content: string, bodyOffset: number): number {
  if (bodyOffset <= 0) return 1;
  const line = lineAt(content, bodyOffset);
  // A page that ends at the closing fence with no newline leaves the body
  // starting on the line after the one the offset sits at the end of.
  return content.charCodeAt(bodyOffset - 1) === 10 ? line : line + 1;
}

/**
 * A page's citation entries as they are written, each with where it sits: the
 * manifest's when one owns them, else the page's own frontmatter. The entries
 * are raw, so one the schema refuses is still in the list at its own index,
 * which is how `remove` reaches an entry `check` can only report.
 */
export function citationInputs(
  file: string,
  extracted: ExtractedMetadata,
  injected?: readonly CitationInput[],
): CitationInput[] {
  if (injected !== undefined) return [...injected];
  const raw: unknown = extracted.data.citations;
  const list: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : [];
  return list.map((entry, index) => {
    const origin: CitationInput["origin"] = { kind: "frontmatter", file };
    const line = extracted.lineFor(`/citations/${String(index)}`);
    if (line !== undefined) origin.line = line;
    return { entry, origin };
  });
}

export function readPage(
  file: string,
  content: string,
  opts?: ReadPageOptions,
): PageCitations {
  const extractor = pickExtractor(file, opts?.format);
  const format = extractor.name;
  // An opening fence with no close is not a block, so the extractor reads no
  // metadata and every entry the page carries would silently vanish. rst and
  // asciidoc read a stray fence as body on purpose, ahead of their native
  // headers; the fence-only formats have no such reading.
  if (FENCE_ONLY.has(format) && hasFrontmatterFence(content) && locateFrontmatter(content) === null) {
    throw new CiteError(
      `${file}: Unterminated front matter fence: the opening fence has no matching close, so the page's citations cannot be read. Add a closing fence.`,
    );
  }
  const extracted = extractor.extract(content, file);
  const data = extracted.data;
  const bodyOffset = ELEMENT_BACKED.has(format)
    ? 0
    : (locateFrontmatter(content)?.closeEnd ?? 0);
  const bodyLine = bodyLineOf(content, bodyOffset);

  const findings: CitationFinding[] = [];
  const citations: PageCitation[] = [];
  /** Entries by id, for marker resolution. */
  const byId = new Map<string, PageCitation>();
  /** Every id seen, for uniqueness. */
  const ids = new Set<string>();
  /** The first marker naming an entry, by entry. */
  const markedAt = new Map<PageCitation, number>();

  // The page root reserves the whole `citation-` prefix, so a typo fails
  // loudly rather than passing as a key of somebody else's.
  for (const key of Object.keys(data)) {
    if (!key.startsWith("citation-")) continue;
    findings.push(
      finding(
        "entry-invalid",
        `"${key}" is not a citations key; the page root reserves the citation- prefix`,
        { line: extracted.lineFor(`/${key}`) },
      ),
    );
  }

  const injected = opts?.citations;
  const rawCitations = data.citations;
  // The page carries a key a manifest owns (0020 across files). The page's
  // own entries are still read and checked, so the report shows what the
  // page would publish; the finding says the manifest is the one authority.
  if (opts?.owned !== undefined && rawCitations !== undefined) {
    findings.push(
      finding("entry-invalid", ownedMessage(opts.owned), {
        line: extracted.lineFor("/citations"),
      }),
    );
  }
  if (injected === undefined && rawCitations !== undefined && !Array.isArray(rawCitations)) {
    findings.push(
      finding("entry-invalid", "citations must be an array of entries", {
        line: extracted.lineFor("/citations"),
      }),
    );
  }
  const inputs = citationInputs(file, extracted, injected);

  inputs.forEach((input, index) => {
    const origin: CitationOrigin = { ...input.origin, index };
    /** Where a finding about the entry itself sits: the entry's own line, in its own file. */
    const where: FindingExtra = { index };
    if (origin.line !== undefined) where.line = origin.line;
    if (origin.kind === "manifest") where.file = origin.file;

    const entry = input.entry;
    const error = validateEntry(entry);
    if (error !== undefined || !isRecord(entry)) {
      findings.push(finding("entry-invalid", error ?? "must be object", { ...where, ...subjectOf(entry) }));
      return;
    }
    const citation = toCitation(entry);
    const subject: FindingExtra = { ...where, src: spellSource(citation.source) };
    if (citation.id !== undefined) subject.id = citation.id;

    // A range that ends before it starts: the schema cannot compare two
    // numbers, so the rule is kept here.
    const bad = (["claim", "source"] as const).find((end) => {
      const lines = end === "claim" ? citation.claim?.lines : citation.source.lines;
      return lines !== undefined && parseLines(lines) === undefined;
    });
    if (bad !== undefined) {
      const lines = bad === "claim" ? citation.claim?.lines : citation.source.lines;
      findings.push(
        finding(
          "entry-invalid",
          named(citation.id, `${bad}.lines "${String(lines)}" ends before it starts`),
          subject,
        ),
      );
      return;
    }

    // A range wider than the cap is refused at either end (proposal 0044).
    const wide = (["claim", "source"] as const)
      .map((end) => {
        const lines = end === "claim" ? citation.claim?.lines : citation.source.lines;
        const parsed = lines === undefined ? undefined : parseLines(lines);
        const reason = parsed === undefined ? undefined : tooWide(parsed);
        return reason === undefined ? undefined : `${end}.lines "${String(lines)}" ${reason}`;
      })
      .find((message) => message !== undefined);
    if (wide !== undefined) {
      findings.push(finding("entry-invalid", named(citation.id, wide), subject));
      return;
    }

    // The pin's prefix says how it was taken, and only an encrypted source
    // carries a keyed one.
    const encrypted = isEncryptedValue(citation.source.file);
    if (encrypted !== isKeyedPin(citation.source.integrity)) {
      findings.push(
        finding(
          "entry-invalid",
          named(
            citation.id,
            encrypted
              ? "an encrypted source is pinned with hmac-sha256-, not sha256-."
              : "a plain source is pinned with sha256-, not hmac-sha256-.",
          ),
          subject,
        ),
      );
      return;
    }

    const page: PageCitation = { citation, origin };
    citations.push(page);
    if (citation.id !== undefined) {
      if (ids.has(citation.id)) {
        findings.push(finding("entry-invalid", `duplicate id "${citation.id}"`, subject));
      } else {
        ids.add(citation.id);
        byId.set(citation.id, page);
      }
    }
  });

  // Markers.
  const body = content.slice(bodyOffset);
  const statements = parseStatements(body, format, {
    offset: bodyOffset,
    line: bodyLine,
  });
  if (statements.length > MAX_MARKERS_PER_PAGE) {
    findings.push(
      finding(
        "marker-invalid",
        `more than ${String(MAX_MARKERS_PER_PAGE)} markers on one page (${String(statements.length)}); the rest are not read`,
        { line: statements[MAX_MARKERS_PER_PAGE]?.line },
      ),
    );
  }

  for (const statement of statements.slice(0, MAX_MARKERS_PER_PAGE)) {
    const { payload } = statement;
    if (payload.kind === "bad") {
      findings.push(
        finding(
          "marker-invalid",
          payload.json === true ? MARKER_JSON : `invalid marker: ${payload.reason}`,
          { line: statement.line },
        ),
      );
      continue;
    }
    // Each named id reports on its own: an orphan is a well-formed id with a
    // missing entry, so each one is its own subject and its own fix. A
    // malformed marker is one line and one fix, and was handled above.
    // The entries this marker actually anchors. An id the marker repeats is
    // reported and left to the marker that won it, so it never lands here.
    const anchored: PageCitation[] = [];
    for (const id of payload.ids) {
      const target = byId.get(id);
      if (target === undefined) {
        findings.push(
          finding("marker-orphan", `no entry has id "${id}"`, {
            line: statement.line,
            id,
          }),
        );
        continue;
      }
      const first = markedAt.get(target);
      if (first !== undefined) {
        findings.push(
          finding(
            "marker-repeated",
            `${id} is named by markers at lines ${String(first)} and ${String(statement.line)}; the first anchors it.`,
            {
              line: statement.line,
              id,
              index: target.origin.index,
              src: spellSource(target.citation.source),
            },
          ),
        );
        continue;
      }
      markedAt.set(target, statement.line);
      target.marker = statement;
      anchored.push(target);
    }
    // A quote entry anchors the next fenced block and a plain one anchors the
    // paragraph, so a list that mixes them would mean two spans on one line,
    // and the page would not say which id got which.
    const quoted = anchored.find((entry) => entry.citation.quote === true);
    const plain = anchored.find((entry) => entry.citation.quote !== true);
    if (quoted !== undefined && plain !== undefined) {
      const mixed: FindingExtra = {
        line: statement.line,
        index: quoted.origin.index,
        src: spellSource(quoted.citation.source),
      };
      if (quoted.citation.id !== undefined) mixed.id = quoted.citation.id;
      findings.push(
        finding(
          "anchor-invalid",
          named(
            quoted.citation.id,
            "a quote entry shares a marker with a non-quote entry. Give the quote its own marker.",
          ),
          mixed,
        ),
      );
    }
  }

  // Anchors: exactly one way in, and a quote needs one of them.
  for (const entry of citations) {
    const { citation, origin, marker } = entry;
    const subject: FindingExtra = { index: origin.index, src: spellSource(citation.source) };
    if (citation.id !== undefined) subject.id = citation.id;
    if (origin.line !== undefined) subject.line = origin.line;
    if (origin.kind === "manifest") subject.file = origin.file;

    if (citation.claim?.lines !== undefined && marker !== undefined) {
      // A marker names an id, so an entry with both always has one. The
      // finding sits on the marker, which is the half a reader can see.
      const onPage: FindingExtra = { index: origin.index, line: marker.line, src: subject.src };
      if (citation.id !== undefined) onPage.id = citation.id;
      findings.push(
        finding(
          "anchor-invalid",
          `${citation.id ?? "the entry"} has claim lines and a marker. Keep one.`,
          onPage,
        ),
      );
      continue;
    }
    if (citation.quote === true && citation.claim?.lines === undefined && marker === undefined) {
      findings.push(
        finding("anchor-invalid", named(citation.id, "quote needs a claim or a marker."), subject),
      );
    }
  }

  return {
    file,
    format,
    content,
    bodyOffset,
    bodyLine,
    citations,
    statements,
    findings: findings.sort(byLine),
  };
}
