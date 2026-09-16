/**
 * Surgical YAML edits (ported from docevals). Only the frontmatter block is
 * re-serialized via the `yaml` Document API — the page body is carried over
 * byte-for-byte, and untouched YAML keeps its comments and ordering. When a
 * file has no frontmatter, a new block holding only the `kg` key is created.
 * YAML frontmatter only; TOML/JSON frontmatter cannot be edited in place.
 */
import { Document, YAMLMap, YAMLSeq, isMap, parseDocument } from "yaml";
import { KgError } from "../types.js";

interface Split {
  /** The opening fence line including its newline (plus any BOM). */
  open: string;
  /** Raw YAML between the fences. */
  block: string;
  /** Everything from the closing fence to EOF, byte-identical. */
  suffix: string;
  /** Line ending style of the file. */
  eol: "\n" | "\r\n";
}

/**
 * What kind of frontmatter block a file opens with. docmeta reads TOML (+++)
 * and JSON (;;;) fences too, but only YAML is editable in place — callers
 * must not treat "unsupported" as "absent" or they will stack a second block.
 */
export function frontmatterKind(
  content: string,
): "yaml" | "unsupported" | "none" {
  const body = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  if (/^---(\r?\n)/.test(body)) return "yaml";
  if (/^(\+\+\+|;;;)(\r?\n)/.test(body)) return "unsupported";
  return "none";
}

function splitYamlFrontmatter(content: string, path: string): Split | null {
  // `slice` rather than `content[0]`: it yields a string for an empty input
  // too, which is the only case the index could have missed.
  const bom = content.charCodeAt(0) === 0xfeff ? content.slice(0, 1) : "";
  const body = bom ? content.slice(1) : content;
  const openMatch = /^---(\r?\n)/.exec(body);
  if (!openMatch) return null;
  const eol: "\n" | "\r\n" = openMatch[1] === "\r\n" ? "\r\n" : "\n";
  // `String.split` always yields at least one element, and the regex matched
  // `---\n` at the start, so the first line is the opening fence.
  const [openLine = "", ...rest] = body.split(/(?<=\n)/); // keep line endings
  let offset = openLine.length;
  for (const line of rest) {
    const stripped = line.replace(/\r?\n$/, "");
    if (stripped === "---" || stripped === "...") {
      const blockEnd = offset;
      return {
        open: bom + openLine,
        block: body.slice(openLine.length, blockEnd),
        suffix: body.slice(blockEnd),
        eol,
      };
    }
    offset += line.length;
  }
  throw new KgError(`${path}: unterminated frontmatter block`);
}

export interface KgApplyResult {
  content: string;
  /** Fields written. */
  applied: string[];
  /** Fields left alone because a human-set value exists (and no force). */
  skipped: string[];
}

/** Render every sequence under `node` flow-style: [a, b]. */
function flowSeqs(node: unknown): void {
  if (node instanceof YAMLSeq) {
    node.flow = true;
    for (const item of node.items) flowSeqs(item);
  } else if (node instanceof YAMLMap) {
    for (const item of node.items) flowSeqs(item.value);
  }
}

/** Set `value` on the kg map; arrays (incl. nested) render flow-style. */
function setField(
  doc: Document,
  kg: YAMLMap,
  field: string,
  value: unknown,
): void {
  const node = doc.createNode(value);
  flowSeqs(node);
  kg.set(field, node);
}

export interface KgApplyOptions {
  /** Overwrite values a human already set. */
  force?: boolean;
  /**
   * Keys to write at the TOP level of the frontmatter, beside `kg` rather
   * than inside it — `meta-provenance` is the one caller (proposal 0046).
   * They are always overwritten, because the caller computes each value
   * whole, and they are written even when `values` is empty. Kept in this
   * one function so a fill is still one parse and one serialization of the
   * block, and the body stays byte-identical either way.
   */
  page?: Record<string, unknown>;
}

/**
 * Apply proposed values to the top-level `kg` map of a doc's frontmatter, plus
 * any `options.page` keys beside it. Existing field values win unless `force`.
 * The body after the closing fence is byte-identical to the input.
 */
export function applyKgFields(
  content: string,
  path: string,
  values: Record<string, unknown>,
  options: KgApplyOptions = {},
): KgApplyResult {
  const entries = Object.entries(values).filter(
    ([, v]) =>
      v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  );
  const pageEntries = Object.entries(options.page ?? {});
  if (entries.length === 0 && pageEntries.length === 0) {
    return { content, applied: [], skipped: [] };
  }

  if (frontmatterKind(content) === "unsupported") {
    throw new KgError(
      `${path}: only YAML frontmatter can be edited (found a TOML/JSON fence)`,
    );
  }

  const split = splitYamlFrontmatter(content, path);

  if (split === null) {
    // No frontmatter — create a block holding only the kg key. Dotted names
    // nest here too, or `sections.intro.type` would become a literal key.
    const eol: "\n" | "\r\n" = content.includes("\r\n") ? "\r\n" : "\n";
    const nested: Record<string, unknown> = {};
    for (const [field, value] of entries) {
      const segments = field.split(".");
      let target = nested;
      for (const segment of segments.slice(0, -1)) {
        target[segment] ??= {};
        target = target[segment] as Record<string, unknown>;
      }
      // An undotted field is its own leaf, so `field` is the right fallback
      // rather than a stand-in: `split(".")` cannot return an empty list.
      target[segments.at(-1) ?? field] = value;
    }
    const doc = new Document({
      ...Object.fromEntries(pageEntries),
      ...(entries.length > 0 ? { kg: nested } : {}),
    });
    const kg = doc.get("kg", true);
    if (isMap(kg)) flowSeqs(kg);
    let block = doc.toString();
    if (eol === "\r\n") block = block.replace(/(?<!\r)\n/g, "\r\n");
    return {
      content: `---${eol}${block}---${eol}${eol}${content}`,
      applied: entries.map(([k]) => k),
      skipped: [],
    };
  }

  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) {
    throw new KgError(
      `${path}: cannot edit frontmatter — ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }

  let kg = doc.get("kg", true);
  if (kg !== undefined && !isMap(kg)) {
    throw new KgError(`${path}: frontmatter key "kg" is not a map`);
  }
  if (kg === undefined && entries.length > 0) {
    kg = doc.createNode({});
    doc.set("kg", kg);
  }
  const kgMap = (kg ?? doc.createNode({})) as YAMLMap;

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const [field, value] of entries) {
    // A dotted name addresses a nested field — `sections.<slug>.type` writes
    // into kg.sections.<slug>.type (ADR 01032). Preservation is decided at the
    // *leaf*, so filling one section's type never disturbs a value a human set
    // on the section beside it.
    const segments = field.split(".");
    // An undotted field is its own leaf, so `field` is the right fallback
    // rather than a stand-in: `split(".")` cannot return an empty list.
    const leaf = segments.at(-1) ?? field;
    let target = kgMap;
    let missingParent = false;
    for (const segment of segments.slice(0, -1)) {
      const existing = target.get(segment, true);
      if (existing === undefined) {
        const created = doc.createNode({}) as YAMLMap;
        target.set(segment, created);
        target = created;
      } else if (isMap(existing)) {
        target = existing;
      } else {
        // A non-map where a map must go: leave the author's value alone rather
        // than overwrite a shape we do not understand.
        missingParent = true;
        break;
      }
    }
    if (missingParent) {
      skipped.push(field);
      continue;
    }
    if (target.has(leaf) && !options.force) {
      skipped.push(field);
      continue;
    }
    setField(doc, target, leaf, value);
    applied.push(field);
  }

  // Top-level keys, after the kg map so a new `kg` sorts where it always did.
  // Block style, not `flowSeqs`: this is a record a reviewer reads and edits
  // by hand, one entry per line, not a value the graph derives from.
  for (const [key, value] of pageEntries) {
    doc.set(key, doc.createNode(value));
  }

  if (applied.length === 0 && pageEntries.length === 0) {
    return { content, applied, skipped };
  }

  let newBlock = doc.toString();
  if (split.eol === "\r\n") newBlock = newBlock.replace(/(?<!\r)\n/g, "\r\n");
  return { content: split.open + newBlock + split.suffix, applied, skipped };
}

/** The doc's parsed frontmatter as plain data, `{}` when there is none. */
function frontmatterData(content: string): Record<string, unknown> {
  const split = splitYamlFrontmatter(content, "");
  if (split === null) return {};
  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) return {};
  const plain = doc.toJS() as unknown;
  return plain !== null && typeof plain === "object" && !Array.isArray(plain)
    ? (plain as Record<string, unknown>)
    : {};
}

/**
 * True when the doc still carries a `kg.provenance` key, in any shape.
 *
 * Proposal 0046 closed the `kg` block on fifteen properties and `provenance`
 * is not one of them: field attribution is the page-level `meta-provenance`
 * now. A page holding the old key validates nowhere and is read by nothing, so
 * a fill that wrote beside it would leave an outstanding review record no
 * review queue lists. Callers use this to refuse the file and name the
 * migration instead.
 */
export function hasKgProvenance(content: string): boolean {
  const kg = frontmatterData(content)["kg"];
  return (
    kg !== null &&
    typeof kg === "object" &&
    !Array.isArray(kg) &&
    (kg as Record<string, unknown>)["provenance"] !== undefined
  );
}

/**
 * The doc's page-level `meta-provenance` value, exactly as held — `undefined`
 * when the page has none. Uncoerced on purpose: `mergeMetaProvenance` decides
 * what a non-list means, and every key of an entry it does not know is carried
 * through, so a `docevals` entry survives a `kg fill`.
 */
export function existingMetaProvenance(content: string): unknown {
  return frontmatterData(content)["meta-provenance"];
}

/** Fields already present on the doc's `kg` map ([] when none). */
export function existingKgFields(content: string): string[] {
  const split = splitYamlFrontmatter(content, "");
  if (split === null) return [];
  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) return [];
  const kg = doc.get("kg", true);
  if (!isMap(kg)) return [];
  return kg.items
    .map((item) => {
      const value = (item.key as { value?: unknown }).value;
      return typeof value === "string" || typeof value === "number"
        ? String(value)
        : "";
    })
    .filter((k) => k.length > 0);
}
