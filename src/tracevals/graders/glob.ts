/**
 * A small path glob, for grader options that name a set of files rather than
 * one (ADR 01016).
 *
 * Deliberately not a dependency: the syntax needed here is `**`, `*`, and `?`
 * over already-normalized paths, and a matcher that small is easier to pin than
 * to pick. Matching follows the same rule as the `file-access` grader's
 * suffix compare — separators normalized, case folded, anchored at a path
 * segment boundary — so `docs/**` reads the same whatever the checkout root is.
 * `file-access` reaches that rule by compiling its literal path through here,
 * so the two cannot drift.
 *
 * **The pattern is untrusted input.** It comes from the *evaluated* project's
 * front matter and is tested against every file access in a window, so a
 * pattern that compiles to nested optional-greedy groups is a denial of service
 * on the runner rather than a slow match. Two things keep that impossible: a
 * run of double-star segments collapses to one, so the optional greedy group
 * never nests, and compilation is memoised per pattern string.
 */

/** Escapes every regex metacharacter; `*` and `?` are handled by the caller. */
const literal = (ch: string): string => ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/**
 * Compiled patterns, keyed by the pattern string. Bounded because the key
 * space is: a run grades a fixed set of evals, each carrying a fixed set of
 * globs, and the compiled form depends on nothing else.
 */
const compiled = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = compiled.get(glob);
  if (cached !== undefined) return cached;
  const built = compile(glob);
  compiled.set(glob, built);
  return built;
}

function compile(glob: string): RegExp {
  // A run of `**/` means exactly what one does — "any number of segments" —
  // so collapsing it here is a normalization, not an approximation. Left
  // uncollapsed, each repeat added another optional greedy group over the same
  // input and the cost of a failed match grew multiplicatively.
  const spec = glob
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/(?:\*\*\/)+/g, "**/");
  let out = "";
  for (let i = 0; i < spec.length; i += 1) {
    const ch = spec[i] as string;
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    if (ch !== "*") {
      out += literal(ch);
      continue;
    }
    if (spec[i + 1] !== "*") {
      out += "[^/]*";
      continue;
    }
    // `**` spans separators, and must allow *zero* segments: `docs/**` has to
    // match `docs` itself, and `docs/**/x` has to match `docs/x`. Both cases
    // absorb one adjacent separator rather than requiring it.
    i += 1;
    if (spec[i + 1] === "/") {
      i += 1;
      // A leading `**/` is already covered by the unconditional ancestor
      // prefix below, so emitting a second optional group here would give the
      // engine two interchangeable ways to consume the same segments — the
      // shape that turns a failed match exponential.
      if (out !== "") out += "(?:.*/)?";
    } else if (out.endsWith("/")) {
      out = `${out.slice(0, -1)}(?:/.*)?`;
    } else {
      out += ".*";
    }
  }
  // Trace paths are absolute and machine-specific, so a spec matches any
  // ancestor prefix — but only whole segments, so `docs/**` does not match
  // `docsite/`.
  return new RegExp(`^(?:.*/)?${out}$`);
}

/** Separators normalized and case folded, the one way both matchers see paths. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** True when `path` matches `glob`, both normalized the same way. */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(normalizePath(path));
}
