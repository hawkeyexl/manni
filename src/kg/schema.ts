/**
 * The page vocabulary manni kg implements: `manni:graph:1.0.0-proposal.1`, the
 * knowledge-graph draft proposal 0023 publishes for review. It defines the
 * `graph:` block a page carries. Pages are validated against the draft itself,
 * imported from `docs/proposals/` and bundled into the build, so the built CLI
 * never reads `docs/` at runtime.
 *
 * kg ships no copy of the schema. One file is now both the draft under review
 * and the schema the tool enforces, which is what the vendored copy under
 * `schemas/kg/` could only approximate: it was byte-verbatim by convention, and
 * a sha256 pin in the tests is what made that convention honest. With no second
 * artifact there is nothing left for the pin to protect, and no way for the two
 * to drift while every test stays green. A consumer who wants to validate pages
 * with `manni meta validate` copies the draft into their repository, or
 * validates programmatically against the object below.
 */
import schema from "../../docs/proposals/0023/schemas/graph/1.0.0-proposal.1.json" with { type: "json" };

/** The graph draft, for validators that accept an inline schema. */
export const frontmatterSchema = schema as Record<string, unknown>;

/** The draft's `$id`: `manni:graph:1.0.0-proposal.1`. */
export const FRONTMATTER_SCHEMA_ID: string = schema.$id;
