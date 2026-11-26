/**
 * Include resolution: read a page the way a reader sees it (proposal 0130).
 *
 * Replaces each include directive in a page with the included file's text, so
 * lint and docevals assess what the site renders. The result keeps a map from
 * every expanded offset back to the file and offset it came from, so a finding
 * reports at the directive's line in the page and names the line it came from.
 *
 * Ported from doc-detective 5.6.3's `core/includes.js` (its ADR 01212), read
 * from the published `dist/` build, since the npm package ships no source.
 * The syntaxes, selectors and guards are its own. Two things differ. Each
 * piece also carries the page offset of the top-level directive that brought
 * it in, which is where manni reports. And the warnings are manni's.
 *
 * Flare and DITA are not here: `resolveFlare` and DITA-OT expand those.
 */
import { readFileSync, realpathSync, statSync, existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

/** Asciidoctor's `max-include-depth` default. */
export const MAX_INCLUDE_DEPTH = 64;

type Family = "markdown" | "asciidoc" | "rst";

const FAMILY_BY_EXT: Record<string, Family> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".mdx": "markdown",
  ".adoc": "asciidoc",
  ".asciidoc": "asciidoc",
  ".asc": "asciidoc",
  ".rst": "rst",
  ".rest": "rst",
};

const FAMILY_BY_FORMAT: Record<string, Family> = {
  markdown: "markdown",
  mdx: "markdown",
  asciidoc: "asciidoc",
  rst: "rst",
};

/** The include syntax a lint parser's format reads, or undefined for none. */
export function includeFamily(format: string): Family | undefined {
  return FAMILY_BY_FORMAT[format];
}

/** Where an expanded offset lives. */
export interface IncludeLocation {
  /** Offset, line and column in the page's own text. Inside an include, the directive's. */
  offset: number;
  line: number;
  column: number;
  /** The file, as `display` names it, and 1-based line the text came from, when that is not the page. */
  includedFrom?: { file: string; line: number };
}

export interface Expansion {
  /** The page with every include expanded. The page itself when it has none. */
  text: string;
  /** Real paths of every file the page includes, at any depth. */
  included: Set<string>;
  /** Map an offset in `text` back to the page and to the file it came from. */
  locate: (offset: number) => IncludeLocation;
}

export interface ExpandOptions {
  content: string;
  /** The page's path. Relative paths resolve against `root`. */
  filePath: string;
  /** The page's format, as a lint parser names it. Its extension decides when absent. */
  format?: string;
  /** Nothing outside it is read. The config file's directory, or the cwd. */
  root: string;
  /** How a warning names a file. Relative to `root` by default. */
  display?: (abs: string) => string;
  /** Where warnings go. Each says what was left unexpanded. */
  report?: (message: string) => void;
}

interface Piece {
  text: string;
  file: string;
  srcStart: number;
  /** Page offset of the top-level directive that brought this piece in. */
  anchor?: number;
}

type Selection = { ranges: [number, number][] } | { missing: string };

interface Directive {
  start: number;
  end: number;
  target: string;
  base: "fileThenRoot" | "rootThenFile" | "mdx" | "rst";
  select?: (text: string) => Selection;
  attribute?: [string, string];
  attributes?: boolean;
  optional?: boolean;
  skip?: boolean;
}

const isUrl = (target: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(target);

/** Each line's [start, end) span, the end past its line break. */
function lineSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(/[^\n]*\n|[^\n]+$/g)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** 1-based line and column of `offset`, by binary search over `starts`. */
function lineCol(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (starts[lo] ?? 0) + 1 };
}

/** Lines 1-based and inclusive; a missing end runs to the last line. */
function selectLines(text: string, ranges: [number, number | undefined][], label: string): Selection {
  const spans = lineSpans(text);
  const out: [number, number][] = [];
  for (const [from, to] of ranges) {
    const last = to === undefined || to < 0 ? spans.length : Math.min(to, spans.length);
    for (let n = Math.max(from, 1); n <= last; n++) {
      const span = spans[n - 1];
      if (span) out.push(span);
    }
  }
  return out.length ? { ranges: out } : { missing: label };
}

/** Lines inside the wanted named regions, without the marker lines. */
function selectRegions(text: string, start: RegExp, end: RegExp, wanted?: string[]): Selection {
  const open = new Set<string>();
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [s, e] of lineSpans(text)) {
    const line = text.slice(s, e);
    const opened = start.exec(line)?.[1];
    const closed = end.exec(line)?.[1];
    if (opened) {
      open.add(opened);
      seen.add(opened);
    }
    if (closed) open.delete(closed);
    if (opened || closed) continue;
    if (!wanted || wanted.some((name) => open.has(name))) out.push([s, e]);
  }
  const missing = wanted?.find((name) => !seen.has(name));
  return missing ? { missing } : { ranges: out };
}

const ASCIIDOC_TAG: [RegExp, RegExp] = [/\btag::([\w-]+)\[\]/, /\bend::([\w-]+)\[\]/];
const MDBOOK_ANCHOR: [RegExp, RegExp] = [/ANCHOR:\s*([\w-]+)/, /ANCHOR_END:\s*([\w-]+)/];
const MKDOCS_SECTION: [RegExp, RegExp] = [/--8<--\s*\[start:([\w-]+)\]/, /--8<--\s*\[end:([\w-]+)\]/];

/** `path:3:9`, `path:3:`, `path::9`, `path:3`, or `path:name`, as mdBook and MkDocs write them. */
function splitSelector(
  spec: string,
  markers: [RegExp, RegExp],
): { target: string; select: (text: string) => Selection } {
  const m = /^(.+?):(\d*)(?::(\d*))?$/.exec(spec) ?? /^(.+?):([A-Za-z_][\w-]*)$/.exec(spec);
  const target = m?.[1];
  const a = m?.[2] ?? "";
  // A one-letter "path" is a Windows drive, not a selector.
  if (target === undefined || /^[A-Za-z]$/.test(target)) {
    return { target: spec, select: (text) => selectRegions(text, ...markers) };
  }
  if (!/^\d*$/.test(a)) return { target, select: (text) => selectRegions(text, ...markers, [a]) };
  const b = m?.[3];
  const from = a ? Number(a) : 1;
  const to = b === undefined ? (a ? from : undefined) : b ? Number(b) : undefined;
  return {
    target,
    select: (text) => selectLines(text, [[from, to]], spec.slice(target.length + 1)),
  };
}

/** Ranges of fenced code blocks. */
function fenceRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let open: { start: number; fence: string } | undefined;
  for (const [s, e] of lineSpans(text)) {
    const m = /^\s*(`{3,}|~{3,})(.*)/.exec(text.slice(s, e));
    const fence = m?.[1];
    if (fence === undefined) continue;
    if (!open) open = { start: s, fence };
    // A closing fence has nothing after it but spaces and tabs (CommonMark).
    else if (
      fence[0] === open.fence[0] &&
      fence.length >= open.fence.length &&
      /^[ \t]*\r?\n?$/.test(m?.[2] ?? "")
    ) {
      ranges.push([open.start, e]);
      open = undefined;
    }
  }
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}

function asciidocDirectives(text: string): Directive[] {
  const found: Directive[] = [];
  // Attribute entries apply to the includes after them, in reading order.
  const re =
    /^(?::(\w[\w-]*):[ \t]*(.*?)[ \t]*|include::([^[\r\n]+)\[([^\]\r\n]*)\][ \t]*)(?=\r?$)/gm;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      found.push({ start: m.index, end: m.index, target: "", base: "fileThenRoot", attribute: [m[1], m[2] ?? ""] });
      continue;
    }
    const target = m[3] ?? "";
    const rawAttrs = m[4] ?? "";
    const attrs = new Map(
      [...rawAttrs.matchAll(/([\w-]+)=("([^"]*)"|[^,]*)/g)].map((a) => [a[1] ?? "", a[3] ?? a[2] ?? ""]),
    );
    let select: Directive["select"];
    const lines = attrs.get("lines");
    const tags = attrs.get("tag") ?? attrs.get("tags");
    if (lines !== undefined) {
      const ranges = lines
        .split(/[;,]/)
        .filter(Boolean)
        .map((r): [number, number | undefined] => {
          const [from = "", to] = r.split("..");
          // `N..` runs to the last line, like `N..-1`.
          return [Number(from), to === undefined ? Number(from) : to === "" ? undefined : Number(to)];
        });
      select = (t) => selectLines(t, ranges, `lines=${lines}`);
    } else if (tags !== undefined) {
      const names = tags.split(/[;,]/).filter(Boolean);
      select = (t) => selectRegions(t, ...ASCIIDOC_TAG, names);
    }
    const optional = /(^|,)\s*(opts="?[^"]*optional|optional-option)/.test(rawAttrs);
    found.push({
      start: m.index,
      end: m.index + m[0].length,
      target,
      base: "fileThenRoot",
      ...(select ? { select } : {}),
      optional,
      attributes: true,
    });
  }
  return found;
}

function markdownDirectives(text: string, fileText: string): Directive[] {
  const found: Directive[] = [];
  // Inline code and comments show a directive as an example.
  const examples: [number, number][] = [
    ...text.matchAll(/`[^`\r\n]+`|\{\/\*[\s\S]*?\*\/\}|<!--[\s\S]*?-->/g),
  ].map((m): [number, number] => [m.index, m.index + m[0].length]);
  // ponytail: linear scan per directive; a page has few of either. Binary
  // search over the sorted spans if a format ever yields many directives.
  const inExample = (i: number): boolean => examples.some(([s, e]) => i >= s && i < e);
  // mdBook and MkDocs expand these before Markdown is parsed, fenced code
  // included, so a fence keeps them. An inline example is manni's departure:
  // a page that names the syntax in prose would otherwise include `path`.
  for (const m of text.matchAll(/(?<!\\)\{\{#include\s+([^}\s]+)\s*\}\}/g)) {
    if (inExample(m.index)) continue;
    found.push({
      start: m.index,
      end: m.index + m[0].length,
      base: "fileThenRoot",
      ...splitSelector(m[1] ?? "", MDBOOK_ANCHOR),
    });
  }
  for (const m of text.matchAll(/^[ \t]*-{1,}8<-{1,}[ \t]+(["'])([^"'\r\n]+)\1[ \t]*(?=\r?$)/gm)) {
    const start = m.index + m[0].length - m[0].trimStart().length;
    found.push({
      start,
      end: m.index + m[0].length,
      base: "rootThenFile",
      ...splitSelector(m[2] ?? "", MKDOCS_SECTION),
    });
  }
  // Components render nowhere inside code or comments.
  const fences = fenceRanges(text);
  const inSkipped = (i: number): boolean => inExample(i) || fences.some(([s, e]) => i >= s && i < e);
  for (const m of text.matchAll(/<Markdown\s+src=["']([^"']+)["']\s*\/>/g)) {
    if (!inSkipped(m.index)) {
      found.push({ start: m.index, end: m.index + m[0].length, target: m[1] ?? "", base: "fileThenRoot" });
    }
  }
  // MDX imports map a component name to a file; `<Name />` is where it renders.
  const imports = new Map<string, string>();
  const importRe = /^import\s+(?:(\w+)|\{([^}]*)\}|\*\s+as\s+(\w+))\s+from\s+["']([^"']+\.mdx?)["'];?/gm;
  const fileFences = fenceRanges(fileText);
  for (const m of fileText.matchAll(importRe)) {
    if (fileFences.some(([s, e]) => m.index >= s && m.index < e)) continue;
    const from = m[4] ?? "";
    if (m[1]) imports.set(m[1], from);
    if (m[3]) imports.set(`${m[3]}.Content`, from);
    for (const named of (m[2] ?? "").split(",")) {
      const [name, alias] = named.trim().split(/\s+as\s+/);
      if (name === "Content") imports.set(alias ?? name, from);
    }
  }
  if (imports.size) {
    for (const m of text.matchAll(/<([A-Za-z_]\w*(?:\.Content)?)\s*\/>/g)) {
      const target = imports.get(m[1] ?? "");
      if (target !== undefined && !inSkipped(m.index)) {
        found.push({ start: m.index, end: m.index + m[0].length, target, base: "mdx" });
      }
    }
  }
  return found;
}

const indentOf = (line: string): number => /^[ \t]*/.exec(line)?.[0].length ?? 0;

/**
 * Whether an rST line sits in a literal block, a code block or a comment. The
 * nearest less-indented line above it says: `::` at its end, a code directive,
 * or a `..` that names no directive, target or substitution.
 */
function inRstLiteral(text: string, at: number): boolean {
  const lines = text.slice(0, at).split("\n");
  let indent = indentOf(lines.pop() ?? "");
  // Walk up through each less-indented parent until one opens a literal
  // block or the top level is reached.
  for (let i = lines.length - 1; i >= 0 && indent > 0; i--) {
    const line = (lines[i] ?? "").replace(/\r$/, "");
    if (line.trim() === "" || indentOf(line) >= indent) continue;
    const t = line.trim();
    if (/::$/.test(t) && !/^\.\.\s+\S+::/.test(t)) return true;
    if (/^\.\.\s+(code-block|code|sourcecode|literalinclude)::/.test(t)) return true;
    if (/^\.\.(\s|$)/.test(t) && !/^\.\.\s+(\S+::|_|\[|\|)/.test(t)) return true;
    indent = indentOf(line);
  }
  return false;
}

function rstDirectives(text: string): Directive[] {
  const found: Directive[] = [];
  const re = /^([ \t]*)\.\.[ \t]+include::[ \t]+(\S.*?)[ \t]*(?=\r?$)((?:\r?\n\1[ \t]+:[\w-]+:.*?(?=\r?$))*)/gm;
  for (const m of text.matchAll(re)) {
    const lead = m[1] ?? "";
    const start = m.index + lead.length;
    if (inRstLiteral(text, start)) continue;
    const target = m[2] ?? "";
    const options = new Map<string, string>();
    for (const o of (m[3] ?? "").matchAll(/:([\w-]+):[ \t]*(.*?)[ \t]*(?=\r?$)/gm)) {
      options.set(o[1] ?? "", o[2] ?? "");
    }
    // A docutils standard include, or a file included as literal text, adds no prose.
    const skip = target.startsWith("<") || options.has("literal") || options.has("code");
    const select = (t: string): Selection => {
      const spans = lineSpans(t);
      const at = (n: string | undefined, fallback: number): number => {
        if (n === undefined) return fallback;
        const i = Math.max(Number(n) < 0 ? spans.length + Number(n) : Number(n), 0);
        return i >= spans.length ? t.length : (spans[i]?.[0] ?? t.length);
      };
      const lineOptions = ["start-line", "end-line"].filter((k) => options.has(k));
      const bad = lineOptions.find((k) => !/^-?\d+$/.test(options.get(k) ?? ""));
      if (bad) return { missing: `:${bad}: ${options.get(bad) ?? ""}`.trimEnd() };
      let s = at(options.get("start-line"), 0);
      let e = at(options.get("end-line"), t.length);
      if (lineOptions.length && e <= s) {
        return { missing: lineOptions.map((k) => `:${k}: ${options.get(k) ?? ""}`).join(" ") };
      }
      const after = options.get("start-after");
      if (after !== undefined) {
        const i = t.indexOf(after, s);
        if (i < 0 || i >= e) return { missing: after };
        s = i + after.length;
      }
      const beforeText = options.get("end-before");
      if (beforeText !== undefined) {
        const i = t.indexOf(beforeText, s);
        if (i < 0 || i > e) return { missing: beforeText };
        e = i;
      }
      return { ranges: [[s, e]] };
    };
    found.push({ start, end: m.index + m[0].length, target, base: "rst", select, skip });
  }
  return found;
}

function findAncestor(dir: string, names: string[]): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    if (names.some((name) => existsSync(join(d, name)))) return d;
    if (dirname(d) === d) return undefined;
  }
}

const DOCUSAURUS = ["js", "ts", "mjs", "cjs"].map((e) => `docusaurus.config.${e}`);

/** Where a target may live, in the order to try. Empty means don't follow it. */
function candidatesFor(target: string, base: Directive["base"], file: string, root: string): string[] {
  const dir = dirname(file);
  if (base === "mdx") {
    if (target.startsWith("@site/")) {
      const site = findAncestor(dir, DOCUSAURUS);
      return site ? [join(site, target.slice("@site/".length))] : [];
    }
    if (target.startsWith("/")) {
      const docs = findAncestor(dir, ["docs.json", "mint.json"]);
      return docs ? [join(docs, target)] : [];
    }
    // A package import is a component, not a page.
    return target.startsWith(".") ? [resolve(dir, target)] : [];
  }
  if (base === "rst" && target.startsWith("/")) {
    const source = findAncestor(dir, ["conf.py"]);
    if (source) return [join(source, target)];
  }
  if (isAbsolute(target)) return [target];
  const fromFile = resolve(dir, target);
  const fromRoot = resolve(root, target);
  return base === "rootThenFile" ? [fromRoot, fromFile] : [fromFile, fromRoot];
}

const isFile = (candidate: string): boolean => {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const inside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

export function realpath(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return resolve(file);
  }
}

const trimFinalBreak = (pieces: Piece[]): Piece[] => {
  const last = pieces[pieces.length - 1];
  if (last) last.text = last.text.replace(/\r?\n$/, "");
  return pieces.filter((p) => p.text.length > 0);
};

/**
 * An MDX page can't hold an HTML comment, so a Markdown file's comments become
 * MDX comments outside code fences. `<!--` becomes `{/* ` and `-->` becomes
 * `*\/}`, the same lengths, so every offset still maps back.
 */
function asMdx(piece: Piece): Piece {
  if (extname(piece.file) === ".mdx") return piece;
  const fences = fenceRanges(piece.text);
  const text = piece.text.replace(/<!--([\s\S]*?)-->/g, (all, body: string, offset: number) =>
    fences.some(([s, e]) => offset >= s && offset < e) ? all : `{/* ${body}*/}`,
  );
  return { ...piece, text };
}

/** Indents every line after the first. The indent maps to the directive. */
function indentPieces(pieces: Piece[], indent: string, file: string, offset: number, anchor?: number): Piece[] {
  const out: Piece[] = [];
  for (const piece of pieces) {
    let pos = 0;
    for (const m of piece.text.matchAll(/\n/g)) {
      const cut = m.index + 1;
      out.push({ ...piece, text: piece.text.slice(pos, cut), srcStart: piece.srcStart + pos });
      out.push({ text: indent, file, srcStart: offset, ...(anchor === undefined ? {} : { anchor }) });
      pos = cut;
    }
    if (pos < piece.text.length) {
      out.push({ ...piece, text: piece.text.slice(pos), srcStart: piece.srcStart + pos });
    }
  }
  return out;
}

const posix = (p: string): string => p.replace(/\\/g, "/");

/** Expands the includes in one page's content. A page with none comes back unchanged. */
export function expandIncludes(opts: ExpandOptions): Expansion {
  const { content, report = () => undefined } = opts;
  const rootReal = realpath(opts.root);
  const rootFile = realpath(resolve(opts.root, opts.filePath));
  const display = opts.display ?? ((abs: string) => posix(relative(rootReal, abs)) || abs);
  const pageFamily =
    (opts.format === undefined ? undefined : includeFamily(opts.format)) ??
    FAMILY_BY_EXT[extname(rootFile).toLowerCase()];
  const texts = new Map<string, string>([[rootFile, content]]);
  const starts = new Map<string, number[]>();
  const startsOf = (file: string): number[] => {
    let s = starts.get(file);
    if (!s) {
      s = lineStarts(texts.get(file) ?? "");
      starts.set(file, s);
    }
    return s;
  };
  const included = new Set<string>();
  const attributes = new Map<string, string>();
  const familyFor = (file: string, parent: Family): Family => FAMILY_BY_EXT[extname(file).toLowerCase()] ?? parent;

  // `null` keeps the directive as text.
  const resolveOne = (d: Directive, piece: Piece, offset: number, chain: string[], family: Family): Piece[] | null => {
    const file = piece.file;
    const from = `${display(file)}:${String(lineCol(startsOf(file), offset).line)}`;
    const leftAs = (why: string): null => {
      report(`${from}: include "${d.target}" ${why}; left unexpanded.`);
      return null;
    };
    if (d.skip) return null;
    if (isUrl(d.target)) return leftAs("is a URL");
    const candidates = candidatesFor(d.target, d.base, file, rootReal);
    if (!candidates.length) {
      // A package import is a component and stays silent; a rooted import
      // whose root marker is missing is a page the reader would see.
      if (d.base === "mdx" && d.target.startsWith("@site/")) {
        return leftAs("needs a docusaurus.config file above the page");
      }
      if (d.base === "mdx" && d.target.startsWith("/")) {
        return leftAs("needs a docs.json or mint.json above the page");
      }
      return null;
    }
    const found = candidates.find(isFile);
    if (found === undefined) return d.optional ? null : leftAs("not found");
    const real = realpath(found);
    if (!inside(real, rootReal)) return leftAs(`is outside ${posix(rootReal)}`);
    const loop = chain.indexOf(real);
    if (loop !== -1) {
      // Started at its first member by name, so each page of one cycle says
      // the same line, and `warn` says it once.
      const members = chain.slice(loop).map(display);
      const first = members.indexOf([...members].sort()[0] ?? "");
      const ring = [...members.slice(first), ...members.slice(0, first)];
      report(`${ring[0] ?? ""} includes itself: ${[...ring, ring[0] ?? ""].join(" → ")}; stopped expanding.`);
      return null;
    }
    if (chain.length > MAX_INCLUDE_DEPTH) {
      report(`${display(rootFile)}: includes nest deeper than ${String(MAX_INCLUDE_DEPTH)}; stopped expanding.`);
      return null;
    }
    let text = texts.get(real);
    if (text === undefined) {
      try {
        text = readFileSync(real, "utf8");
      } catch {
        return leftAs("not found");
      }
      texts.set(real, text);
    }
    const selection = d.select ? d.select(text) : { ranges: [[0, text.length] as [number, number]] };
    if ("missing" in selection) return leftAs(`selects "${selection.missing}", which is not found`);
    included.add(real);
    // Adjacent ranges join, so a comment spanning selected lines stays whole.
    const ranges: [number, number][] = [];
    for (const [s, e] of selection.ranges.filter(([s, e]) => e > s)) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] === s) last[1] = e;
      else ranges.push([s, e]);
    }
    const anchor = piece.anchor ?? offset;
    const body = text;
    const pieces = ranges.map(([s, e]): Piece => ({ text: body.slice(s, e), file: real, srcStart: s, anchor }));
    const expanded = trimFinalBreak(expand(pieces, familyFor(real, family), [...chain, real]));
    return extname(file) === ".mdx" ? expanded.map(asMdx) : expanded;
  };

  const expand = (pieces: Piece[], family: Family, chain: string[]): Piece[] => {
    const file = pieces[0]?.file ?? rootFile;
    // The whole file, so MDX imports outside a selected range still apply.
    const fileText = texts.get(file) ?? "";
    const out: Piece[] = [];
    for (const piece of pieces) {
      const directives = (
        family === "asciidoc"
          ? asciidocDirectives(piece.text)
          : family === "markdown"
            ? markdownDirectives(piece.text, fileText)
            : rstDirectives(piece.text)
      )
        .sort((a, b) => a.start - b.start)
        .filter((d, i, all) => i === 0 || d.start >= (all[i - 1]?.end ?? 0));
      let pos = 0;
      for (const d of directives) {
        if (d.attribute) {
          attributes.set(...d.attribute);
          continue;
        }
        if (d.attributes) d.target = d.target.replace(/\{([\w-]+)\}/g, (all, name: string) => attributes.get(name) ?? all);
        const offset = piece.srcStart + d.start;
        const resolved = resolveOne(d, piece, offset, chain, family);
        if (resolved === null) continue;
        if (d.start > pos) out.push({ ...piece, text: piece.text.slice(pos, d.start), srcStart: piece.srcStart + pos });
        // A directive indented on its own line indents every included line.
        const lineStart = piece.text.lastIndexOf("\n", d.start - 1) + 1;
        const indent = piece.text.slice(lineStart, d.start);
        out.push(
          ...(/^[ \t]+$/.test(indent) ? indentPieces(resolved, indent, piece.file, offset, piece.anchor) : resolved),
        );
        pos = d.end;
      }
      if (pos < piece.text.length) out.push({ ...piece, text: piece.text.slice(pos), srcStart: piece.srcStart + pos });
    }
    return out;
  };

  const identity: Expansion = {
    text: content,
    included,
    locate: (offset) => ({ offset, ...lineCol(startsOf(rootFile), offset) }),
  };
  if (pageFamily === undefined) return identity;
  const pieces = expand([{ text: content, file: rootFile, srcStart: 0 }], pageFamily, [rootFile]);
  if (included.size === 0) return identity;

  const pieceStarts: number[] = [];
  let total = 0;
  for (const p of pieces) {
    pieceStarts.push(total);
    total += p.text.length;
  }
  const locate = (offset: number): IncludeLocation => {
    let lo = 0;
    let hi = pieces.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((pieceStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    const piece = pieces[lo];
    if (piece === undefined) return { offset, line: 1, column: 1 };
    const src = piece.srcStart + Math.min(offset - (pieceStarts[lo] ?? 0), piece.text.length);
    if (piece.anchor === undefined) return { offset: src, ...lineCol(startsOf(rootFile), src) };
    return {
      offset: piece.anchor,
      ...lineCol(startsOf(rootFile), piece.anchor),
      includedFrom: { file: display(piece.file), line: lineCol(startsOf(piece.file), src).line },
    };
  };
  return { text: pieces.map((p) => p.text).join(""), included, locate };
}
