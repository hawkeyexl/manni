/**
 * Glob matching, shared by every tool.
 *
 * One matcher, so that the two questions that look alike really are alike: is
 * this file in a collection (proposal 0041), and does it match a schema
 * override's `files:` (0015). It lived in the metadata tool's schema resolver
 * until membership needed it too; a second copy is how the two would start
 * disagreeing about a dot file or a `\`.
 */
import picomatch from "picomatch";

const matcherCache = new Map<string, (p: string) => boolean>();

/**
 * Does this file path match the glob — or, for the list form, any of them — by
 * the shared rules (picomatch, dot files included, `\` normalized to `/`)?
 */
export function matchesFileGlob(
  relPath: string,
  glob: string | readonly string[],
): boolean {
  // picomatch takes a pattern array natively, so the list form needs no loop
  // here — but the cache does need a *string* key. Keyed on the array itself
  // this Map would compare by identity: a hit only for the very same object,
  // and an entry retained for every config ever parsed. JSON.stringify is the
  // key because it separates the two shapes on its own — a lone "a/**" and
  // ["a/**"] serialize differently — with no separator char to collide with
  // one inside a glob.
  const key = JSON.stringify(glob);
  let m = matcherCache.get(key);
  if (!m) {
    m = picomatch(glob as string | string[], { dot: true });
    matcherCache.set(key, m);
  }
  // Normalize Windows separators so globs written with `/` still match.
  return m(relPath.replace(/\\/g, "/"));
}
