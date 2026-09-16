/**
 * Surgical YAML edits (ported from docevals). Only the frontmatter block is
 * re-serialized via the `yaml` Document API — the page body is carried over
 * byte-for-byte, and untouched YAML keeps its comments and ordering. When a
 * file has no frontmatter, a new block holding only the `kg` key is created.
 * YAML frontmatter only; TOML/JSON frontmatter cannot be edited in place.
 */
import { Document, YAMLMap, YAMLSeq, isMap, parseDocument } from "yaml";
import { DockgError } from "../types.js";

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
  const bom = content.charCodeAt(0) === 0xfeff ? content[0]! : "";
  const body = bom ? content.slice(1) : content;
  const openMatch = /^---(\r?\n)/.exec(body);
  if (!openMatch) return null;
  const eol: "\n" | "\r\n" = openMatch[1] === "\r\n" ? "\r\n" : "\n";
  const lines = body.split(/(?<=\n)/); // keep line endings
  let offset = lines[0]!.length;
  for (let i = 1; i < lines.length; i++) {
    const stripped = lines[i]!.replace(/\r?\n$/, "");
    if (stripped === "---" || stripped === "...") {
      const blockEnd = offset;
      return {
        open: bom + lines[0]!,
        block: body.slice(lines[0]!.length, blockEnd),
        suffix: body.slice(blockEnd),
        eol,
      };
    }
    offset += lines[i]!.length;
  }
  throw new DockgError(`${path}: unterminated frontmatter block`);
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

/**
 * Apply proposed values to the top-level `kg` map of a doc's frontmatter.
 * Existing field values win unless `force`. The body after the closing fence
 * is byte-identical to the input.
 */
export function applyKgFields(
  content: string,
  path: string,
  values: Record<string, unknown>,
  options: { force?: boolean; alwaysOverwrite?: string[] } = {},
): KgApplyResult {
  const entries = Object.entries(values).filter(
    ([, v]) =>
      v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return { content, applied: [], skipped: [] };

  if (frontmatterKind(content) === "unsupported") {
    throw new DockgError(
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
      target[segments[segments.length - 1]!] = value;
    }
    const doc = new Document({ kg: nested });
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
    throw new DockgError(
      `${path}: cannot edit frontmatter — ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }

  let kg = doc.get("kg", true);
  if (kg !== undefined && !isMap(kg)) {
    throw new DockgError(`${path}: frontmatter key "kg" is not a map`);
  }
  if (kg === undefined) {
    kg = doc.createNode({});
    doc.set("kg", kg);
  }
  const kgMap = kg as YAMLMap;

  const applied: string[] = [];
  const skipped: string[] = [];
  const alwaysOverwrite = new Set(options.alwaysOverwrite ?? []);
  for (const [field, value] of entries) {
    // A dotted name addresses a nested field — `sections.<slug>.type` writes
    // into kg.sections.<slug>.type (ADR 01032). Preservation is decided at the
    // *leaf*, so filling one section's type never disturbs a value a human set
    // on the section beside it.
    const segments = field.split(".");
    const leaf = segments[segments.length - 1]!;
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
    if (target.has(leaf) && !options.force && !alwaysOverwrite.has(field)) {
      skipped.push(field);
      continue;
    }
    setField(doc, target, leaf, value);
    applied.push(field);
  }

  if (applied.length === 0) {
    return { content, applied, skipped };
  }

  let newBlock = doc.toString();
  if (split.eol === "\r\n") newBlock = newBlock.replace(/(?<!\r)\n/g, "\r\n");
  return { content: split.open + newBlock + split.suffix, applied, skipped };
}

/**
 * One `kg.provenance` entry, spelled as it is serialized — these property names
 * go straight to YAML, so they are the vocabulary's kebab keys, not camelCase
 * twins that would have to be translated on the way out.
 */
export interface ProvenanceEntry {
  "generated-by": string;
  fields: string[];
  /** Per-field model confidence 0..1 for the fields it wrote (ADR 01015). */
  confidence?: Record<string, number>;
}

/**
 * True when `kg.provenance` is the deprecated single-object shape that
 * `docmeta:kg` dropped (dockg 0.2/0.3 wrote it).
 *
 * `existingProvenance` cannot read that shape — `manni kg validate` rejects it, so
 * merging from it would let fill write frontmatter the tool's own validator
 * refuses (ADR 01023). But `provenance` is overwritten wholesale on every fill,
 * so reading nothing would *silently* delete another model's outstanding review
 * record. Callers use this to refuse the file instead.
 */
export function hasLegacyProvenance(content: string): boolean {
  const split = splitYamlFrontmatter(content, "");
  if (split === null) return false;
  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) return false;
  const plain = (doc.toJS() as { kg?: { provenance?: unknown } } | null)?.kg
    ?.provenance;
  return !!plain && typeof plain === "object" && !Array.isArray(plain);
}

/**
 * The doc's existing kg.provenance entries (for merging across runs).
 * `docmeta:kg` stores an array, one entry per model; the deprecated
 * single-object form is not read — see `hasLegacyProvenance` (ADR 01023).
 */
export function existingProvenance(content: string): ProvenanceEntry[] {
  const split = splitYamlFrontmatter(content, "");
  if (split === null) return [];
  const doc = parseDocument(split.block);
  if (doc.errors.length > 0) return [];
  const plain = (doc.toJS() as { kg?: { provenance?: unknown } } | null)?.kg
    ?.provenance;
  const raw = Array.isArray(plain) ? plain : [];
  const entries: ProvenanceEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record["generated-by"] !== "string") continue;
    const conf = record["confidence"];
    const confidence: Record<string, number> = {};
    if (conf && typeof conf === "object" && !Array.isArray(conf)) {
      for (const [k, v] of Object.entries(conf as Record<string, unknown>)) {
        if (typeof v === "number") confidence[k] = v;
      }
    }
    entries.push({
      "generated-by": record["generated-by"],
      fields: Array.isArray(record["fields"])
        ? record["fields"].filter((f): f is string => typeof f === "string")
        : [],
      ...(Object.keys(confidence).length > 0 ? { confidence } : {}),
    });
  }
  return entries;
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
