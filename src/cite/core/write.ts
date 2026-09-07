/**
 * Every way the tool rewrites a page. Frontmatter appends go through meta's
 * `applyFrontmatter` (comments and key order preserved). A `moved` rewrite
 * splices the `src:` line textually at `lineFor("/citations/N/src")`, so
 * nothing else in the block is touched. Inline statements are inserted or
 * replaced by offset with the page's own EOL. Files are written with
 * `writeFileAtomic`.
 */
import { DocmetaError, locateFrontmatter, type MetadataExtractor } from "../../meta/index.js";
import { extractorByName } from "../../meta/internal.js";
import { CiteError } from "../errors.js";
import type { Citation } from "../types.js";
import { detectEol, lineAt, offsetOfLine } from "./statements.js";

function extractorFor(format: string): MetadataExtractor {
  const extractor = extractorByName(format);
  if (!extractor) throw new CiteError(`Unknown format "${format}".`);
  return extractor;
}

/**
 * Whether the format reads a leading fenced block as its frontmatter. Asked
 * of the extractor itself rather than kept as a list of names here, so a
 * format added to meta's registry answers for itself. An element-backed
 * format (html, xml) sees the probe as body text and says no.
 */
function readsFencedFrontmatter(extractor: MetadataExtractor, label: string): boolean {
  return extractor.extract("---\nprobe: 1\n---\n", label).fenced === true;
}

/** Append one entry to `citations` (creating the key), via the format's extractor. */
export function appendFrontmatterCitation(
  content: string,
  format: string,
  citation: Citation,
  filePath?: string,
): string {
  const label = filePath ?? "the page";
  const extractor = extractorFor(format);
  // Element-backed metadata (html, xml) has `apply` too, but it is not
  // frontmatter. Whether this *page* can take a block is `apply`'s call:
  // markdown creates one, asciidoc and rst refuse when none exists.
  if (!extractor.apply || !readsFencedFrontmatter(extractor, label)) {
    throw new CiteError(`${label} has no frontmatter to write to. Use --inline.`);
  }
  const extracted = extractor.extract(content, label);
  if (locateFrontmatter(content)?.flavor === "toml") {
    throw new CiteError(
      `${label} has TOML frontmatter; manni cannot add a citations table without re-emitting the whole block, which would drop its comments. Add the entry by hand, or use --inline.`,
    );
  }

  const raw: unknown = extracted.data.citations ?? [];
  if (!Array.isArray(raw)) {
    throw new CiteError(`${label}: \`citations\` is not a list; edit it by hand.`);
  }
  // `isArray` narrows `unknown` to `any[]`; name the element type before it spreads.
  const existing: unknown[] = raw;
  // Field order as given; an undefined optional field must not become `null`.
  const entry = Object.fromEntries(
    Object.entries(citation).filter(([, v]) => v !== undefined),
  );
  try {
    return extractor.apply(content, { citations: [...existing, entry] });
  } catch (e) {
    if (e instanceof DocmetaError) throw new CiteError(`${label}: ${e.message}`);
    throw e;
  }
}

/** Plain YAML scalars that would read back as something other than the string. */
function needsYamlQuotes(value: string): boolean {
  return (
    value === "" ||
    /^[\s!&*?|>'"%@`{}[\],#]/.test(value) ||
    /^-(\s|$)/.test(value) ||
    /:\s|\s#|:$|\s$/.test(value) ||
    /^(?:true|false|null|~|yes|no|on|off|[-+]?(?:\d[\d_]*\.?\d*|\.\d+)(?:e[-+]?\d+)?)$/i.test(value)
  );
}

/** `"…"` with the escapes YAML and JSON share. */
const doubleQuote = (value: string): string => JSON.stringify(value);
const singleQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Split a `key: value` line into its lead (`  - src: `), the scalar, and what
 * trails it (a comment, a JSON comma). Undefined when the line does not carry
 * `field`.
 */
function splitScalarLine(
  line: string,
  field: string,
): { lead: string; scalar: string; trail: string } | undefined {
  const keyed = new RegExp(`^(\\s*(?:-\\s+)?"?${field}"?\\s*:\\s*)(.*)$`).exec(line);
  const lead = keyed?.[1];
  const rest = keyed?.[2];
  if (lead === undefined || rest === undefined) return undefined;
  const quote = rest.charAt(0);
  let end: number;
  if (quote === '"' || quote === "'") {
    end = -1;
    for (let i = 1; i < rest.length; i++) {
      const ch = rest.charAt(i);
      if (quote === '"' && ch === "\\") {
        i++;
      } else if (ch === quote) {
        if (quote === "'" && rest.charAt(i + 1) === "'") {
          i++;
          continue;
        }
        end = i + 1;
        break;
      }
    }
    if (end < 0) return undefined;
  } else {
    const comment = /\s#/.exec(rest);
    end = comment ? comment.index : rest.length;
    while (end > 0 && /\s/.test(rest.charAt(end - 1))) end--;
  }
  return { lead, scalar: rest.slice(0, end), trail: rest.slice(end) };
}

/** Replace the scalar on the `src:` (or `integrity:`/`commit:`) line of entry N. */
export function spliceEntryField(
  content: string,
  format: string,
  index: number,
  field: "src" | "integrity" | "commit",
  value: string,
): string {
  const refuse = (): CiteError =>
    new CiteError(`Cannot rewrite citations[${index}].${field} in ${format} frontmatter; edit it by hand.`);
  const extractor = extractorFor(format);
  const pointer = `/citations/${index}/${field}`;
  // `lineFor` walks up to the nearest recorded ancestor when the exact
  // pointer is unknown (TOML records top-level keys only), so the line it
  // names is checked for the field before anything is touched.
  const line = extractor.extract(content, "page").lineFor(pointer);
  if (line === undefined) throw refuse();
  const start = offsetOfLine(content, line);
  const nl = content.indexOf("\n", start);
  let end = nl === -1 ? content.length : nl;
  if (end > start && content.charAt(end - 1) === "\r") end--;
  const parts = splitScalarLine(content.slice(start, end), field);
  if (!parts) throw refuse();

  const quote = parts.scalar.charAt(0);
  const spelled =
    quote === '"' ? doubleQuote(value)
    : quote === "'" ? singleQuote(value)
    : needsYamlQuotes(value) ? doubleQuote(value)
    : value;
  const out = content.slice(0, start) + parts.lead + spelled + parts.trail + content.slice(end);

  // Read it back: a splice that lands anywhere but on that one value is a
  // refusal, not a damaged page.
  const check: unknown = extractor.extract(out, "page").data.citations;
  const written: unknown = Array.isArray(check) ? check[index] : undefined;
  const readBack =
    written !== null && typeof written === "object" ? (written as Record<string, unknown>)[field] : undefined;
  if (readBack !== value) throw refuse();
  return out;
}

/** Insert a statement line before the line containing `offset`, with the page's EOL. */
export function insertStatementBefore(
  content: string,
  offset: number,
  statement: string,
): string {
  const start = offsetOfLine(content, lineAt(content, offset));
  return content.slice(0, start) + statement + detectEol(content) + content.slice(start);
}

/** Replace the statement text between `start` and `end`. */
export function replaceStatement(
  content: string,
  start: number,
  end: number,
  statement: string,
): string {
  if (start < 0 || end < start || end > content.length) {
    throw new CiteError(`Cannot replace a statement at ${start}-${end} in a page of ${content.length} characters.`);
  }
  return content.slice(0, start) + statement + content.slice(end);
}

type Edit = { op: " " | "-" | "+"; text: string };

const splitLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** A unified diff of two texts, `---`/`+++` headers with the same label. */
export function unifiedDiff(label: string, before: string, after: string): string {
  const a = splitLines(before);
  const b = splitLines(after);
  // Shared prefix and suffix leave the LCS table to the lines that differ.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  if (x.length === 0 && y.length === 0) return "";

  const width = y.length + 1;
  const lcs = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        x[i] === y[j]
          ? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0);
    }
  }
  const edits: Edit[] = a.slice(0, head).map((text) => ({ op: " ", text }));
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    const xi = x[i];
    const yj = y[j];
    if (xi !== undefined && yj !== undefined && xi === yj) {
      edits.push({ op: " ", text: xi });
      i++;
      j++;
    } else if (xi !== undefined && (yj === undefined || (lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0))) {
      // Deletions before insertions on a tie, as unified diffs read.
      edits.push({ op: "-", text: xi });
      i++;
    } else if (yj !== undefined) {
      edits.push({ op: "+", text: yj });
      j++;
    }
  }
  edits.push(...a.slice(a.length - tail).map((text) => ({ op: " " as const, text })));

  // Hunks: each change with one line of context; hunks whose context touches merge.
  const CONTEXT = 1;
  const out = [`--- ${label}`, `+++ ${label}`];
  let pos = 0;
  while (pos < edits.length) {
    if (edits[pos]?.op === " ") {
      pos++;
      continue;
    }
    const from = Math.max(0, pos - CONTEXT);
    let to = pos;
    for (let k = pos; k < edits.length; k++) {
      if (edits[k]?.op !== " ") to = k;
      else if (k - to > CONTEXT * 2) break;
    }
    to = Math.min(edits.length - 1, to + CONTEXT);
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < from; k++) {
      const op = edits[k]?.op;
      if (op !== "+") oldStart++;
      if (op !== "-") newStart++;
    }
    const slice = edits.slice(from, to + 1);
    const oldCount = slice.filter((e) => e.op !== "+").length;
    const newCount = slice.filter((e) => e.op !== "-").length;
    out.push(
      `@@ -${oldCount === 0 ? oldStart - 1 : oldStart},${oldCount} +${newCount === 0 ? newStart - 1 : newStart},${newCount} @@`,
      ...slice.map((e) => e.op + e.text),
    );
    pos = to + 1;
  }
  return out.join("\n") + "\n";
}
