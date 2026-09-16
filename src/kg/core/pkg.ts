/**
 * The one asset that ships with the package and is read by path at runtime: the
 * SHACL shapes. They live under `shapes/kg/` at the package root, listed in
 * `files`, and are reached through the shared package-root walk, which holds
 * both in the source tree (`src/kg/core/`) and in the bundle (`dist/`).
 *
 * The frontmatter schema is no longer one of them. The `kg` page vocabulary is
 * proposal 0023's draft, imported by `src/kg/schema.ts` and inlined by the
 * build, so nothing under `schemas/kg/` is read at run time and nothing under
 * it is published (proposal 0051 §4).
 */
import { join } from "node:path";
import { packageRoot } from "../../shared/package-root.js";

/** Absolute path of the bundled SHACL shapes `manni kg check` defaults to. */
export function bundledShapesPath(moduleUrl: string): string {
  return join(packageRoot(moduleUrl), "shapes", "kg", "shapes-1.0.0.ttl");
}
