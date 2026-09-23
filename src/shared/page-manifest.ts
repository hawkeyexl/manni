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
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import { LineCounter, isMap, isNode, isScalar, parseDocument } from "yaml";

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

/** One entry of a per-page manifest found on disk, naming the page it is for. */
export interface FoundPageEntry {
  /** The key exactly as the manifest spells it. */
  spelled: string;
  /** The page it names, absolute. */
  pageAbs: string;
  /** 1-based line of the key in the manifest, when known. */
  line?: number;
}

/** A manifest file a `{page}` pattern names, and the entries it holds for its own page. */
export interface FoundPageManifest {
  /** The manifest, absolute. */
  abs: string;
  entries: FoundPageEntry[];
}

/**
 * The manifests on disk that `file`, a `{page}` pattern, names (0058 § 5):
 * every file the pattern's `strayManifestGlob` matches under `configDir`,
 * kept when it holds an entry the pattern resolves back to that very file,
 * for a page `isMember` claims. `isMember` takes the page's posix path
 * relative to `configDir`. A file with no such entry is not this pattern's
 * manifest, whatever its name: a copy of the tree elsewhere, a fixture, or a
 * file that only looks like one.
 *
 * The walk does not consult `.gitignore`, because a manifest is config named
 * input rather than a discovered document. It skips `node_modules`, `.git`
 * and dot directories, as the document walk does, so a checkout nested under
 * a dot directory is never read as this one's. A file that cannot be read or
 * parsed is not recognizably a manifest, and is skipped.
 *
 * Synchronous, so a synchronous orphan check can call it. It runs once per
 * whole-corpus run, never for a run given paths.
 */
export function findPageManifests(
  file: string,
  configDir: string,
  isMember: (relPath: string) => boolean,
): FoundPageManifest[] {
  const matched = fg
    .sync(strayManifestGlob(file), {
      cwd: configDir,
      absolute: true,
      onlyFiles: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
    })
    .map((path) => resolve(path))
    .sort();
  const found: FoundPageManifest[] = [];
  for (const abs of matched) {
    const entries = ownEntries(abs, file, configDir, isMember);
    if (entries.length > 0) found.push({ abs, entries });
  }
  return found;
}

/** The entries of the manifest at `abs` that `file` resolves back to `abs`. */
function ownEntries(
  abs: string,
  file: string,
  configDir: string,
  isMember: (relPath: string) => boolean,
): FoundPageEntry[] {
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return [];
  }
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  const root = doc.contents;
  if (doc.errors.length > 0 || !isMap(root)) return [];
  const entries: FoundPageEntry[] = [];
  for (const pair of root.items) {
    const spelled = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const pageAbs = resolve(configDir, spelled);
    if (!isMember(slashes(relative(configDir, pageAbs)))) continue;
    const resolved = pageManifestPath(file, configDir, pageAbs);
    if ("outside" in resolved || !sameFile(resolved.abs, abs)) continue;
    const range = isNode(pair.key) ? pair.key.range : undefined;
    entries.push({
      spelled,
      pageAbs,
      ...(range ? { line: lc.linePos(range[0]).line } : {}),
    });
  }
  return entries;
}

/**
 * Are these one file, as the filesystem resolves them? Compared as files and
 * not as text (0058 stress test 8), so a case-only difference is one file on
 * a case-insensitive filesystem and two elsewhere.
 */
function sameFile(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
