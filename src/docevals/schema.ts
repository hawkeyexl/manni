/**
 * The published frontmatter schema — manni docevals' implementation of the
 * common vocabulary docmeta proposes as `manni:evals:1.0.0-proposal.2`
 * (docmeta proposal 0023). docmeta publishes the vocabulary; this repo ships a
 * schema for it and implements the graders behind it. Consumers point their
 * validator at the shipped file (or import the object directly).
 *
 *   manni meta validate --schema node_modules/@hawkeyexl/manni/schemas/docevals/frontmatter-1.1.0.json docs/
 *
 * In a manni docevals config, a `tool:docmeta` eval references it the same way:
 *
 *   options:
 *     schemas: ["node_modules/@hawkeyexl/manni/schemas/docevals/frontmatter-1.1.0.json"]
 *
 * **1.0.0 still ships and is still byte-identical.** Its bytes are frozen once
 * published, so tracking proposal.2 — which added `weight`, `target`, `runs`
 * and `model` — meant a new file rather than an edit. Every 1.0.0 page is valid
 * against 1.1.0; the four fields are optional additions. A consumer that pinned
 * 1.0.0 by path or by `$id` keeps resolving it, which is the whole point of not
 * editing it.
 */
import { join } from "node:path";
import { packageRoot } from "../shared/package-root.js";
import schema from "../../schemas/docevals/frontmatter-1.1.0.json" with { type: "json" };

/** Every schema version this package ships, newest first. */
export const FRONTMATTER_SCHEMA_VERSIONS = ["1.1.0", "1.0.0"] as const;

/** The current schema object, for validators that accept an inline schema. */
export const frontmatterSchema = schema as Record<string, unknown>;

/** Canonical `$id` of the current published schema. */
export const FRONTMATTER_SCHEMA_ID = frontmatterSchema.$id as string;

/**
 * Absolute path to the shipped schema file, for validators that take a path.
 * Resolves against the installed package, so it works from any working
 * directory.
 */
export function frontmatterSchemaPath(): string {
  return join(
    packageRoot(import.meta.url),
    "schemas",
    "docevals",
    "frontmatter-1.1.0.json",
  );
}
