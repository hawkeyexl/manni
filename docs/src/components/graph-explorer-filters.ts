import type { ExplorerNode } from "./graph-explorer-model.js";

export const metadataOperators = [
  "is",
  "contains",
  "present",
  "missing",
] as const;
export type MetadataOperator = (typeof metadataOperators)[number];
export interface MetadataFilter {
  field: string;
  operator: MetadataOperator;
  value: string;
}
type Metadata = ReadonlyMap<string, Record<string, unknown>>;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function atPointer(data: Record<string, unknown>, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  let value: unknown = data;
  for (const segment of pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment))
      return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}
const scalar = (value: unknown): value is string | number | boolean | null =>
  value === null || ["string", "number", "boolean"].includes(typeof value);
const valuesOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(scalar).map(String);

export function metadataFields(metadata: Metadata): string[] {
  const fields = new Set<string>();
  const walk = (data: Record<string, unknown>, base: string, depth: number) => {
    for (const [key, value] of Object.entries(data)) {
      const path = `${base}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      fields.add(path);
      if (
        depth < 4 &&
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      )
        walk(value as Record<string, unknown>, path, depth + 1);
    }
  };
  for (const data of metadata.values()) walk(data, "", 0);
  return [...fields].sort(compare);
}
export function metadataValues(metadata: Metadata, field: string): string[] {
  return [
    ...new Set(
      [...metadata.values()].flatMap((data) =>
        valuesOf(atPointer(data, field)),
      ),
    ),
  ].sort(compare);
}

export function filterMetadata(
  nodes: ExplorerNode[],
  metadata: Metadata,
  contentType: string,
  filters: MetadataFilter[],
): ExplorerNode[] {
  const active = filters.filter(
    (filter) =>
      filter.field &&
      (["present", "missing"].includes(filter.operator) || filter.value !== ""),
  );
  if (!contentType && !active.length) return nodes;
  return nodes.filter((node) => {
    const data = metadata.get(node.path);
    if (!data) return false;
    if (contentType && !valuesOf(data.type).includes(contentType)) return false;
    return active.every((filter) => {
      const value = atPointer(data, filter.field);
      if (filter.operator === "present") return value !== undefined;
      if (filter.operator === "missing") return value === undefined;
      const wanted = filter.value.toLowerCase();
      return valuesOf(value).some((item) =>
        filter.operator === "contains"
          ? item.toLowerCase().includes(wanted)
          : item.toLowerCase() === wanted,
      );
    });
  });
}

export function readMetadataFilters(raw: string[]): MetadataFilter[] {
  const filters: MetadataFilter[] = [];
  for (const encoded of raw) {
    try {
      const item: unknown = JSON.parse(encoded);
      if (!Array.isArray(item) || item.length !== 3) continue;
      const parts: unknown[] = item;
      const [field, operator, value] = parts;
      if (
        typeof field !== "string" ||
        !field.startsWith("/") ||
        typeof value !== "string"
      )
        continue;
      const validOperator = metadataOperators.find(
        (candidate) => candidate === operator,
      );
      if (validOperator)
        filters.push({ field, operator: validOperator, value });
    } catch {
      /* Malformed shared URL conditions never execute or break loading. */
    }
  }
  return filters;
}
