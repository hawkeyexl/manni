/**
 * The `{page}` placeholder in `externalMetadata[].file` (proposal 0058).
 *
 * A `file` holding `{page}` is a rule rather than a file: each page gets its
 * own manifest, named by substituting the page's path, relative to the config
 * file's directory and without its extension. `"{page}.citations.yaml"` puts
 * `docs/x/index.mdx`'s manifest at `docs/x/index.citations.yaml`.
 *
 * One normalization is used wherever a pattern or a page path is compared or
 * substituted (0058 § 1): strip one leading `./`, and write every separator as
 * a forward slash. It is deliberately that small. It is not `path.resolve`, so
 * `./a/../{page}.yaml` stays its own pattern, and it does not fold case.
 *
 * The grammar itself (one token, spelled exactly, never in a URL or an
 * absolute path) is enforced by the config parser in `collections.ts`, so
 * everything here may assume a `file` that passed it.
 *
 * Shared, so it imports nothing from a tool.
 */
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

/** The one placeholder `externalMetadata[].file` accepts. */
export const PAGE_PLACEHOLDER = "{page}";

/** True when `file` contains the {page} token (assumes it already passed parse validation). */
export function hasPagePlaceholder(file: string): boolean {
  return file.includes(PAGE_PLACEHOLDER);
}

/** Every separator written as a forward slash. */
function slashes(path: string): string {
  return path.split(sep).join("/").replace(/\\/g, "/");
}

/**
 * 0058 § 1 normalization: strip one leading "./", backslashes to "/". No case
 * folding, no path.resolve, no ".." collapsing.
 */
export function normalizeManifestPattern(file: string): string {
  const forward = file.replace(/\\/g, "/");
  return forward.startsWith("./") ? forward.slice(2) : forward;
}

/**
 * The manifest a page resolves to. `configDir` absolute; `pageAbs` absolute.
 *
 * `{page}` is `relative(configDir, pageAbs)` with its extension removed,
 * normalized as above, substituted into the normalized pattern. Returns the
 * manifest's absolute path and its posix path relative to `configDir`, or
 * `{ outside: true, pageRel }` when the page is not under the config
 * directory: its relative path climbs with `../`, or, across Windows drives,
 * there is no relative path at all.
 */
export function pageManifestPath(
  file: string,
  configDir: string,
  pageAbs: string,
): { abs: string; rel: string } | { outside: true; pageRel: string } {
  const between = relative(configDir, pageAbs);
  const pageRel = slashes(between);
  if (isAbsolute(between) || pageRel === ".." || pageRel.startsWith("../")) {
    return { outside: true, pageRel };
  }
  const ext = posix.extname(pageRel);
  const page = ext === "" ? pageRel : pageRel.slice(0, -ext.length);
  const named = normalizeManifestPattern(file).replace(PAGE_PLACEHOLDER, () => page);
  const abs = resolve(configDir, named);
  return { abs, rel: slashes(relative(configDir, abs)) };
}

/**
 * 0058 § 5: the glob every manifest of a pattern matches. The normalized
 * pattern is split at `{page}` and `**` + `/*` inserted, keeping the prefix
 * and the suffix, which are the config author's own literal text. No page
 * path reaches it, so nothing in it needs escaping.
 * `"{page}.citations.yaml"` gives `**` + `/*.citations.yaml`, and
 * `"./meta/{page}.citations.yaml"` gives `meta/**` + `/*.citations.yaml`.
 */
export function strayManifestGlob(file: string): string {
  const normalized = normalizeManifestPattern(file);
  const at = normalized.indexOf(PAGE_PLACEHOLDER);
  if (at < 0) return normalized;
  return `${normalized.slice(0, at)}**/*${normalized.slice(at + PAGE_PLACEHOLDER.length)}`;
}
