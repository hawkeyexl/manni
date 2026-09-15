/**
 * Surgical YAML edits. Only the frontmatter block (or the named config eval)
 * is re-serialized via the `yaml` Document API — the page body is carried
 * over byte-for-byte, and untouched YAML keeps its comments and ordering.
 * YAML frontmatter only; TOML/JSON frontmatter cannot be edited in place.
 */
import { parseDocument, Document, YAMLMap, YAMLSeq, isMap, isScalar } from "yaml";
import { DocevalsError } from "../types.js";
import { leadingFrontmatterFormat } from "./discover.js";

/** Top-level key manni docevals owns inside the shared manni config. */
const NAMESPACE = "docevals";

/** The byte-order mark a page may open with, carried through edits untouched. */
const BOM = "\uFEFF";

export interface EvalUpdates {
  grader?: string;
  command?: string[];
  /** sha256 of the assertion at generation time; flat, per the vocabulary. */
  "generated-assertion-hash"?: string;
}

interface Split {
  /** The opening fence line including its newline. */
  open: string;
  /** Raw YAML between the fences. */
  block: string;
  /** Everything from the closing fence to EOF, byte-identical. */
  suffix: string;
  /** Line ending style of the file. */
  eol: "\n" | "\r\n";
}

function splitYamlFrontmatter(content: string, path: string): Split {
  const bom = content.startsWith(BOM) ? BOM : "";
  const body = bom ? content.slice(1) : content;
  const openMatch = /^---(\r?\n)/.exec(body);
  if (!openMatch) {
    throw new DocevalsError(
      `${path}: no YAML frontmatter block to edit (only YAML frontmatter is editable)`,
    );
  }
  const eol: "\n" | "\r\n" = openMatch[1] === "\r\n" ? "\r\n" : "\n";
  // Keep line endings. The match above guarantees an opening line.
  const [openLine = "", ...rest] = body.split(/(?<=\n)/);
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
  throw new DocevalsError(`${path}: unterminated frontmatter block`);
}

function applyUpdates(
  doc: Document,
  node: YAMLMap,
  updates: EvalUpdates,
): void {
  if (updates.grader !== undefined) node.set("grader", updates.grader);
  if (updates.command !== undefined) {
    const seq = doc.createNode(updates.command) as YAMLSeq;
    seq.flow = true; // ["node", "script.mjs", "{file}"] on one line
    node.set("command", seq);
  }
  const hash = updates["generated-assertion-hash"];
  if (hash !== undefined) node.set("generated-assertion-hash", hash);
}

/**
 * The eval list. `evals` is the list itself, or the single-assertion string
 * shorthand — which has no map node to edit, so it is not a sequence here.
 */
function evalSeq(doc: Document): YAMLSeq | undefined {
  const node = doc.get("evals", true);
  return node instanceof YAMLSeq ? node : undefined;
}

function findEvalNode(
  doc: Document,
  evalName: string,
): YAMLMap | undefined {
  const evals = evalSeq(doc);
  if (!evals) return undefined;
  for (const item of evals.items) {
    if (isMap(item)) {
      const name = item.get("id") ?? item.get("use");
      if (name === evalName) return item;
    }
  }
  return undefined;
}

/**
 * Update an inline eval in a page's YAML frontmatter. Returns the new file
 * content; the body after the closing fence is byte-identical to the input.
 */
export function updatePageEval(
  content: string,
  path: string,
  evalName: string,
  updates: EvalUpdates,
): string {
  const { open, block, suffix, eol } = splitYamlFrontmatter(content, path);
  const doc = parseDocument(block);
  if (doc.errors.length > 0) {
    throw new DocevalsError(
      `${path}: cannot edit frontmatter — ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }
  const node = findEvalNode(doc, evalName);
  if (!node) {
    throw new DocevalsError(
      `${path}: eval "${evalName}" not found in frontmatter`,
    );
  }
  applyUpdates(doc, node, updates);
  let newBlock = doc.toString();
  if (eol === "\r\n") newBlock = newBlock.replace(/(?<!\r)\n/g, "\r\n");
  return open + newBlock + suffix;
}

/**
 * Update a named eval in manni.config.yaml text.
 *
 * The eval library lives under the tool's own namespace — `manni.config.yaml`
 * is shared across the manni family. Navigating to a root `evals:` finds
 * nothing in a real config, so generation for a config-sourced eval failed
 * with "eval not found in config" against every file the loader accepts.
 */
export function updateConfigEval(
  configText: string,
  configPath: string,
  evalName: string,
  updates: EvalUpdates,
): string {
  const doc = parseDocument(configText);
  if (doc.errors.length > 0) {
    throw new DocevalsError(
      `${configPath}: cannot edit config — ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }
  const node = doc.getIn([NAMESPACE, "evals", evalName]);
  if (!isMap(node)) {
    throw new DocevalsError(
      `${configPath}: eval "${evalName}" not found in config`,
    );
  }
  applyUpdates(doc, node, updates);
  return doc.toString();
}

export interface NewEvalEntry {
  /** Kebab-case id. Required on object entries — position-derived names
   *  orphan cached verdicts whenever entries move. */
  id: string;
  assertion: string;
  type?: string;
  grader?: string;
  evidence?: string;
  examples?: { pass?: string | string[]; fail?: string | string[] };
  severity?: string;
}

/** Ordered plain object for a new inline eval, with undefined fields dropped. */
function entryObject(entry: NewEvalEntry): Record<string, unknown> {
  const obj: Record<string, unknown> = { id: entry.id, assertion: entry.assertion };
  if (entry.type !== undefined) obj.type = entry.type;
  if (entry.grader !== undefined) obj.grader = entry.grader;
  if (entry.evidence !== undefined) obj.evidence = entry.evidence;
  if (entry.examples !== undefined) obj.examples = entry.examples;
  if (entry.severity !== undefined) obj.severity = entry.severity;
  return obj;
}

/** The page-level key `fill` records machine-proposed evals in (proposal 0046). */
const META_PROVENANCE_KEY = "meta-provenance";

function assertNoCollision(seq: YAMLSeq, name: string, path: string): void {
  for (const item of seq.items) {
    const existing = isMap(item)
      ? item.get("id") ?? item.get("use")
      : isScalar(item)
        ? item.value
        : undefined;
    if (existing === name) {
      throw new DocevalsError(
        `${path}: eval "${name}" already exists in frontmatter`,
      );
    }
  }
}

/**
 * Append inline evals to a page's YAML frontmatter, creating the `evals` key
 * — or the frontmatter block itself — when missing. The body stays
 * byte-identical; existing evals are never modified or reordered.
 *
 * `metaProvenance`, when given, is the page's whole `meta-provenance` list with
 * the new evals already merged in, written in the same edit. The merge is the
 * caller's, as `manni meta fill`'s is, so both tools record attribution one
 * way.
 */
export function appendPageEvals(
  content: string,
  path: string,
  entries: NewEvalEntry[],
  metaProvenance?: readonly unknown[],
): string {
  const format = leadingFrontmatterFormat(content);
  if (format === "toml" || format === "json") {
    // Synthesizing a YAML block here would leave the page with two
    // frontmatter blocks. Only YAML frontmatter can be edited in place.
    throw new DocevalsError(
      `${path}: only YAML frontmatter can be edited (found ${format} frontmatter)`,
    );
  }

  const bom = content.startsWith(BOM) ? BOM : "";
  const stripped = bom ? content.slice(1) : content;
  const eol: "\n" | "\r\n" = stripped.includes("\r\n") ? "\r\n" : "\n";

  if (format === undefined) {
    // No frontmatter: synthesize a block above the untouched body.
    const doc = new Document({ evals: entries.map(entryObject) });
    if (metaProvenance) doc.set(META_PROVENANCE_KEY, doc.createNode(metaProvenance));
    let block = doc.toString();
    if (eol === "\r\n") block = block.replace(/(?<!\r)\n/g, "\r\n");
    return `${bom}---${eol}${block}---${eol}${stripped}`;
  }

  const { open, block, suffix, eol: blockEol } = splitYamlFrontmatter(content, path);
  const doc = parseDocument(block);
  if (doc.errors.length > 0) {
    throw new DocevalsError(
      `${path}: cannot edit frontmatter — ${doc.errors[0]?.message ?? "parse error"}`,
    );
  }

  let seq = evalSeq(doc);
  if (!seq) {
    const node = doc.get("evals", true);
    if (node !== undefined) {
      // A single-assertion string, or something else entirely. Appending would
      // have to rewrite the existing declaration, which is the caller's call to
      // make, not a silent side effect of adding one eval.
      throw new DocevalsError(
        `${path}: the evals key in frontmatter is not a list — expand the ` +
          `string shorthand into a list before appending`,
      );
    }
    seq = doc.createNode([]);
    doc.set("evals", seq);
  }
  for (const entry of entries) {
    assertNoCollision(seq, entry.id, path);
    seq.add(doc.createNode(entryObject(entry)));
  }
  if (metaProvenance) doc.set(META_PROVENANCE_KEY, doc.createNode(metaProvenance));
  let newBlock = doc.toString();
  if (blockEol === "\r\n") newBlock = newBlock.replace(/(?<!\r)\n/g, "\r\n");
  return open + newBlock + suffix;
}

/** True when the eval exists as an editable (map) entry in the frontmatter. */
export function hasEditableEval(content: string, evalName: string): boolean {
  try {
    const { block } = splitYamlFrontmatter(content, "");
    const doc = parseDocument(block);
    return findEvalNode(doc, evalName) !== undefined;
  } catch {
    return false;
  }
}

/** Used by promote: check a string-shorthand eval entry (not editable in place). */
export function isScalarEvalEntry(content: string, evalName: string): boolean {
  try {
    const { block } = splitYamlFrontmatter(content, "");
    const doc = parseDocument(block);
    const evals = evalSeq(doc);
    if (!evals) return false;
    return evals.items.some((i) => isScalar(i) && i.value === evalName);
  } catch {
    return false;
  }
}
