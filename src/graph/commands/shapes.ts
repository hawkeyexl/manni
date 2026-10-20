/**
 * `manni graph shapes` and `manni graph shapes show <shape>`: what the shapes
 * in effect ask for, before a page is written (proposal 0089). The listing
 * names each node shape and what it targets. `show` prints every property a
 * shape checks and the frontmatter key that feeds it, from `sh:name`, and
 * `-f markdown` turns those keys into a frontmatter skeleton.
 *
 * The shapes are the ones `check` would run: `--shapes`, else
 * `graph.check.shapes`, else the bundled file.
 */
import { resolve } from "node:path";
import { DataFactory, type Store } from "n3";
import type { Severity } from "../../shared/severity.js";
import { GraphError } from "../types.js";
import { loadRunConfig } from "../core/config.js";
import { compactIri } from "../core/load.js";
import { bundledShapesPath } from "../core/pkg.js";
import {
  loadShapes,
  localName,
  shapeText,
  type LoadedShapes,
  type ShapesFile,
} from "../core/shacl.js";
import { byCodeUnit } from "../core/sort.js";
import { NS } from "../core/vocab.js";

const SH = "http://www.w3.org/ns/shacl#";

export interface ShapesOptions {
  config?: string;
  /** `--no-config`: skip discovery and use the bundled shapes. */
  noConfig?: boolean;
  /** Shapes .ttl paths (default: config `check.shapes`, then bundled). */
  shapes?: string[];
  cwd?: string;
}

/** One node shape, as `graph shapes` lists it. */
export interface NodeShapeRow {
  /** The shape's local name, such as `DocumentShape`. */
  name: string;
  /** The shapes file's id. */
  id: string;
  /** `"bundled"`, or the path as given. */
  source: string;
  /** What the shape targets: a class IRI, or `objects of <predicate>`. */
  target: string | null;
  closed: boolean;
  description: string | null;
  guide: string | null;
}

/** One property a node shape checks. */
export interface PropertyRow {
  /** The property shape's local name, or `null` for a blank node. */
  rule: string | null;
  /** The predicate IRI. */
  path: string;
  /** The frontmatter key that feeds it (`sh:name`), or `null` when manni writes it. */
  key: string | null;
  min: number;
  max: number | null;
  severity: Severity;
  description: string | null;
}

export interface ShapeDetail extends NodeShapeRow {
  properties: PropertyRow[];
}

/** The listing `graph shapes` prints. */
export interface ShapesList {
  shapes: NodeShapeRow[];
}

/** What `graph shapes show` prints: one block per file that defines the shape. */
export interface ShapesShow {
  shapes: ShapeDetail[];
}

interface Resolved {
  loaded: LoadedShapes;
  sourceOf: Map<ShapesFile, string>;
}

/** The shapes `check` would run, each with the name the listing gives it. */
function resolveShapes(opts: ShapesOptions): Resolved {
  const cwd = opts.cwd ?? process.cwd();
  const config = loadRunConfig(
    {
      ...(opts.config === undefined ? {} : { configPath: opts.config }),
      ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    },
    cwd,
  );
  const given = opts.shapes && opts.shapes.length > 0 ? opts.shapes : config.check.shapes;
  const sources =
    given.length > 0
      ? given.map((p) => ({ path: resolve(cwd, p), label: p }))
      : [bundledShapesPath(import.meta.url)];
  const loaded = loadShapes(sources);
  const sourceOf = new Map<ShapesFile, string>(
    loaded.files.map((file) => [file, given.length > 0 ? file.label : "bundled"]),
  );
  return { loaded, sourceOf };
}

/** Where a shape's file sits in the order the files were given. */
function fileIndex(resolved: Resolved, iri: string): number {
  const file = resolved.loaded.fileOf.get(iri);
  return file === undefined ? 0 : resolved.loaded.files.indexOf(file);
}

const named = (iri: string) => DataFactory.namedNode(iri);

function firstObject(store: Store, subject: string, predicate: string): string | undefined {
  return store
    .getObjects(named(subject), named(predicate), null)
    .map((o) => o.value)
    .sort(byCodeUnit)[0];
}

function nodeShapeRow(resolved: Resolved, iri: string): NodeShapeRow {
  const { loaded, sourceOf } = resolved;
  const file = loaded.fileOf.get(iri) ?? loaded.files[0];
  const store = loaded.store;
  const targetClass = firstObject(store, iri, `${SH}targetClass`);
  const objectsOf = firstObject(store, iri, `${SH}targetObjectsOf`);
  return {
    name: localName(iri),
    id: file?.id ?? "",
    source: file === undefined ? "" : (sourceOf.get(file) ?? file.label),
    target:
      targetClass ?? (objectsOf === undefined ? null : `objects of ${objectsOf}`),
    closed: firstObject(store, iri, `${SH}closed`) === "true",
    description: shapeText(store, named(iri), `${SH}description`),
    guide: file?.guide ?? null,
  };
}

/** Every named node shape in the store, sorted by name. */
function nodeShapes(store: Store): string[] {
  return store
    .getSubjects(named(`${NS.rdf}type`), named(`${SH}NodeShape`), null)
    .filter((s) => s.termType === "NamedNode")
    .map((s) => s.value)
    .sort((a, b) => byCodeUnit(localName(a), localName(b)) || byCodeUnit(a, b));
}

const SEVERITIES: Record<string, Severity> = {
  [`${SH}Violation`]: "error",
  [`${SH}Warning`]: "warning",
  [`${SH}Info`]: "notice",
};

function propertyRows(store: Store, shape: string): PropertyRow[] {
  const rows: PropertyRow[] = [];
  for (const property of store.getObjects(named(shape), named(`${SH}property`), null)) {
    const term =
      property.termType === "BlankNode"
        ? DataFactory.blankNode(property.value)
        : named(property.value);
    const read = (predicate: string): string | undefined =>
      store
        .getObjects(term, named(predicate), null)
        .map((o) => o.value)
        .sort(byCodeUnit)[0];
    const path = read(`${SH}path`);
    if (path === undefined) continue;
    const min = read(`${SH}minCount`);
    const max = read(`${SH}maxCount`);
    rows.push({
      rule: property.termType === "NamedNode" ? localName(property.value) : null,
      path,
      key: shapeText(store, term, `${SH}name`),
      min: min === undefined ? 0 : Number(min),
      max: max === undefined ? null : Number(max),
      severity: SEVERITIES[read(`${SH}severity`) ?? ""] ?? "error",
      description: shapeText(store, term, `${SH}description`),
    });
  }
  return rows.sort(
    (a, b) => byCodeUnit(a.rule ?? "", b.rule ?? "") || byCodeUnit(a.path, b.path),
  );
}

export function runShapes(opts: ShapesOptions = {}): ShapesList {
  const resolved = resolveShapes(opts);
  // Grouped by file, in the order the files were given, then by name.
  const shapes = nodeShapes(resolved.loaded.store).sort(
    (a, b) => fileIndex(resolved, a) - fileIndex(resolved, b),
  );
  return { shapes: shapes.map((iri) => nodeShapeRow(resolved, iri)) };
}

export function runShapesShow(name: string, opts: ShapesOptions = {}): ShapesShow {
  const resolved = resolveShapes(opts);
  const all = nodeShapes(resolved.loaded.store);
  const matching = all.filter((iri) => localName(iri) === name);
  if (matching.length === 0) {
    const available = [...new Set(all.map(localName))].join(", ");
    throw new GraphError(`Unknown shape "${name}". Available: ${available}.`);
  }
  return {
    shapes: matching.map((iri) => ({
      ...nodeShapeRow(resolved, iri),
      properties: propertyRows(resolved.loaded.store, iri),
    })),
  };
}

/** How often a property may occur, in lint's words. */
function occurrence(min: number, max: number | null): string {
  if (max === 0) return "forbidden";
  if (max === null) {
    if (min === 0) return "optional, repeats";
    if (min === 1) return "required, repeats";
    return `at least ${String(min)}`;
  }
  if (min === 1 && max === 1) return "required";
  if (min === 0 && max === 1) return "optional";
  return `${String(min)} to ${String(max)}`;
}

/** Rows of cells, each column padded to its widest cell. */
function columns(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  }
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
}

const compactTarget = (target: string | null): string =>
  target === null
    ? "(no target)"
    : target.startsWith("objects of ")
      ? `objects of ${compactIri(target.slice("objects of ".length))}`
      : compactIri(target);

export function renderShapes(list: ShapesList, format: "pretty" | "json"): string {
  if (format === "json") return JSON.stringify(list, null, 2);
  // One block per file: `runShapes` lists them grouped, in the order given.
  const groups: NodeShapeRow[][] = [];
  for (const shape of list.shapes) {
    const last = groups.at(-1);
    const head = last?.[0];
    if (last !== undefined && head?.id === shape.id && head.source === shape.source) {
      last.push(shape);
    } else {
      groups.push([shape]);
    }
  }
  const blocks: string[] = [];
  for (const rows of groups) {
    const first = rows[0];
    if (first === undefined) continue;
    const lines = [first.source === first.id ? first.id : `${first.id}  (${first.source})`];
    if (first.guide !== null) lines.push(`  Guide: ${first.guide}`);
    lines.push(
      ...columns(
        rows.map((s) => [s.name, compactTarget(s.target), s.description ?? ""]),
      ).map((l) => `  ${l}`),
    );
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

export function renderShapesShow(
  show: ShapesShow,
  format: "pretty" | "json" | "markdown",
): string {
  if (format === "json") return JSON.stringify(show, null, 2);
  if (format === "markdown") return skeleton(show);
  return show.shapes
    .map((shape) => {
      const head = [compactTarget(shape.target), ...(shape.closed ? ["closed"] : [])].join(", ");
      const lines = [`${shape.name}  ${shape.id}  ${head}`];
      if (shape.description !== null) lines.push(`  ${shape.description}`);
      if (shape.guide !== null) lines.push(`  Guide: ${shape.guide}`);
      lines.push("");
      const rows = columns(
        shape.properties.map((p) => {
          const words = [
            occurrence(p.min, p.max),
            ...(p.severity === "error" ? [] : [p.severity]),
          ].join(", ");
          return [p.rule ?? "(unnamed)", compactIri(p.path), p.key === null ? words : `${p.key} · ${words}`];
        }),
      );
      shape.properties.forEach((p, i) => {
        lines.push(`  ${rows[i] ?? ""}`);
        if (p.description !== null) lines.push(`     ${p.description}`);
      });
      return lines.join("\n");
    })
    .join("\n\n");
}

/** A nested key of the skeleton: its comment, its value, or its children. */
interface SkeletonNode {
  comment: string | null;
  required: boolean;
  repeats: boolean;
  children: Map<string, SkeletonNode>;
}

/**
 * A frontmatter skeleton from every `sh:name` the shape carries. A required
 * key is written out and an optional one is commented, each under its
 * description. A dotted key nests, and a parent is commented when every key
 * under it is.
 */
function skeleton(show: ShapesShow): string {
  const root = new Map<string, SkeletonNode>();
  for (const shape of show.shapes) {
    for (const p of shape.properties) {
      if (p.key === null) continue;
      let level = root;
      let node: SkeletonNode | undefined;
      for (const part of p.key.split(".")) {
        node = level.get(part);
        if (node === undefined) {
          node = { comment: null, required: false, repeats: false, children: new Map() };
          level.set(part, node);
        }
        level = node.children;
      }
      if (node === undefined) continue;
      node.comment ??= p.description;
      node.required ||= p.min > 0;
      node.repeats ||= p.max !== 1;
    }
  }
  const first = show.shapes[0];
  if (first === undefined || root.size === 0) {
    throw new GraphError(
      `${first?.name ?? "This shape"} has no frontmatter keys. manni writes every value it checks.`,
    );
  }
  const required = (node: SkeletonNode): boolean =>
    node.children.size === 0 ? node.required : [...node.children.values()].some(required);
  const lines = ["---", `# ${first.name}, ${first.id}`];
  for (const g of [...new Set(show.shapes.map((s) => s.guide))]) {
    if (g !== null) lines.push(`# Guide: ${g}`);
  }
  const write = (level: Map<string, SkeletonNode>, indent: string): void => {
    for (const [key, node] of [...level].sort(([a], [b]) => byCodeUnit(a, b))) {
      const mark = required(node) ? "" : "# ";
      if (node.children.size > 0) {
        lines.push(`${indent}${mark}${key}:`);
        write(node.children, `${indent}  `);
        continue;
      }
      if (node.comment !== null) lines.push(`${indent}# ${node.comment}`);
      lines.push(`${indent}${mark}${key}:${node.repeats ? " []" : ""}`);
    }
  };
  write(root, "");
  lines.push("---");
  return lines.join("\n");
}
