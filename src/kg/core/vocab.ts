/**
 * Namespace table. Standard vocabularies wherever a term exists; the custom
 * `kg:` namespace stays minimal, and the newest vocabulary document under
 * `ns/` defines every term it holds — a bidirectional drift guard in
 * test/kg/unit/vocabulary.test.ts enforces both directions. Neither the term
 * count nor the version is written here: both went stale the first time a term
 * was added, and the guard resolves the file rather than naming it. The prefix
 * set is fixed — every emitted graph carries the same header.
 *
 * The custom prefix is `kg:` and its namespace is the manni site's, which is
 * where it dereferences (proposal 0051 §7). Both were `dockg` until the tool
 * joined the family, and kg ADR 01030's rule — the namespace IRI must resolve
 * — is why they moved rather than staying: `hawkeyexl.github.io/dockg` never
 * served anything and never will.
 *
 * `kg:` is also the frontmatter section key, and the two are still different
 * things: the key names a block an author writes, the prefix abbreviates an
 * IRI in emitted RDF. They no longer carry different *spellings*, because
 * under `…/manni/kg/ns#` any other spelling would be a third name for the
 * same tool. Nothing collides: no other prefix in this table is `kg`, and a
 * `kg:` CURIE typed at `--predicates` or `--s` expanded to nothing before.
 */
export const NS = {
  dcterms: "http://purl.org/dc/terms/",
  foaf: "http://xmlns.com/foaf/0.1/",
  iirds: "http://iirds.tekom.de/iirds#",
  iirdsSft: "http://iirds.tekom.de/iirds/domain/software#",
  kg: "https://hawkeyexl.github.io/manni/kg/ns#",
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
 * the deliberately small kg vocabulary.
 */
export const ROLE = {
  author: `${NS.kg}authorRole`,
  generator: `${NS.kg}generatorRole`,
  tool: `${NS.kg}toolRole`,
} as const;
