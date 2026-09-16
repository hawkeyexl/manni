/**
 * Assets that ship with the package and are read by path at runtime: the
 * bundled frontmatter schema and the SHACL shapes. They live under
 * `schemas/kg/` and `shapes/kg/` at the package root, listed in `files`, and
 * are reached through the shared package-root walk, which holds both in the
 * source tree (`src/kg/core/`) and in the bundle (`dist/`).
 */
import { join } from "node:path";
import { packageRoot } from "../../shared/package-root.js";

export { packageRoot };

/**
 * Absolute path of the bundled frontmatter schema `manni kg validate`
 * defaults to.
 *
 * These are the metadata tool's bytes, not this tool's: manni publishes the
 * common metadata vocabularies and the kg tool implements graph behavior
 * against them (ADR 01023). The draft lives at
 * `docs/proposals/0023/schemas/kg/1.0.0-proposal.1.json` in this repository
 * and is copied here verbatim so it ships in the package. Proposal 0023 is
 * still under review and forbids registering the id until it concludes, so
 * the copy is reached by path. The hash pin in
 * test/kg/unit/kg-vocabulary.test.ts is what notices the two drifting apart.
 */
export function bundledSchemaPath(moduleUrl: string): string {
  return join(
    packageRoot(moduleUrl),
    "schemas",
    "kg",
    "manni-kg-1.0.0-proposal.1.json",
  );
}

/** Absolute path of the bundled SHACL shapes `manni kg check` defaults to. */
export function bundledShapesPath(moduleUrl: string): string {
  return join(packageRoot(moduleUrl), "shapes", "kg", "dockg-1.0.0.ttl");
}
