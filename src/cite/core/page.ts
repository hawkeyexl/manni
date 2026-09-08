/**
 * Read both channels of a page: `citations` from the frontmatter (via meta's
 * extractor for the format) and inline statements from the body. Validates
 * entry shape with Ajv against the bundled draft schema (`entry-invalid` /
 * `statement-invalid`), enforces unique ids and the caps (≤ 500 statements
 * per page, ≤ 5000 lines per range), and resolves reference statements to
 * their frontmatter entries so each citation carries its anchor line.
 * Page-side findings (claim-missing, claim-ambiguous, statement-orphan,
 * quote-drift needs the source, so it is left to classify) are produced here.
 */
import { extname } from "node:path";
import * as Ajv2020Ns from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import citationsSchema from "../schema/citations.json" with { type: "json" };
import {
  extractorForExtension,
  locateFrontmatter,
  supportedExtensions,
  type MetadataExtractor,
} from "../../meta/index.js";
import { extractorByName } from "../../meta/internal.js";
import { CiteError } from "../errors.js";
import type {
  Citation,
  CitationFinding,
  CitationOrigin,
  CiteRule,
  InlineStatement,
  PageCitation,
  PageCitations,
} from "../types.js";
import { findClaim, paragraphContains } from "./claims.js";
import { DEFAULT_SEVERITY, ruleId } from "./severity.js";
import {
  fencedBlockAfter,
  lineAt,
  offsetOfLine,
  parseStatements,
} from "./statements.js";

export const MAX_STATEMENTS_PER_PAGE = 500;

const COMMIT = /^[0-9a-f]{7,40}$/;

/** Formats whose leading fenced block is frontmatter meta would read. */
const ELEMENT_BACKED = new Set(["html", "xml"]);

/** Formats with a fenced-block locator (see `fencedBlockAfter`). */
const FENCE_FORMATS = new Set(["markdown", "mdx", "asciidoc"]);

export interface ReadPageOptions {
  /** Extractor name; derived from the file's extension when absent. */
  format?: string;
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

/** The page-level `citation-commit`, when present and well-formed. */
export function pageCommit(data: Record<string, unknown>): string | undefined {
  const value = data["citation-commit"];
  return typeof value === "string" && COMMIT.test(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copy a validated entry into the `Citation` shape, field by field. */
function toCitation(entry: Record<string, unknown>): Citation {
  const citation: Citation = {
    src: String(entry.src),
    integrity: String(entry.integrity),
  };
  if (typeof entry.commit === "string") citation.commit = entry.commit;
  if (typeof entry.id === "string") citation.id = entry.id;
  if (typeof entry.claim === "string") citation.claim = entry.claim;
  if (typeof entry.quote === "boolean") citation.quote = entry.quote;
  return citation;
}

type FindingExtra = Pick<CitationFinding, "line" | "id" | "src" | "index">;

function finding(rule: CiteRule, message: string, extra: FindingExtra): CitationFinding {
  const out: CitationFinding = {
    rule,
    ruleId: ruleId(rule),
    // The caller re-applies the configured severity table; `off` never
    // applies to a page-side rule's default, so it collapses to `error`.
    severity: DEFAULT_SEVERITY[rule] === "warning" ? "warning" : "error",
    message,
  };
  if (extra.line !== undefined) out.line = extra.line;
  if (extra.id !== undefined) out.id = extra.id;
  if (extra.src !== undefined) out.src = extra.src;
  if (extra.index !== undefined) out.index = extra.index;
  return out;
}

/** The `id`/`src` a finding carries for an entry that may not have validated. */
function subjectOf(entry: unknown): Pick<FindingExtra, "id" | "src"> {
  const out: Pick<FindingExtra, "id" | "src"> = {};
  if (isRecord(entry)) {
    if (typeof entry.id === "string") out.id = entry.id;
    if (typeof entry.src === "string") out.src = entry.src;
  }
  return out;
}

function pickExtractor(file: string, format: string | undefined): MetadataExtractor {
  if (format !== undefined) {
    const forced = extractorByName(format);
    if (!forced?.implemented) {
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

export function readPage(
  file: string,
  content: string,
  opts?: ReadPageOptions,
): PageCitations {
  const extractor = pickExtractor(file, opts?.format);
  const format = extractor.name;
  const extracted = extractor.extract(content, file);
  const data = extracted.data;
  const bodyOffset = ELEMENT_BACKED.has(format)
    ? 0
    : (locateFrontmatter(content)?.closeEnd ?? 0);
  const canQuote = FENCE_FORMATS.has(format);

  const findings: CitationFinding[] = [];
  const citations: PageCitation[] = [];
  /** Frontmatter entries by id, for reference resolution. */
  const byId = new Map<string, PageCitation>();
  /** Every id seen in either channel, for uniqueness. */
  const ids = new Set<string>();
  /** Frontmatter entries a reference statement has anchored, by entry, with the statement line. */
  const referenced = new Map<PageCitation, number>();

  const claimId = (citation: Citation): Pick<FindingExtra, "id" | "src"> => {
    const out: Pick<FindingExtra, "id" | "src"> = { src: citation.src };
    if (citation.id !== undefined) out.id = citation.id;
    return out;
  };

  // Frontmatter channel.
  const defaultCommit = pageCommit(data);
  if ("citation-commit" in data && defaultCommit === undefined) {
    findings.push(
      finding("entry-invalid", "citation-commit must be a git commit as 7 to 40 lowercase hex digits", {
        line: extracted.lineFor("/citation-commit"),
      }),
    );
  }
  const rawCitations = data.citations;
  if (rawCitations !== undefined && !Array.isArray(rawCitations)) {
    findings.push(
      finding("entry-invalid", "citations must be an array of entries", {
        line: extracted.lineFor("/citations"),
      }),
    );
  }
  const entries: unknown[] = Array.isArray(rawCitations) ? rawCitations : [];
  entries.forEach((entry, index) => {
    const line = extracted.lineFor(`/citations/${index}`);
    const error = validateEntry(entry);
    if (error !== undefined || !isRecord(entry)) {
      findings.push(
        finding("entry-invalid", error ?? "must be object", { line, index, ...subjectOf(entry) }),
      );
      return;
    }
    const citation = toCitation(entry);
    if (citation.commit === undefined && defaultCommit !== undefined) {
      citation.commit = defaultCommit;
    }
    const origin: CitationOrigin = { kind: "frontmatter", index };
    if (line !== undefined) origin.line = line;
    const page: PageCitation = { citation, origin };
    citations.push(page);
    if (citation.id !== undefined) {
      if (ids.has(citation.id)) {
        findings.push(
          finding("entry-invalid", `duplicate id "${citation.id}"`, { line, index, ...claimId(citation) }),
        );
      } else {
        ids.add(citation.id);
        byId.set(citation.id, page);
      }
    }
    if (citation.quote && !canQuote) {
      findings.push(
        finding(
          "statement-invalid",
          `quote: true needs a fenced block, and ${format} has no fence syntax`,
          { line, index, ...claimId(citation) },
        ),
      );
    }
  });

  // Inline channel.
  const body = content.slice(bodyOffset);
  const statements = parseStatements(body, format, {
    offset: bodyOffset,
    line: lineAt(content, bodyOffset),
  });
  if (statements.length > MAX_STATEMENTS_PER_PAGE) {
    findings.push(
      finding(
        "statement-invalid",
        `more than ${MAX_STATEMENTS_PER_PAGE} statements on one page (${statements.length}); the rest are not read`,
        { line: statements[MAX_STATEMENTS_PER_PAGE]?.line },
      ),
    );
  }

  /** Anchor a `quote: true` entry to the block after a statement, or say why not. */
  const anchorQuote = (
    statement: InlineStatement,
    origin: CitationOrigin,
    subject: Pick<FindingExtra, "id" | "src" | "index">,
  ): void => {
    if (!canQuote) {
      findings.push(
        finding(
          "statement-invalid",
          `quote: true needs a fenced block, and ${format} has no fence syntax`,
          { line: statement.line, ...subject },
        ),
      );
      return;
    }
    const block = fencedBlockAfter(content, statement.end, format);
    if (!block) {
      findings.push(
        finding("quote-drift", "quote: true, but no fenced block follows the statement", {
          line: statement.line,
          ...subject,
        }),
      );
      return;
    }
    origin.anchorLine = block.line;
  };

  /** Whether the paragraph anchored at `anchorLine` carries the claim. */
  const anchoredClaimHolds = (anchorLine: number | undefined, claim: string): boolean =>
    anchorLine !== undefined && paragraphContains(content, offsetOfLine(content, anchorLine), claim);

  for (const statement of statements.slice(0, MAX_STATEMENTS_PER_PAGE)) {
    const { payload } = statement;
    if (payload.kind === "bad") {
      findings.push(
        finding("statement-invalid", `invalid statement: ${payload.reason}`, { line: statement.line }),
      );
      continue;
    }

    if (payload.kind === "entry") {
      const error = validateEntry(payload.entry);
      if (error !== undefined || !isRecord(payload.entry)) {
        findings.push(
          finding("statement-invalid", error ?? "must be object", {
            line: statement.line,
            ...subjectOf(payload.entry),
          }),
        );
        continue;
      }
      const citation = toCitation(payload.entry);
      if (citation.commit === undefined && defaultCommit !== undefined) {
        citation.commit = defaultCommit;
      }
      const origin: CitationOrigin = { kind: "inline", line: statement.line };
      if (statement.anchorLine !== undefined) origin.anchorLine = statement.anchorLine;
      citations.push({ citation, origin });
      const subject = claimId(citation);
      if (citation.id !== undefined) {
        if (ids.has(citation.id)) {
          findings.push(
            finding("entry-invalid", `duplicate id "${citation.id}"`, { line: statement.line, ...subject }),
          );
        } else {
          ids.add(citation.id);
        }
      }
      if (citation.claim !== undefined && !anchoredClaimHolds(statement.anchorLine, citation.claim)) {
        findings.push(
          finding(
            "claim-missing",
            `the anchored paragraph does not contain the claim "${citation.claim}"`,
            { line: statement.line, ...subject },
          ),
        );
      }
      if (citation.quote) anchorQuote(statement, origin, subject);
      continue;
    }

    // A reference to a frontmatter entry.
    const target = byId.get(payload.id);
    if (!target) {
      findings.push(
        finding("statement-orphan", `no frontmatter entry has id "${payload.id}"`, {
          line: statement.line,
          id: payload.id,
        }),
      );
      continue;
    }
    const { citation, origin } = target;
    const subject: Pick<FindingExtra, "id" | "src" | "index"> = { ...claimId(citation) };
    if (origin.kind === "frontmatter") subject.index = origin.index;
    const earlier = referenced.get(target);
    if (earlier !== undefined) {
      findings.push(
        finding(
          "claim-ambiguous",
          `id "${payload.id}" is referenced by two statements (lines ${earlier}, ${statement.line})`,
          { line: origin.line, ...subject },
        ),
      );
      continue;
    }
    referenced.set(target, statement.line);
    if (statement.anchorLine !== undefined) origin.anchorLine = statement.anchorLine;
    if (citation.claim !== undefined && !anchoredClaimHolds(statement.anchorLine, citation.claim)) {
      findings.push(
        finding(
          "claim-missing",
          `the anchored paragraph does not contain the claim "${citation.claim}"`,
          { line: statement.line, ...subject },
        ),
      );
    }
    if (citation.quote) anchorQuote(statement, origin, subject);
  }

  // Frontmatter entries with a claim and no reference: find the claim.
  for (const page of citations) {
    const { citation, origin } = page;
    if (origin.kind !== "frontmatter" || referenced.has(page)) continue;
    if (citation.claim === undefined) continue;
    const subject: FindingExtra = { index: origin.index, ...claimId(citation) };
    if (origin.line !== undefined) subject.line = origin.line;
    const hits = findClaim(content, bodyOffset, citation.claim);
    const [only] = hits;
    if (hits.length === 1 && only) {
      origin.anchorLine = only.line;
    } else if (hits.length === 0) {
      findings.push(
        finding("claim-missing", `claim not found in the body: "${citation.claim}"`, subject),
      );
    } else {
      findings.push(
        finding(
          "claim-ambiguous",
          `claim found in ${hits.length} paragraphs (lines ${hits.map((h) => h.line).join(", ")}); add an id and a reference statement above the one it supports`,
          subject,
        ),
      );
    }
  }

  const page: PageCitations = {
    file,
    format,
    content,
    bodyOffset,
    citations,
    statements,
    findings: findings.sort(byLine),
  };
  if (defaultCommit !== undefined) page.commit = defaultCommit;
  return page;
}
