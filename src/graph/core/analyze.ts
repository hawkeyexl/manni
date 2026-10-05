/**
 * Document analysis: one source file → a `DocModel`. Metadata comes from the
 * metadata tool's extractor (the same one `manni meta validate` reads a page
 * with). Markdown and MDX body structure (headings, links, images, code
 * fences) comes from a remark/mdast walk in document order; every other format
 * comes from lint's section tree (proposal 0077 §2).
 */
import { createHash } from "node:crypto";
import { extname } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdx from "remark-mdx";
import { toString as mdastToString } from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import {
  extractFrontmatter,
  extractorForExtension,
  type MetadataExtractor,
} from "../../meta/index.js";
import { parserByName, parserForExtension } from "../../lint/parsers/index.js";
import type {
  ContentNode,
  DocumentTree,
  SectionNode,
} from "../../lint/types.js";
import type { Root, RootContent, Definition } from "mdast";
import { errorMessage } from "../../shared/errors.js";
import { GraphError } from "../types.js";
import type { DocImage, DocLink, DocModel, Section } from "../types.js";
import {
  DEFAULT_INDEX_FILES,
  DEFAULT_LINK_EXTENSIONS,
  type RouteMapping,
} from "./config.js";
import { normalizeDocPath } from "./iri.js";

/** The formats graph parses, as `--as` names them: lint's parser names. */
export const DOC_FORMATS = [
  "asciidoc",
  "html",
  "markdown",
  "mdx",
  "rst",
  "xml",
] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];
/** The formats read through lint's tree rather than graph's mdast walk. */
export type TreeFormat = Exclude<DocFormat, "markdown" | "mdx">;

export function isDocFormat(name: string): name is DocFormat {
  return (DOC_FORMATS as readonly string[]).includes(name);
}

/**
 * The format a page parses as: `format` (`--as`) when given, else the lint
 * parser claiming its extension. An extension nobody claims reaches here only
 * through `--ext`, and reads as markdown, as every page did before 0077.
 */
export function formatOf(path: string, format?: DocFormat): DocFormat {
  if (format !== undefined) return format;
  const name = parserForExtension(extname(path))?.name;
  return name !== undefined && isDocFormat(name) ? name : "markdown";
}

export interface AnalyzeOptions {
  /** Site-route mappings for resolving root-absolute links. */
  routes?: RouteMapping[];
  /** `--as`: parse as this format whatever the path says. Absent, see `formatOf`. */
  format?: DocFormat;
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
 * escapes the corpus root. A page labelled above the root (`../docs/a.md`)
 * already climbs, so its leading `..` segments are kept, never popped as if
 * they were directories, and its links may climb further.
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
      if (segments[segments.length - 1] === "..") segments.push("..");
      else segments.pop();
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
 * carrying some other explicit extension — `/manni/graph/ns.ttl`, `./dist.zip`, a
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

/**
 * meta's extractor for a non-Markdown format. Lint's parser names are meta's
 * extractor names, so the parser's own extension finds the extractor under
 * `--as` too, where the path's would not.
 */
export function extractorFor(format: TreeFormat): MetadataExtractor | undefined {
  return extractorForExtension(parserByName(format)?.extensions[0] ?? "");
}

/**
 * A page's own metadata, as `manni meta validate` reads it. `build` reads a
 * page with it and `fill` reads what a page already holds with it, so the two
 * cannot disagree about a format.
 */
export function metadataOf(
  content: string,
  path: string,
  format: DocFormat,
): { data: Record<string, unknown>; present: boolean } {
  try {
    const meta =
      format === "markdown" || format === "mdx"
        ? extractFrontmatter(content, "markdown")
        : extractorFor(format)?.extract(content, path);
    return meta === undefined
      ? { data: {}, present: false }
      : { data: meta.data, present: meta.present };
  } catch (error) {
    // The extractor knows the bytes, not the file. Left as it is, build and
    // fill would report a YAML error with no hint of which page carries it.
    throw new GraphError(`${path}: ${errorMessage(error)}`);
  }
}

/** Analyze one document. `allPaths` is the discovered corpus for link resolution. */
export function analyzeDoc(
  content: string,
  relPath: string,
  allPaths: ReadonlySet<string>,
  options: AnalyzeOptions = {},
): DocModel {
  const routes = options.routes ?? [];
  const path = normalizeDocPath(relPath);
  const format = formatOf(path, options.format);
  if (format !== "markdown" && format !== "mdx") {
    return analyzeTreeDoc(content, path, format, allPaths, routes);
  }
  const meta = metadataOf(content, path, format);
  const isMdx = format === "mdx";
  let tree: Root;
  try {
    tree = (isMdx ? mdxProcessor : processor).parse(content);
  } catch (error) {
    // Parsing MDX makes parse *failures* possible where Markdown had none:
    // remark-parse accepts anything, the MDX extension does not. Left raw, the
    // micromark throw escapes cli.ts's `fail()` — which only converts
    // GraphError — so the CLI dumps a stack trace, exits 1 (the code the
    // contract reserves for findings), and never names the file. Convert it.
    if (!isMdx) throw error;
    const reason = errorMessage(error);
    throw new GraphError(`Could not parse MDX in ${path}: ${reason}`);
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
        // Reading the top frame *is* the emptiness test, so what the loop pops
        // is what the loop looked at.
        for (
          let top = stack.at(-1);
          top !== undefined && top.level >= level;
          top = stack.at(-1)
        ) {
          stack.pop();
        }
        const parentSlug = stack.at(-1)?.slug ?? null;
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

  return {
    path,
    frontmatter: meta.data,
    frontmatterPresent: meta.present,
    format,
    firstH1,
    sections,
    links,
    images,
    codeLanguages: [...codeLanguages].sort(),
    ...sourceFacts(content, path, routes),
  };
}

/** What every format's `DocModel` derives from the path and the bytes alone. */
function sourceFacts(
  content: string,
  path: string,
  routes: RouteMapping[],
): Pick<DocModel, "routeLanguage" | "contentHash"> {
  const routeLanguage = routeLanguageFor(path, routes);
  return {
    // Omitted rather than set to undefined, so a doc under no localized route
    // carries no key at all — `routeLanguage` in JSON output means something.
    ...(routeLanguage === undefined ? {} : { routeLanguage }),
    // Over the content as read — line endings included, so the digest is
    // byte-faithful and equals `sha256sum <file>` for any valid-UTF-8 file
    // (ADR 01036). The CRLF corpus fixture depends on this not normalizing.
    contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

/**
 * Lint's tree for `content`, parsed as `format`. A parser's throw names the
 * format and the file, and exits 2, as an MDX parse failure does.
 */
export function parseTree(
  content: string,
  path: string,
  format: TreeFormat,
): DocumentTree {
  const parser = parserByName(format);
  if (parser === undefined) {
    throw new GraphError(`No parser reads ${format}.`);
  }
  try {
    return parser.parse(content, path);
  } catch (error) {
    throw new GraphError(
      `Could not parse ${format} in ${path}: ${errorMessage(error)}`,
    );
  }
}

/**
 * Characters an IRI fragment accepts unchanged: the XML NCName set plus `:`,
 * which covers HTML ids, DITA `@id`, `xml:id`, Asciidoctor's `_install` and
 * Sphinx labels. Anything else is slugged, because a section IRI is never
 * percent-encoded.
 */
const IRI_SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

/** The sections minted from a lint tree, and the content each one owns. */
export interface TreeSections {
  sections: Section[];
  /** The content each section owns, parallel to `sections`. */
  owned: ContentNode[][];
  /** Content no minted section owns: the lead's, and a skipped heading's. */
  unowned: ContentNode[];
  firstH1: string | undefined;
}

/**
 * Mint graph sections from lint's tree, in document order. `analyzeDoc` and
 * the search index both call it, so their anchors agree.
 *
 * The anchor is the source's own id verbatim when it is IRI-safe, so a link
 * written to `#GUID-A1B2-C3D4` reaches the section; else the slugged title.
 * Ids and slugs share one namespace per document, so a duplicate of either
 * kind gains a `-N` suffix rather than merging two sections into one node.
 *
 * The level-0 lead, a heading lint made from a metadata title, and an
 * untitled heading (a DITA map's `topicref` without a navtitle) are not
 * sections. Each is transparent: its content belongs to the document, and its
 * subsections nest under its own parent, as Markdown's do under no heading.
 */
export function mintTreeSections(roots: SectionNode[]): TreeSections {
  const out: TreeSections = {
    sections: [],
    owned: [],
    unowned: [],
    firstH1: undefined,
  };
  const slugger = new GithubSlugger();
  const taken = new Set<string>();
  const childCount = new Map<string, number>();

  const anchorFor = (node: SectionNode): string => {
    const id = node.id;
    // `prov.` fragments are the provenance nodes' (derive.ts), minted with a
    // dot precisely because a slug never holds one. A verbatim id may.
    if (id !== undefined && IRI_SAFE_ID.test(id) && !id.startsWith("prov.")) {
      let anchor = id;
      for (let n = 1; taken.has(anchor); n++) anchor = `${id}-${String(n)}`;
      taken.add(anchor);
      return anchor;
    }
    // The slugger dedupes against its own output only, so a slug an earlier
    // verbatim id took is asked for again until it is free.
    let anchor = slugger.slug(node.title);
    while (taken.has(anchor)) anchor = slugger.slug(node.title);
    taken.add(anchor);
    return anchor;
  };

  const walk = (nodes: SectionNode[], parentSlug: string | null): void => {
    for (const node of nodes) {
      if (node.level === 0 || node.synthetic || node.title.trim() === "") {
        out.unowned.push(...node.children);
        walk(node.sections, parentSlug);
        continue;
      }
      const slug = anchorFor(node);
      if (node.level === 1 && out.firstH1 === undefined) {
        out.firstH1 = node.title;
      }
      const parentKey = parentSlug ?? "";
      const order = (childCount.get(parentKey) ?? 0) + 1;
      childCount.set(parentKey, order);
      out.sections.push({
        slug,
        title: node.title,
        level: node.level,
        order,
        parentSlug,
      });
      out.owned.push(node.children);
      walk(node.sections, slug);
    }
  };
  walk(roots, null);
  return out;
}

/** Every content node, nested ones included, in document order. */
function eachContent(
  nodes: readonly ContentNode[],
  fn: (node: ContentNode) => void,
): void {
  for (const node of nodes) {
    fn(node);
    switch (node.kind) {
      case "list":
        for (const item of node.items) eachContent(item.children, fn);
        break;
      case "table":
        for (const row of node.children) {
          for (const cell of row.children) eachContent(cell.children, fn);
        }
        break;
      case "definitionList":
        for (const item of node.children) eachContent(item.definition, fn);
        break;
      case "admonition":
      case "blockquote":
      case "element":
        eachContent(node.children, fn);
        break;
      default:
        break;
    }
  }
}

/** Every content node a tree's sections own directly, whichever section. */
function treeContent(sections: readonly SectionNode[]): ContentNode[] {
  return sections.flatMap((s) => [...s.children, ...treeContent(s.sections)]);
}

/** A non-Markdown document, read through lint's tree and meta's extractor. */
function analyzeTreeDoc(
  content: string,
  path: string,
  format: TreeFormat,
  allPaths: ReadonlySet<string>,
  routes: RouteMapping[],
): DocModel {
  // Parsed first, so a malformed page is reported as a parse failure rather
  // than as whatever the metadata reader tripped on.
  const tree = parseTree(content, path, format);
  const meta = metadataOf(content, path, format);
  const minted = mintTreeSections(tree.sections);

  const links: DocLink[] = [];
  for (const { target } of tree.links) {
    const link = classifyLink(path, target, allPaths, routes);
    if (link) links.push(link);
  }
  const images: DocImage[] = [];
  const codeLanguages = new Set<string>();
  eachContent(treeContent(tree.sections), (node) => {
    if (node.kind === "image") images.push(classifyImage(path, node.url));
    else if (node.kind === "codeBlock" && node.language) {
      codeLanguages.add(node.language);
    }
  });

  return {
    path,
    frontmatter: meta.data,
    frontmatterPresent: meta.present,
    format,
    firstH1: minted.firstH1,
    sections: minted.sections,
    links,
    images,
    codeLanguages: [...codeLanguages].sort(),
    ...sourceFacts(content, path, routes),
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
