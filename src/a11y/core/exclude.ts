/**
 * Keeping part of a site out of the crawl (proposal 0059).
 *
 * A pattern is matched against the URL's **path** alone, never the scheme,
 * host, port, query or fragment. The host is exactly the part that changes
 * between a local preview and production, so one pattern has to survive the
 * move: `/proposals/**` reads the same against `http://127.0.0.1:4321/` and
 * against `https://example.com/`.
 *
 * A trailing slash is not part of the comparison, because a crawl produces
 * both spellings — a sitemap usually lists `/proposals/`, a bare link usually
 * points at `/proposals`. Stripping it means a pattern cannot catch one and
 * silently miss the other. Stripping it is also what makes `/proposals/**`
 * cover the section index as well as the pages under it, since picomatch's
 * `**` already matches zero segments.
 *
 * Matching itself is the family's file-glob matcher, so an exclusion and a
 * collection's `paths:` read a `*`, a `**` and a dot segment the same way. A
 * URL path never carries a raw backslash — the WHATWG parser rewrites one and
 * percent-encodes the rest — so that matcher's separator normalization cannot
 * change what a pattern here means.
 */
import { matchesFileGlob } from "../../shared/globs.js";

/**
 * One pattern, and the name a message gives it.
 *
 * A pattern reaches a run from one of two places, and an error about it has to
 * say which. `--exclude "/proposals/**"` for a typed flag, and the config
 * file's own shape for a key, so that a run whose patterns came from
 * `a11y.exclude:` never names a flag the user did not type.
 */
export interface ExcludeGlob {
  glob: string;
  /** How a message names this pattern: a flag, or a file and a key. */
  source: string;
}

export interface ExcludeFilter {
  /** The patterns, in the order they were given. */
  readonly patterns: readonly ExcludeGlob[];
  /** The first pattern that keeps `url` out of the crawl, or `null`. */
  match(url: string): ExcludeGlob | null;
  /** Whether any pattern keeps `url` out of the crawl. */
  matches(url: string): boolean;
}

/**
 * The tail every "that is not a path glob" message ends with, so the flag and
 * the config key say the same thing about the same mistake.
 */
export const MUST_START_WITH_SLASH = 'must start with "/": it matches a URL path.';

/**
 * Can this pattern ever match a path? A path always starts with `/`, so a
 * pattern that does not is a silent near-miss rather than a filter, and both
 * the flag and the config key refuse it.
 */
export function isUrlPathGlob(pattern: string): boolean {
  return pattern.startsWith("/");
}

/**
 * The path a pattern is matched against: the URL's `pathname` with one
 * trailing `/` dropped, unless the path is exactly `/`. `null` for a string
 * that is not a URL, which the crawl has already dropped for other reasons.
 */
export function excludePath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname;
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * A filter over `patterns`, in order. An empty list excludes nothing, which is
 * the default and the shape a run with neither the flag nor the config key
 * has. Patterns are taken as given: one value is one pattern, and a comma
 * inside it is a literal comma, per 0034's one-separator rule.
 */
export function createExcludeFilter(patterns: readonly ExcludeGlob[]): ExcludeFilter {
  const list = [...patterns];
  const match = (url: string): ExcludeGlob | null => {
    if (list.length === 0) return null;
    const path = excludePath(url);
    if (path === null) return null;
    return list.find((pattern) => matchesFileGlob(path, pattern.glob)) ?? null;
  };
  return {
    patterns: list,
    match,
    matches: (url) => match(url) !== null,
  };
}
