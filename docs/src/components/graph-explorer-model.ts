import { GraphIndex } from "../../../src/graph/runtime/graph.js";
import {
  readMetadataFilters,
  type MetadataFilter,
} from "./graph-explorer-filters.js";

export const kinds = [
  "Document",
  "Section",
  "Concept",
  "Audience",
  "Persona",
  "Journey",
  "Other",
];
export interface ExplorerNode {
  id: string;
  title: string;
  description: string;
  kind: string;
  path: string;
  properties: { predicate: string; values: string[] }[];
}
export interface ExplorerEdge {
  source: string;
  target: string;
  predicate: string;
}
export interface ExplorerModel {
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
}
/** Choose within supplied candidates, changing nodes whenever alternatives exist. */
export function randomNode(
  nodes: ExplorerNode[],
  selected: string,
  random: () => number = Math.random,
): string | undefined {
  const alternatives = nodes.filter((node) => node.id !== selected);
  const candidates = alternatives.length ? alternatives : nodes;
  return candidates[Math.floor(random() * candidates.length)]?.id;
}
/** A visible clicked node keeps priority over transient pointer or keyboard hover. */
export function highlightSeed(
  nodes: ExplorerNode[],
  pinned: string,
  hovered: string,
): string {
  if (pinned && nodes.some((node) => node.id === pinned)) return pinned;
  return hovered && nodes.some((node) => node.id === hovered) ? hovered : "";
}
/** Visible, one-hop neighbors in either direction; hover never changes the graph scope. */
export function hoverNeighborhood(
  edges: ExplorerEdge[],
  seed: string,
): Set<string> {
  const related = new Set<string>();
  if (!seed) return related;
  related.add(seed);
  for (const edge of edges) {
    if (edge.source === seed) related.add(edge.target);
    if (edge.target === seed) related.add(edge.source);
  }
  return related;
}
export function sameConnection(
  a: ExplorerEdge | undefined,
  b: ExplorerEdge,
): boolean {
  return Boolean(
    a &&
    ((a.source === b.source && a.target === b.target) ||
      (a.source === b.target && a.target === b.source)),
  );
}

/** Closest point on each segment, in graph coordinates; callers scale the hit radius. */
export function nearestEdge(
  edges: ExplorerEdge[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  x: number,
  y: number,
  radius: number,
): ExplorerEdge | undefined {
  let closest: ExplorerEdge | undefined;
  let distance = radius * radius;
  for (const edge of edges) {
    const from = positions.get(edge.source);
    const to = positions.get(edge.target);
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    if (!length) continue;
    const fraction = Math.max(
      0,
      Math.min(1, ((x - from.x) * dx + (y - from.y) * dy) / length),
    );
    const squared =
      (x - from.x - fraction * dx) ** 2 + (y - from.y - fraction * dy) ** 2;
    if (squared <= distance) {
      distance = squared;
      closest = edge;
    }
  }
  return closest;
}
export interface ExplorerState {
  node: string;
  highlight: string;
  focus: string;
  q: string;
  types: string[];
  relation: string;
  depth: 1 | 2;
  view: "graph" | "list";
  contentType: string;
  metadata: MetadataFilter[];
}

export const defaults = (): ExplorerState => ({
  node: "",
  highlight: "",
  focus: "",
  q: "",
  types: [],
  relation: "",
  depth: 1,
  view: "graph",
  contentType: "",
  metadata: [],
});
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pick the closest node within a touch-sized target, after undoing pan and zoom. */
export function nearestNode(
  nodes: ExplorerNode[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  x: number,
  y: number,
  radius: number,
): string | undefined {
  let nearest: string | undefined;
  let distance = radius * radius;
  for (const node of nodes) {
    const point = positions.get(node.id);
    if (!point) continue;
    const squared = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (squared <= distance) {
      nearest = node.id;
      distance = squared;
    }
  }
  return nearest;
}

/** The existing meta get JSON contract, narrowed before it crosses the UI boundary. */
export function authoringMetadata(
  input: unknown,
): Map<string, Record<string, unknown>> {
  if (!Array.isArray(input)) throw new Error("Invalid authoring metadata");
  const metadata = new Map<string, Record<string, unknown>>();
  for (const item of input as unknown[]) {
    if (
      !item ||
      typeof item !== "object" ||
      !("file" in item) ||
      typeof item.file !== "string" ||
      !("values" in item) ||
      !item.values ||
      typeof item.values !== "object" ||
      Array.isArray(item.values)
    )
      throw new Error("Invalid authoring metadata");
    metadata.set(item.file, item.values as Record<string, unknown>);
  }
  return metadata;
}

/** Adapt the existing runtime's expanded graph; never mutate it for D3. */
export function explorerModel(input: object): ExplorerModel {
  if (!("@graph" in input) || !Array.isArray(input["@graph"]))
    throw new Error("Invalid graph");
  const index = GraphIndex.fromJsonLd(input);
  const nodes: ExplorerNode[] = [];
  const edges: ExplorerEdge[] = [];
  for (const id of index.ids()) {
    const raw = index.node(id);
    if (!raw || raw.props.size === 0) continue;
    const types = raw.types.map((t) => index.compact(t));
    const kind = types.includes("schema:PeopleAudience")
      ? "Persona"
      : types.includes("schema:Audience")
        ? "Audience"
        : types.includes("graph:Journey")
          ? "Journey"
          : types.includes("graph:Document")
            ? "Document"
            : types.some((t) => t.endsWith(":Section"))
              ? "Section"
              : types.includes("skos:Concept")
                ? "Concept"
                : "Other";
    const literal = (key: string) => index.literal(id, index.expand(key)) ?? "";
    let fallback = id.split(/[\/#]/).at(-1) || id;
    try {
      fallback = decodeURI(fallback);
    } catch {
      /* Opaque identifiers can contain literal percent signs. */
    }
    const title =
      literal("dcterms:title") ||
      literal("skos:prefLabel") ||
      literal("rdfs:label") ||
      fallback;
    nodes.push({
      id,
      title,
      kind,
      path: literal("graph:path"),
      description: literal("dcterms:description"),
      properties: [...raw.props].map(([p, values]) => ({
        predicate: index.compact(p),
        values: values.map((v) => v.value),
      })),
    });
    for (const edge of index.out(id)) {
      // Vocabulary class references describe nodes; they are not navigation edges.
      if (index.compact(edge.predicate) !== "rdf:type")
        edges.push({
          source: id,
          target: edge.target,
          predicate: index.compact(edge.predicate),
        });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const documentPaths = new Map(
    nodes.filter((n) => n.kind === "Document").map((n) => [n.id, n.path]),
  );
  for (const node of nodes) {
    if (node.kind === "Section" && !node.path)
      node.path = documentPaths.get(node.id.split("#")[0] ?? "") ?? "";
  }
  // A strategy node's source is the record document whose primary topic it is.
  for (const edge of edges) {
    if (edge.predicate !== "foaf:primaryTopic") continue;
    const source = nodes.find((n) => n.id === edge.source);
    const target = nodes.find((n) => n.id === edge.target);
    if (source && target && !target.path) {
      target.path = source.path;
      if (!target.description) target.description = source.description;
    }
  }
  nodes.sort(
    (a, b) =>
      compare(a.title.toLowerCase(), b.title.toLowerCase()) ||
      compare(a.id, b.id),
  );
  return {
    nodes,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

export function filterNodes(
  nodes: ExplorerNode[],
  query: string,
  types: string[],
  _relation: string,
): ExplorerNode[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return nodes.filter(
    (n) =>
      (!types.length || types.includes(n.kind)) &&
      words.every((word) =>
        `${n.title} ${n.description} ${n.id} ${n.path}`
          .toLowerCase()
          .includes(word),
      ),
  );
}

/** Both directions, with a visited set: incoming page → journey edges matter. */
export function neighborhood(
  model: ExplorerModel,
  seed: string,
  depth: number,
  predicate: string,
): ExplorerNode[] {
  const reached = new Map([[seed, 0]]);
  let frontier = new Set([seed]);
  for (let hop = 0; hop < depth; hop++) {
    const next = new Set<string>();
    for (const edge of model.edges) {
      if (predicate && edge.predicate !== predicate) continue;
      if (frontier.has(edge.source) && !reached.has(edge.target))
        next.add(edge.target);
      if (frontier.has(edge.target) && !reached.has(edge.source))
        next.add(edge.source);
    }
    for (const id of next) reached.set(id, hop + 1);
    frontier = next;
  }
  const priority = [
    "Persona",
    "Audience",
    "Journey",
    "Document",
    "Concept",
    "Section",
    "Other",
  ];
  return model.nodes
    .filter((n) => reached.has(n.id))
    .sort(
      (a, b) =>
        (reached.get(a.id) ?? 0) - (reached.get(b.id) ?? 0) ||
        priority.indexOf(a.kind) - priority.indexOf(b.kind) ||
        compare(a.title, b.title),
    );
}

export function readState(hash: string): ExplorerState {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return {
    node: params.get("node") ?? "",
    highlight: params.get("highlight") ?? "",
    focus: params.get("focus") ?? "",
    q: params.get("q") ?? "",
    types: [...new Set(params.getAll("type").filter((t) => kinds.includes(t)))],
    relation: params.get("relation") ?? "",
    depth: params.get("depth") === "2" ? 2 : 1,
    view: params.get("view") === "list" ? "list" : "graph",
    contentType: params.get("contentType") ?? "",
    metadata: readMetadataFilters(params.getAll("meta")),
  };
}

export function writeState(state: ExplorerState): string {
  const params = new URLSearchParams();
  for (const key of ["node", "highlight", "focus", "q", "relation"] as const)
    if (state[key]) params.set(key, state[key]);
  for (const kind of state.types) params.append("type", kind);
  if (state.contentType) params.set("contentType", state.contentType);
  for (const filter of state.metadata)
    if (filter.field)
      params.append(
        "meta",
        JSON.stringify([filter.field, filter.operator, filter.value]),
      );
  params.set("depth", String(state.depth));
  params.set("view", state.view);
  return `#${params.toString()}`;
}

export function sourceLinks(
  path: string,
  base: string,
  commit: string,
): { page?: string; source?: string } {
  if (
    !path ||
    !/^[\w./-]+$/.test(path) ||
    path.split("/").some((s) => s === "." || s === "..") ||
    !path.startsWith("docs/")
  )
    return {};
  const source = `https://github.com/hawkeyexl/manni/blob/${encodeURIComponent(commit || "main")}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const prefix = "docs/src/content/docs/";
  if (!path.startsWith(prefix)) return { source };
  const route = path
    .slice(prefix.length)
    .replace(/(?:^|\/)index\.mdx?$/, "")
    .replace(/\.mdx?$/, "")
    .replace(/\/$/, "");
  return {
    source,
    page: `${base.replace(/\/$/, "")}/${route ? `${route}/` : ""}`,
  };
}

export const relationLabel = (predicate: string): string =>
  ({
    "schema:audience": "serves",
    "dcterms:isPartOf": "belongs to",
    "foaf:primaryTopic": "describes",
    "graph:linksTo": "links to",
    "dcterms:references": "references",
    "skos:broader": "broader concept",
    "skos:related": "related concept",
  })[predicate] ??
  predicate
    .split(":")
    .at(-1)
    ?.replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase() ??
  predicate;
