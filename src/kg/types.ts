/** Shared types for manni kg. */
import { ToolError } from "../shared/errors.js";

/** Operational error: expected failure reported to the user, exit code 2. */
export class DockgError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "DockgError";
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
  /** First H1 text, if any (used as title fallback). */
  firstH1?: string;
  sections: Section[];
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
   * Lowercase sha256 hex digest of the document's UTF-8 content, as read —
   * line endings included, so it matches `sha256sum <file>` (ADR 01036).
   */
  contentHash: string;
}
