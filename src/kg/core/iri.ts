/**
 * Deterministic IRI minting. Every node in the graph gets a stable IRI derived
 * from the base IRI plus repo-relative paths, heading slugs, or concept labels —
 * never blank nodes. Identical inputs mint identical IRIs on every OS.
 */
import { slug as githubSlug } from "github-slugger";

/** Default base when the config sets none: valid, deterministic, obviously placeholder. */
export const DEFAULT_BASE_IRI = "urn:dockg:";

/** Normalize a config base IRI; http(s) bases get a trailing slash. */
export function resolveBaseIri(base: string | undefined): string {
  if (!base) return DEFAULT_BASE_IRI;
  if (base.endsWith("/") || base.endsWith(":")) return base;
  return `${base}/`;
}

/** Repo-relative path with forward slashes and no leading `./`. */
export function normalizeDocPath(p: string): string {
  let out = p.replace(/\\/g, "/");
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

/** RFC 3986 strict percent-encoding of one path segment (UTF-8 for non-ASCII). */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `{base}doc/{repo-relative-path}`, segment-wise percent-encoded. */
export function mintDocIri(base: string, relPath: string): string {
  const path = normalizeDocPath(relPath)
    .split("/")
    .map(encodeSegment)
    .join("/");
  return `${base}doc/${path}`;
}

/** `{docIri}#{slug}` — the slug comes pre-disambiguated from analysis. */
export function mintSectionIri(docIri: string, slugValue: string): string {
  return `${docIri}#${slugValue}`;
}

/** Stateless GitHub-style slug; identical labels always converge. */
export function conceptSlug(label: string): string {
  return githubSlug(label);
}

/** `{base}concept/{slug(label)}` — one shared namespace for all concepts. */
export function mintConceptIri(base: string, label: string): string {
  return `${base}concept/${encodeSegment(conceptSlug(label))}`;
}

/**
 * `{base}product/{slug(label)}` — iiRDS ProductVariant nodes (kg.applies-to).
 * Separate `product/` segment so a product and a concept sharing a label
 * cannot converge on one IRI.
 */
export function mintProductIri(base: string, label: string): string {
  return `${base}product/${encodeSegment(conceptSlug(label))}`;
}

/** The single skos:ConceptScheme node for the graph. */
export function mintSchemeIri(base: string): string {
  return `${base}scheme`;
}

/**
 * The kind of actor an agent IRI names, mirroring PROV-O's three
 * `prov:Agent` subclasses. Segmenting by kind keeps a person and a model
 * whose names slug alike ("GPT 4" / "gpt-4") from merging into one node.
 */
export type AgentKind = "person" | "org" | "software";

/** `{base}agent/{kind}/{slug(name)}`. */
export function mintAgentIri(
  base: string,
  kind: AgentKind,
  name: string,
): string {
  return `${base}agent/${kind}/${encodeSegment(conceptSlug(name))}`;
}

/** The graph itself as a prov:Entity. */
export function mintGraphIri(base: string): string {
  return `${base}graph`;
}

/** The build run as a prov:Activity. */
export function mintBuildActivityIri(base: string): string {
  return `${base}activity/build`;
}
