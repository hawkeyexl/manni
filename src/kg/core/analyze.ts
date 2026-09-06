/**
 * Markdown analysis: one source file → a `DocModel`. Frontmatter data comes
 * from docmeta's extractor (single source of truth with `manni kg validate`);
 * body structure (headings, links, images, code fences) comes from a
 * remark/mdast walk with positions in document order.
 */
import { createHash } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { toString as mdastToString } from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import { extractFrontmatter } from "../../meta/index.js";
import type { Root, RootContent, Definition } from "mdast";
import { DockgError } from "../types.js";
import type { DocImage, DocLink, DocModel, Section } from "../types.js";
import {
  DEFAULT_INDEX_FILES,
  DEFAULT_LINK_EXTENSIONS,
  type RouteMapping,
} from "./config.js";
import { normalizeDocPath } from "./iri.js";

export interface AnalyzeOptions {
  /** Site-route mappings for resolving root-absolute links. */
  routes?: RouteMapping[];
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"]);

/**
 * MDX gets its own processor, selected by extension (ADR 01022). It cannot be
 * the default: MDX reads `{` as an expression delimiter, so ordinary Markdown
 * prose containing braces would become a syntax error.
 */
const mdxProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkMdx);

/** MDX JSX attribute, narrowed to the literal-string case we can act on. */
interface JsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}

/**
 * Elements whose `src` is an image.
 *
 * `href` is HTML's hyperlink attribute wherever it appears, so reading it from
 * any element only ever yields an extra edge. `src` is not analogous: it is the
 * generic external-resource attribute, shared by `iframe`, `video`, `script`,
 * `audio`, `source`, and `embed`. Emitting `schema:image` for a video embed or
 * an analytics script would be a wrong *type* assertion rather than a merely
 * extra one, so `src` is read only where it means an image (ADR 01022).
 */
const IMAGE_ELEMENTS = new Set(["img", "image"]);

/**
 * The value of a JSX attribute, when it is a plain string literal.
 *
 * An expression attribute (`href={route}`) yields undefined rather than a
 * guess: its value is not knowable without evaluating the module, and a wrong
 * edge asserted confidently is worse than an absent one.
 */
function jsxAttributeValue(
  node: unknown,
  attributeName: string,
): string | undefined {
  const attributes = (node as { attributes?: JsxAttribute[] }).attributes;
  if (!Array.isArray(attributes)) return undefined;
  for (const attribute of attributes) {
    if (attribute.type !== "mdxJsxAttribute") continue;
    if (attribute.name !== attributeName) continue;
    return typeof attribute.value === "string" ? attribute.value : undefined;
  }
  return undefined;
}

/** True when the target has a URI scheme (http:, https:, mailto:, ...). */
export function hasScheme(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target);
}

/**
 * Resolve a relative link target against the linking doc's directory using
 * pure string math (posix, OS-independent). Returns null when the target
 * escapes the corpus root.
 */
export function resolveRelative(
  docPath: string,
  target: string,
): string | null {
  const baseSegments = normalizeDocPath(docPath).split("/").slice(0, -1);
  const segments = [...baseSegments];
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return segments.join("/");
}

const HAS_EXTENSION = /\.[a-z0-9]+$/i;

/**
 * Whether a link target addresses a *document* at all (ADR 01033).
 *
 * An extension list declares what documents look like in a corpus. A target
 * carrying some other explicit extension — `/dockg/ns.ttl`, `./dist.zip`, a
 * linked PDF — is a static asset the site serves, not a document dockg failed
 * to find, and reporting it as a broken link produces a finding the author
 * cannot act on: there is no `.md` they could add to fix it.
 *
 * Extensionless and directory targets stay in scope, so a genuine typo in a
 * pretty URL is still caught.
 */
function addressesDocument(target: string, extensions: string[]): boolean {
  if (target === "" || !HAS_EXTENSION.test(target)) return true;
  // No configured extensions means the mapping has declared nothing about what
  // its documents look like — so there is no list to judge the target against,
  // and the narrowing does not apply. Gating on an empty list would answer "no"
  // to every extension-bearing target and skip genuinely broken `.md` links,
  // turning a narrowing into a way to switch the check off. `extensions: []` is
  // schema-valid (no minItems), so this is reachable config, not a theoretical.
  if (extensions.length === 0) return true;
  const ext = target.slice(target.lastIndexOf(".")).toLowerCase();
  return extensions.some((e) => e.toLowerCase() === ext);
}

/** Slug normalization for route matching: lowercase, dashes/underscores stripped. */
function slugNorm(path: string): string {
  return path.toLowerCase().replace(/[-_]/g, "");
}

/**
 * Tiered lookup over the corpus: exact path, then case-insensitive, then
 * slug-normalized (published slugs are often kebab-cased versions of
 * camelCase filenames, e.g. Fern's /stop-record for stopRecord.mdx).
 * Ambiguous fallback matches (two files normalizing identically) stay
 * unresolved rather than guessing.
 */
class PathIndex {
  private readonly lower = new Map<string, string | null>();
  private readonly slugged = new Map<string, string | null>();

  constructor(private readonly exact: ReadonlySet<string>) {
    for (const path of exact) {
      const lower = path.toLowerCase();
      this.lower.set(lower, this.lower.has(lower) ? null : path);
      const slug = slugNorm(path);
      this.slugged.set(slug, this.slugged.has(slug) ? null : path);
    }
  }

  resolve(candidate: string): string | undefined {
    if (this.exact.has(candidate)) return candidate;
    return (
      this.lower.get(candidate.toLowerCase()) ??
      this.slugged.get(slugNorm(candidate)) ??
      undefined
    );
  }
}

/** decodeURIComponent that falls back to the raw string on malformed input. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Candidate repo paths for an extensionless (or extension-bearing) link
 * target. Shared by route and relative resolution so both link forms resolve
 * identically: an explicit extension is taken verbatim; a trailing slash
 * prefers the directory's index files but falls back to extension candidates
 * (pretty URLs — Hugo/Docusaurus serve foo.md at /foo/); otherwise extensions
 * are tried before index files.
 */
function targetCandidates(
  target: string,
  isDirectory: boolean,
  extensions: string[],
  indexFiles: string[],
): string[] {
  if (target !== "" && HAS_EXTENSION.test(target)) return [target];
  const extensionCandidates =
    target === "" ? [] : extensions.map((ext) => `${target}${ext}`);
  const dir = target === "" ? "" : `${target}/`;
  const indexCandidates: string[] = [];
  for (const indexFile of indexFiles) {
    for (const ext of extensions)
      indexCandidates.push(`${dir}${indexFile}${ext}`);
  }
  return isDirectory
    ? [...indexCandidates, ...extensionCandidates]
    : [...extensionCandidates, ...indexCandidates];
}

/**
 * The language labelling a source path, from the nearest enclosing route
 * mapping that declares one (ADR 01037).
 *
 * "Nearest" is the longest matching `root`, so a `docs/de` mapping beats a
 * `docs` one for a file under both. A mapping that declares no language is
 * transparent rather than blocking: `{root: docs, language: en}` plus
 * `{root: docs/api}` still labels `docs/api/x.md` as English, the way a nested
 * directory inherits the setting of its parent.
 */
export function routeLanguageFor(
  path: string,
  routes: readonly RouteMapping[],
): string | undefined {
  let best: { root: string; language: string } | undefined;
  for (const mapping of routes) {
    if (mapping.language === undefined) continue;
    const root = mapping.root;
    const covers = root === "" || path === root || path.startsWith(`${root}/`);
    if (!covers) continue;
    if (best === undefined || root.length > best.root.length) {
      best = { root, language: mapping.language };
    }
  }
  return best?.language;
}

/**
 * Resolve a root-absolute route (`/docs/actions/find`) to a source file via
 * the configured mappings. Returns the repo path, "broken" when a mapping's
 * basePath matched but no candidate file exists, or null when no mapping
 * covers the route.
 */
function resolveRoute(
  pathPart: string,
  routes: RouteMapping[],
  index: PathIndex,
): string | null {
  const isDirectory = /\/+$/.test(pathPart);
  const clean = safeDecode(pathPart).replace(/\/+$/, "");
  let anyMatched = false;
  for (const mapping of routes) {
    if (
      clean !== mapping.basePath &&
      !clean.startsWith(`${mapping.basePath}/`)
    ) {
      continue;
    }
    // Matched the basePath, but this mapping's documents do not carry that
    // extension — so the mapping says nothing about this target. Leave
    // `anyMatched` alone: another mapping may still claim it, and if none
    // does the caller skips the link rather than calling it broken.
    const rest = clean.slice(mapping.basePath.length).replace(/^\/+/, "");
    if (!addressesDocument(rest, mapping.extensions)) continue;
    anyMatched = true;
    const prefix = mapping.root ? `${mapping.root}/` : "";
    // Bare basePath targets the root directory itself (index files only).
    const stem = rest === "" ? mapping.root : `${prefix}${rest}`;
    const candidates = targetCandidates(
      stem,
      isDirectory || rest === "",
      mapping.extensions,
      mapping.indexFiles,
    );
    for (const candidate of candidates) {
      const resolved = index.resolve(candidate);
      if (resolved) return resolved;
    }
  }
  return anyMatched ? "broken" : null;
}

/** One PathIndex per corpus set — analyzeDoc is called once per doc over the same set. */
const indexCache = new WeakMap<ReadonlySet<string>, PathIndex>();

function pathIndexFor(allPaths: ReadonlySet<string>): PathIndex {
  let index = indexCache.get(allPaths);
  if (!index) {
    index = new PathIndex(allPaths);
    indexCache.set(allPaths, index);
  }
  return index;
}

function classifyLink(
  docPath: string,
  rawTarget: string,
  allPaths: ReadonlySet<string>,
  routes: RouteMapping[],
): DocLink | null {
  const raw = rawTarget;
  if (hasScheme(raw)) {
    try {
      return { raw, kind: "external", url: new URL(raw).href };
    } catch {
      // Scheme-bearing but unparseable — example junk, not a link. Skip.
      return null;
    }
  }
  const hashAt = raw.indexOf("#");
  const pathPart = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const anchor = hashAt === -1 ? undefined : raw.slice(hashAt + 1);
  if (pathPart === "") return null; // same-document anchor
  // Site-root-absolute URLs (/docs/x/) are published-site routes. With route
  // mappings configured they resolve to source files (or count as broken when
  // a mapped basePath has no matching file); unmapped routes are skipped.
  if (pathPart.startsWith("/")) {
    const resolved = resolveRoute(pathPart, routes, pathIndexFor(allPaths));
    if (resolved === null) return null;
    if (resolved === "broken") return { raw, kind: "broken" };
    const link: DocLink = { raw, kind: "internal", resolvedPath: resolved };
    if (anchor) link.anchor = anchor;
    return link;
  }
  const resolved = resolveRelative(docPath, safeDecode(pathPart));
  if (resolved !== null) {
    const index = pathIndexFor(allPaths);
    let candidates: string[];
    if (allPaths.has(resolved)) {
      candidates = [resolved];
    } else if (HAS_EXTENSION.test(resolved)) {
      // Exact-or-broken — unless the extension is not a document extension at
      // all, in which case it is an asset and no document was ever addressed
      // (ADR 01033). Checked after `allPaths`, so an asset that IS in the
      // corpus still links.
      if (!addressesDocument(resolved, DEFAULT_LINK_EXTENSIONS)) return null;
      candidates = [];
    } else {
      candidates = targetCandidates(
        resolved,
        pathPart.endsWith("/"),
        DEFAULT_LINK_EXTENSIONS,
        DEFAULT_INDEX_FILES,
      );
    }
    for (const candidate of candidates) {
      const hit = index.resolve(candidate);
      if (hit) {
        const link: DocLink = { raw, kind: "internal", resolvedPath: hit };
        if (anchor) link.anchor = anchor;
        return link;
      }
    }
  }
  return { raw, kind: "broken" };
}

function classifyImage(docPath: string, rawTarget: string): DocImage {
  if (hasScheme(rawTarget)) {
    return { raw: rawTarget, target: rawTarget, external: true };
  }
  const resolved = resolveRelative(docPath, rawTarget);
  return { raw: rawTarget, target: resolved ?? rawTarget, external: false };
}

/** Analyze one Markdown file. `allPaths` is the discovered corpus for link resolution. */
export function analyzeDoc(
  content: string,
  relPath: string,
  allPaths: ReadonlySet<string>,
  options: AnalyzeOptions = {},
): DocModel {
  const routes = options.routes ?? [];
  const path = normalizeDocPath(relPath);
  const meta = extractFrontmatter(content, "markdown");
  const isMdx = path.endsWith(".mdx");
  let tree: Root;
  try {
    tree = (isMdx ? mdxProcessor : processor).parse(content);
  } catch (error) {
    // Parsing MDX makes parse *failures* possible where Markdown had none:
    // remark-parse accepts anything, the MDX extension does not. Left raw, the
    // micromark throw escapes cli.ts's `fail()` — which only converts
    // DockgError — so the CLI dumps a stack trace, exits 1 (the code the
    // contract reserves for findings), and never names the file. Convert it.
    if (!isMdx) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new DockgError(`Could not parse MDX in ${path}: ${reason}`);
  }

  const sections: Section[] = [];
  const links: DocLink[] = [];
  const images: DocImage[] = [];
  const codeLanguages = new Set<string>();
  const definitions = new Map<string, Definition>();
  let firstH1: string | undefined;

  // First pass: collect reference-link definitions.
  visit(tree, (node) => {
    if (node.type === "definition") {
      const def = node;
      definitions.set(def.identifier, def);
    }
  });

  const slugger = new GithubSlugger();
  /** Stack of open sections: [level, slug]. */
  const stack: Array<{ level: number; slug: string }> = [];
  /** Child counters keyed by parent slug ("" = document). */
  const childCount = new Map<string, number>();

  visit(tree, (node) => {
    switch (node.type) {
      case "heading": {
        const level = (node as { depth: number }).depth;
        const title = mdastToString(node);
        const slug = slugger.slug(title);
        if (level === 1 && firstH1 === undefined) firstH1 = title;
        while (stack.length > 0 && stack[stack.length - 1]!.level >= level) {
          stack.pop();
        }
        const parentSlug =
          stack.length > 0 ? stack[stack.length - 1]!.slug : null;
        const parentKey = parentSlug ?? "";
        const order = (childCount.get(parentKey) ?? 0) + 1;
        childCount.set(parentKey, order);
        sections.push({ slug, title, level, order, parentSlug });
        stack.push({ level, slug });
        break;
      }
      case "link": {
        const link = classifyLink(
          path,
          (node as { url: string }).url,
          allPaths,
          routes,
        );
        if (link) links.push(link);
        break;
      }
      case "linkReference": {
        const def = definitions.get(
          (node as { identifier: string }).identifier,
        );
        if (def) {
          const link = classifyLink(path, def.url, allPaths, routes);
          if (link) links.push(link);
        }
        break;
      }
      case "image": {
        images.push(classifyImage(path, (node as { url: string }).url));
        break;
      }
      case "imageReference": {
        const def = definitions.get(
          (node as { identifier: string }).identifier,
        );
        if (def) images.push(classifyImage(path, def.url));
        break;
      }
      case "code": {
        const lang = (node as { lang?: string | null }).lang;
        if (lang) codeLanguages.add(lang);
        break;
      }
      // A JSX element's `href` is a link and its `src` is an image, on any
      // element (ADR 01022). Those are HTML's own names for the relationships,
      // so this stays structural — dockg never learns what `<LinkCard>` means.
      case "mdxJsxFlowElement":
      case "mdxJsxTextElement": {
        const href = jsxAttributeValue(node, "href");
        if (href !== undefined) {
          const link = classifyLink(path, href, allPaths, routes);
          if (link) links.push(link);
        }
        const name = (node as { name?: string | null }).name ?? "";
        if (IMAGE_ELEMENTS.has(name.toLowerCase())) {
          const src = jsxAttributeValue(node, "src");
          if (src !== undefined) images.push(classifyImage(path, src));
        }
        break;
      }
    }
  });

  const routeLanguage = routeLanguageFor(path, routes);

  return {
    path,
    frontmatter: meta.data,
    frontmatterPresent: meta.present,
    firstH1,
    sections,
    links,
    images,
    codeLanguages: [...codeLanguages].sort(),
    // Omitted rather than set to undefined, so a doc under no localized route
    // carries no key at all — `routeLanguage` in JSON output means something.
    ...(routeLanguage === undefined ? {} : { routeLanguage }),
    // Over the content as read — line endings included, so the digest is
    // byte-faithful and equals `sha256sum <file>` for any valid-UTF-8 file
    // (ADR 01036). The CRLF corpus fixture depends on this not normalizing.
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

/** Minimal depth-first mdast walk in document order. */
function visit(
  node: Root | RootContent,
  fn: (node: RootContent) => void,
): void {
  const children = (node as { children?: RootContent[] }).children;
  if (!children) return;
  for (const child of children) {
    fn(child);
    visit(child, fn);
  }
}
