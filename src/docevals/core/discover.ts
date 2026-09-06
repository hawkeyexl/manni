/**
 * Page discovery: glob the configured include/exclude patterns, read each
 * file, and extract frontmatter using docmeta's shared extractor (identical
 * fence handling and JSON-Pointer -> line maps as `docmeta validate`).
 */
import { readFileSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import fg from "fast-glob";
import { extractFrontmatter, type ExtractedMetadata } from "../../meta/index.js";
import { DocevalsError } from "../types.js";
import type { DocevalsConfig } from "./config.js";

export interface PageFile {
  /** Path relative to the discovery root, forward slashes. */
  file: string;
  absPath: string;
  /** Full file content. */
  content: string;
  /** Content with the leading frontmatter block removed (judge input). */
  body: string;
  frontmatter: ExtractedMetadata;
  /** Set when frontmatter extraction failed; the page is reported as errored. */
  extractError?: string;
}

export type FrontmatterFormat = "yaml" | "toml" | "json";

const FENCES: {
  format: FrontmatterFormat;
  open: RegExp;
  isClose: (l: string) => boolean;
}[] = [
  { format: "yaml", open: /^---\r?\n/, isClose: (l) => l === "---" || l === "..." },
  { format: "toml", open: /^\+\+\+\r?\n/, isClose: (l) => l === "+++" },
  { format: "json", open: /^;;;\r?\n/, isClose: (l) => l === ";;;" },
];

/** The frontmatter format a page opens with, or undefined if it has none. */
export function leadingFrontmatterFormat(
  content: string,
): FrontmatterFormat | undefined {
  const body = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  return FENCES.find((f) => f.open.test(body))?.format;
}

/** Remove a leading fenced frontmatter block, mirroring docmeta's fence rules. */
export function stripFrontmatterBlock(content: string): string {
  const body =
    content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const fence = FENCES.find((f) => f.open.test(body));
  if (!fence) return body;
  const lines = body.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    if (fence.isClose(lines[i] ?? "")) {
      return lines.slice(i + 1).join("\n");
    }
  }
  return body;
}

function formatForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".md":
    case ".markdown":
      return "markdown";
    case ".mdx":
      return "mdx";
    default:
      return "markdown";
  }
}

/** Read and extract a single page. Extraction errors are captured, not thrown. */
export function readPage(absPath: string, root: string): PageFile {
  const content = readFileSync(absPath, "utf8");
  const file = relative(root, absPath).replace(/\\/g, "/");
  const format = formatForExtension(extname(absPath));
  try {
    const frontmatter = extractFrontmatter(content, format);
    return {
      file,
      absPath,
      content,
      body: stripFrontmatterBlock(content),
      frontmatter,
    };
  } catch (e) {
    return {
      file,
      absPath,
      content,
      body: stripFrontmatterBlock(content),
      frontmatter: {
        data: {},
        present: false,
        format,
        lineFor: () => undefined,
      },
      extractError: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Discover pages. Explicit `globs` (CLI args) override the config's include
 * patterns; the config's exclude patterns always apply.
 */
export function discoverPages(
  config: DocevalsConfig,
  globs: string[] = [],
  root = process.cwd(),
): PageFile[] {
  const patterns = globs.length > 0 ? globs : config.files.include;
  const entries = fg.sync(patterns, {
    cwd: root,
    ignore: config.files.exclude,
    absolute: true,
    dot: false,
    onlyFiles: true,
  });
  const supported = new Set([".md", ".markdown", ".mdx"]);
  const files = entries.filter((p) => supported.has(extname(p).toLowerCase()));
  if (files.length === 0) {
    throw new DocevalsError(
      `No documentation pages found (patterns: ${patterns.join(", ")})`,
    );
  }
  return files.sort().map((p) => readPage(resolve(p), root));
}
