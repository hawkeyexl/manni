/** Shared types for manni graph. */
import { ToolError } from "../shared/errors.js";
import type { DocFormat } from "./core/analyze.js";
import type { RefusalReason } from "./runtime/assemble.js";

/**
 * Operational error: expected failure reported to the user, exit code 2.
 *
 * `refusal` marks a usage error that a served host answers instead of failing
 * on: `graph serve` returns it as a refusal with the CLI's text (proposal 0090).
 */
export class GraphError extends ToolError {
  constructor(
    message: string,
    readonly refusal?: RefusalReason,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

/** A heading-derived section within a document. */
export interface Section {
  /** GitHub-style slug, disambiguated (`install`, `install-1`, ...). */
  slug: string;
  /** Heading text. */
  title: string;
  /** Heading level, 1-6. */
  level: number;
  /** 1-based position among siblings under the same parent. */
  order: number;
  /** Slug of the enclosing section, or null when the parent is the document. */
  parentSlug: string | null;
  /** File line of the heading's title, or null when the parser gives none. */
  line: number | null;
}

/**
 * An inline `meta` statement (proposal 0099), as `manni meta validate` reads
 * it. Only a statement that anchors something and carries one JSON object is
 * kept: an orphan or a bad payload is meta's finding, and derives nothing.
 */
export interface DocStatement {
  /** The anchored file lines: the block, or a section's heading. */
  anchor: { start: number; end: number };
  scope: "block" | "section";
  pin?: string;
  status: "current" | "changed" | "unpinned";
  data: Record<string, unknown>;
}

/** A link found in a document body. */
export interface DocLink {
  /** The raw target as written in the source. */
  raw: string;
  /**
   * internal: resolves to a discovered doc (repo-relative path in `resolvedPath`,
   *   optional `anchor`);
   * external: absolute URL;
   * broken: relative target that does not match a discovered doc.
   */
  kind: "internal" | "external" | "broken";
  /** Repo-relative path of the target doc (internal links only). */
  resolvedPath?: string;
  /** Fragment identifier without `#`, when present. */
  anchor?: string;
  /** Normalized absolute URL (external links only). */
  url?: string;
}

/** An image reference found in a document body. */
export interface DocImage {
  raw: string;
  /** Absolute URL or repo-relative path resolved from the doc's location. */
  target: string;
  external: boolean;
}

/** Everything dockg derives from one source file. */
export interface DocModel {
  /** Repo-relative path with forward slashes, e.g. `docs/guide.md`. */
  path: string;
  /** Parsed frontmatter data ({} when absent). */
  frontmatter: Record<string, unknown>;
  /** Whether a frontmatter block was present. */
  frontmatterPresent: boolean;
  /** The format the page was parsed as: `--as`, else its extension. */
  format: DocFormat;
  /** First H1 text, if any (used as title fallback). */
  firstH1?: string;
  sections: Section[];
  /** The page's inline `meta` statements, in document order. */
  statements?: DocStatement[];
  links: DocLink[];
  images: DocImage[];
  /** Distinct fenced code block languages, sorted. */
  codeLanguages: string[];
  /**
   * BCP-47 tag from the nearest enclosing route mapping that declares one
   * (ADR 01037), or undefined when no route covers this path or none in the
   * chain declares a language. The page's own `lang`/`language` frontmatter
   * outranks it.
   */
  routeLanguage?: string;
  /**
   * The `xml:lang` of the Flare project a page belongs to (proposal 0125,
   * decision 10), as written. The page's own key and a route's language
   * outrank it. Absent for a page in no project.
   */
  projectLanguage?: string;
  /**
   * Lowercase sha256 hex digest of the document's UTF-8 content, as read —
   * line endings included, so it matches `sha256sum <file>` (ADR 01036).
   */
  contentHash: string;
}
