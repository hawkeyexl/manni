/**
 * Surgical eval append. Only the YAML frontmatter block is re-serialized
 * via the `yaml` Document API — everything from the closing fence onward is
 * carried over byte-for-byte, and untouched YAML keeps its comments, ordering,
 * and style. Artifacts with no frontmatter get a block synthesized above the
 * untouched body, which is the common case for CLAUDE.md / AGENTS.md.
 *
 * Writing is an authoring-time operation, never part of evaluation (ADR 01005).
 */
import {
  Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  parseDocument,
  type YAMLSeq,
} from "yaml";
import { mergeMetaProvenance } from "../../meta/internal.js";
import { TracevalsError } from "../types.js";
import { METADATA_KEY } from "./external.js";
import type { Severity } from "./extract.js";

/** An eval to add. Mirrors the artifact-evals object entry form. */
export interface NewEvalEntry {
  id: string;
  assertion?: string;
  type?: "capability" | "regression";
  grader?: string;
  options?: Record<string, unknown>;
  severity?: Severity;
  evidence?: string;
  examples?: { pass?: string[]; fail?: string[] };
}

/** U+FEFF. A file that opens with it keeps it, byte for byte. */
const BOM = "\uFEFF";

interface Split {
  /** BOM plus the opening fence line, including its newline. */
  open: string;
  /** Raw YAML between the fences. */
  block: string;
  /** Closing fence to EOF, byte-identical. */
  suffix: string;
  eol: "\n" | "\r\n";
}

/** Frontmatter dialect an artifact opens with, or undefined when it has none. */
function leadingFormat(content: string): "yaml" | "toml" | "json" | undefined {
  const body = content.startsWith(BOM) ? content.slice(1) : content;
  if (/^---\r?\n/.test(body)) return "yaml";
  if (/^\+\+\+\r?\n/.test(body)) return "toml";
  if (/^;;;\r?\n/.test(body)) return "json";
  return undefined;
}

function splitYamlFrontmatter(content: string, path: string): Split {
  const bom = content.startsWith(BOM) ? BOM : "";
  const body = bom ? content.slice(1) : content;
  const openMatch = /^---(\r?\n)/.exec(body);
  if (!openMatch) {
    throw new TracevalsError(`${path}: no YAML frontmatter block to edit`);
  }
  const eol: "\n" | "\r\n" = openMatch[1] === "\r\n" ? "\r\n" : "\n";
  // Split but keep line endings. `body` opens with the `---` fence, so the
  // first element is that line; the destructuring default only satisfies the
  // type, which `noUncheckedIndexedAccess` widens to `string | undefined`.
  const [fence = body, ...rest] = body.split(/(?<=\n)/);
  let offset = fence.length;
  for (const line of rest) {
    const stripped = line.replace(/\r?\n$/, "");
    if (stripped === "---" || stripped === "...") {
      return {
        open: bom + fence,
        block: body.slice(fence.length, offset),
        suffix: body.slice(offset),
        eol,
      };
    }
    offset += line.length;
  }
  throw new TracevalsError(`${path}: unterminated frontmatter block`);
}

/** Ordered plain object for one eval entry, with absent fields dropped. */
function entryObject(entry: NewEvalEntry): Record<string, unknown> {
  const obj: Record<string, unknown> = { id: entry.id };
  // Optional since proposal.2. Emitting the key unconditionally would write
  // `assertion: null` for a deterministic grader, which the schema rejects —
  // the opposite of the point of letting it be omitted.
  if (entry.assertion !== undefined) obj.assertion = entry.assertion;
  if (entry.type !== undefined) obj.type = entry.type;
  if (entry.grader !== undefined) obj.grader = entry.grader;
  if (entry.options !== undefined) obj.options = entry.options;
  if (entry.severity !== undefined) obj.severity = entry.severity;
  if (entry.evidence !== undefined) obj.evidence = entry.evidence;
  if (entry.examples !== undefined) obj.examples = entry.examples;
  return obj;
}

/**
 * Existing eval ids. String-shorthand entries are id-less — their identity is
 * positional — so they never collide with an id'd append.
 */
function existingIds(seq: YAMLSeq): Set<string> {
  const ids = new Set<string>();
  for (const item of seq.items) {
    if (isMap(item)) {
      const id = item.get("id");
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

/**
 * A key present with an empty value parses to a null node, not `undefined`.
 * `metadata:` with nothing under it is ordinary in the wild, so treat it as
 * the absent case and fill it in rather than refusing to write.
 */
function isEmptyNode(node: unknown): boolean {
  return node === undefined || node === null || isNullScalar(node);
}

function isNullScalar(node: unknown): boolean {
  return isScalar(node) && node.value === null;
}

/**
 * Locate the `metadata.evals` list, creating each missing level.
 *
 * The single-string block (`evals: <assertion>`) is a legal authored shape that
 * is not a list. Rewriting it into one would move a human's assertion and
 * silently give it a new positional id, so refuse instead and say what to do.
 */
function evalsSeq(doc: Document, path: string): YAMLSeq {
  const existing = doc.getIn(["metadata", "evals"], true);
  if (!isEmptyNode(existing)) {
    if (isScalar(existing) && typeof existing.value === "string") {
      throw new TracevalsError(
        `${path}: metadata.evals is a single assertion string; expand it to a list before appending`,
      );
    }
    if (!isSeq(existing)) {
      throw new TracevalsError(`${path}: metadata.evals is not a list`);
    }
    return existing;
  }
  const node = doc.getIn(["metadata"], true);
  if (isEmptyNode(node)) {
    doc.setIn(["metadata"], doc.createNode({}));
  } else if (!isMap(node)) {
    throw new TracevalsError(`${path}: metadata is not a mapping`);
  }
  const seq = doc.createNode([]) as YAMLSeq;
  doc.setIn(["metadata", "evals"], seq);
  return seq;
}

/**
 * Attribution for machine-proposed evals. A human deletes the entry once those
 * evals are reviewed, which is what makes the trail useful rather than noise.
 */
export interface EvalProvenance {
  /**
   * Model that proposed the evals, by the name its provider reports. A bare
   * model name, never `provider:model`: the criterion axis of the
   * self-preference check compares this against the judge's `modelName()`, and
   * a composed spelling made that comparison one it could never win.
   */
  generatedBy: string;
  /** Per-eval confidence, 0..1, keyed by eval id. */
  confidence: Record<string, number>;
}

/** The key `fill` records machine-proposed evals under (proposal 0046). */
const META_PROVENANCE_KEY = "meta-provenance";

/**
 * Merge one run's attribution into `metadata.meta-provenance`, keyed by
 * `generated-by`. A repeat fill by the same model extends its existing entry
 * rather than adding a second one the consumer would have to reconcile.
 *
 * The merge itself is `mergeMetaProvenance`, the one `manni meta fill` and
 * `manni docevals fill` use, so all three tools record attribution one way and
 * the shape has a single owner. What stays here is the splice: reading the
 * held value out of the document and writing the merged list back.
 */
function mergeProvenance(
  doc: Document,
  provenance: EvalProvenance,
  ids: string[],
): void {
  if (ids.length === 0) return;
  // `getIn` hands back a node for a collection, and the family merge reads a
  // plain value, so the held block is converted before it crosses over.
  const node: unknown = doc.getIn(["metadata", META_PROVENANCE_KEY], true);
  const held = isEmptyNode(node)
    ? undefined
    : isNode(node)
      ? (node.toJSON() as unknown)
      : node;
  const merged = mergeMetaProvenance(
    held,
    provenance.generatedBy,
    "evals",
    ids.map((id) => ({ name: id, confidence: provenance.confidence[id] ?? 0 })),
  );
  if (!merged) {
    throw new TracevalsError(`metadata.${META_PROVENANCE_KEY} is not a list`);
  }
  doc.setIn(
    ["metadata", META_PROVENANCE_KEY],
    doc.createNode(merged.list),
  );
}

/**
 * The same append over a `metadata` block that is not in the page: the value an
 * external-metadata manifest holds for this artifact (proposal 0047). Returns
 * the new block, for `spliceManifestValue` to write.
 *
 * A plain value in and a plain value out, because a manifest entry is rewritten
 * by meta's splice writer rather than re-serialized here — the comment and key
 * order preservation `appendArtifactEvals` gets from editing YAML nodes is that
 * writer's job on this path. The refusals are the page path's, for the page
 * path's reasons: an id that already exists means the caller's dedupe missed
 * something, and a single-assertion block is a human's sentence that must not
 * be silently given a positional id.
 */
export function appendMetadataEvals(
  held: unknown,
  label: string,
  entries: NewEvalEntry[],
  provenance?: EvalProvenance,
): Record<string, unknown> {
  const block: Record<string, unknown> =
    held === undefined || held === null
      ? {}
      : typeof held === "object" && !Array.isArray(held)
        ? { ...(held as Record<string, unknown>) }
        : (() => {
            throw new TracevalsError(`${label}: metadata is not a mapping`);
          })();

  const existing = block.evals;
  if (typeof existing === "string") {
    throw new TracevalsError(
      `${label}: metadata.evals is a single assertion string; expand it to a list before appending`,
    );
  }
  if (existing !== undefined && existing !== null && !Array.isArray(existing)) {
    throw new TracevalsError(`${label}: metadata.evals is not a list`);
  }

  const list: unknown[] = Array.isArray(existing)
    ? [...(existing as unknown[])]
    : [];
  const taken = new Set<string>();
  for (const item of list) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const id = (item as Record<string, unknown>).id;
      if (typeof id === "string") taken.add(id);
    }
  }
  for (const entry of entries) {
    if (taken.has(entry.id)) {
      throw new TracevalsError(
        `${label}: eval "${entry.id}" already exists in ${METADATA_KEY}`,
      );
    }
    taken.add(entry.id);
    list.push(entryObject(entry));
  }
  block.evals = list;

  if (provenance !== undefined && entries.length > 0) {
    const merged = mergeMetaProvenance(
      block[META_PROVENANCE_KEY],
      provenance.generatedBy,
      "evals",
      entries.map((e) => ({
        name: e.id,
        confidence: provenance.confidence[e.id] ?? 0,
      })),
    );
    if (!merged) {
      throw new TracevalsError(`${label}: metadata.${META_PROVENANCE_KEY} is not a list`);
    }
    block[META_PROVENANCE_KEY] = merged.list;
  }
  return block;
}

/**
 * Append evals to an artifact's `metadata.evals`, returning the new file
 * content. Throws when the frontmatter is not YAML or when an id already
 * exists — a collision means the caller's dedupe missed something, and
 * silently overwriting a human-authored eval is never right.
 *
 * When `provenance` is given, the same splice also records the machine
 * attribution under `metadata.meta-provenance`.
 */
export function appendArtifactEvals(
  content: string,
  path: string,
  entries: NewEvalEntry[],
  provenance?: EvalProvenance,
): string {
  if (entries.length === 0) return content;

  const format = leadingFormat(content);
  if (format === "toml" || format === "json") {
    // Synthesizing a YAML block would leave the artifact with two
    // frontmatter blocks; only YAML can be edited in place.
    throw new TracevalsError(
      `${path}: only YAML frontmatter can be edited (found ${format} frontmatter)`,
    );
  }

  const bom = content.startsWith(BOM) ? BOM : "";
  const stripped = bom ? content.slice(1) : content;

  if (format === undefined) {
    const eol: "\n" | "\r\n" = stripped.includes("\r\n") ? "\r\n" : "\n";
    const doc = new Document({
      metadata: { evals: entries.map(entryObject) },
    });
    if (provenance) {
      mergeProvenance(
        doc,
        provenance,
        entries.map((e) => e.id),
      );
    }
    let block = doc.toString({ lineWidth: 0 });
    if (eol === "\r\n") block = block.replace(/(?<!\r)\n/g, "\r\n");
    return `${bom}---${eol}${block}---${eol}${stripped}`;
  }

  const { open, block, suffix, eol } = splitYamlFrontmatter(content, path);
  const doc = parseDocument(block);
  if (doc.errors.length > 0) {
    throw new TracevalsError(
      `${path}: cannot edit frontmatter — ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }

  let seq: YAMLSeq;
  try {
    seq = evalsSeq(doc, path);
  } catch (err) {
    // A block that is valid YAML but not a mapping (a sequence, a bare
    // scalar, a `---` that was really a thematic break) makes the yaml
    // library throw its own error type. Callers are promised TracevalsError.
    if (err instanceof TracevalsError) throw err;
    throw new TracevalsError(
      `${path}: cannot edit frontmatter — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const taken = existingIds(seq);
  for (const entry of entries) {
    if (taken.has(entry.id)) {
      throw new TracevalsError(
        `${path}: eval "${entry.id}" already exists in frontmatter`,
      );
    }
    taken.add(entry.id);
    seq.add(doc.createNode(entryObject(entry)));
  }

  if (provenance) {
    try {
      mergeProvenance(
        doc,
        provenance,
        entries.map((e) => e.id),
      );
    } catch (err) {
      if (err instanceof TracevalsError) {
        throw new TracevalsError(`${path}: ${err.message}`);
      }
      throw err;
    }
  }

  // lineWidth 0 disables folding: skill descriptions routinely run past 80
  // columns, and reflowing one the user did not touch is gratuitous churn.
  let updated = doc.toString({ lineWidth: 0 });
  if (eol === "\r\n") updated = updated.replace(/(?<!\r)\n/g, "\r\n");
  return open + updated + suffix;
}
