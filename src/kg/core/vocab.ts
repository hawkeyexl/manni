/**
 * Namespace table. Standard vocabularies wherever a term exists; the custom
 * `dockg:` namespace stays minimal, and the newest vocabulary document under
 * `ns/` defines every term it holds — a bidirectional drift guard in
 * test/unit/vocabulary.test.ts enforces both directions. Neither the term count
 * nor the version is written here: both went stale the first time a term was
 * added, and the guard resolves the file rather than naming it. The prefix set
 * is fixed — every emitted graph carries the same header.
 */
export const NS = {
  dcterms: "http://purl.org/dc/terms/",
  dockg: "https://hawkeyexl.github.io/dockg/ns#",
  foaf: "http://xmlns.com/foaf/0.1/",
  iirds: "http://iirds.tekom.de/iirds#",
  iirdsSft: "http://iirds.tekom.de/iirds/domain/software#",
  prov: "http://www.w3.org/ns/prov#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  schema: "https://schema.org/",
  skos: "http://www.w3.org/2004/02/skos/core#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
} as const;

export type Prefix = keyof typeof NS;

/** Prefixes in emission order (sorted by prefix name). */
export const PREFIXES: ReadonlyArray<[Prefix, string]> = (
  Object.entries(NS) as Array<[Prefix, string]>
).sort(([a], [b]) => (a < b ? -1 : 1));

export const RDF_TYPE = `${NS.rdf}type`;

/**
 * Role individuals for qualified provenance (prov:hadRole objects). Part of
 * the deliberately small dockg vocabulary.
 */
export const ROLE = {
  author: `${NS.dockg}authorRole`,
  generator: `${NS.dockg}generatorRole`,
  tool: `${NS.dockg}toolRole`,
} as const;
