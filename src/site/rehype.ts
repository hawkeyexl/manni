/**
 * `@hawkeyexl/manni/site/rehype` (proposal 0095): the rehype plugin that
 * stamps each block element of a rendered page with the source file and the
 * file lines it came from, as `data-manni-src="<file>:<start>-<end>"`.
 * `manni site annotate` reads the stamps to join a pin to its block, then
 * removes every one.
 *
 * Built `platform: "neutral"`: it runs inside any unified pipeline, so it
 * imports nothing, and the bundle-purity test holds it to that.
 */

/** The hast shapes the plugin reads: no dependency on `@types/hast`. */
interface Point {
  line?: number;
}
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  position?: { start?: Point; end?: Point };
  children?: HastNode[];
}
interface VFileLike {
  path?: string;
  cwd?: string;
  history?: string[];
}

/** The elements a claim can be joined to. Table cells join through their row. */
const BLOCKS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "pre", "blockquote",
  "table", "tr", "dl", "dt", "dd",
]);

const slashes = (path: string): string => path.replace(/\\/g, "/");

/** The file, relative to the directory the build runs in when it is inside it. */
function fileOf(file: VFileLike): string | undefined {
  const path = file.path ?? file.history?.at(-1);
  if (path === undefined || path === "") return undefined;
  const abs = slashes(path);
  const cwd = file.cwd === undefined ? "" : slashes(file.cwd).replace(/\/$/, "");
  return cwd !== "" && abs.startsWith(`${cwd}/`) ? abs.slice(cwd.length + 1) : abs;
}

function stamp(node: HastNode, file: string): void {
  if (node.type === "element" && node.tagName !== undefined && BLOCKS.has(node.tagName)) {
    const start = node.position?.start?.line;
    const end = node.position?.end?.line;
    if (start !== undefined && end !== undefined) {
      node.properties ??= {};
      node.properties["dataManniSrc"] = `${file}:${String(start)}-${String(end)}`;
    }
  }
  for (const child of node.children ?? []) stamp(child, file);
}

/** The plugin. Takes no options: `rehypePlugins: [manniLines]`. */
export default function manniLines(): (tree: HastNode, file: VFileLike) => void {
  return (tree, file) => {
    const path = fileOf(file);
    if (path !== undefined) stamp(tree, path);
  };
}
