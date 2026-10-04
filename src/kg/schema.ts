/**
 * The page vocabulary manni kg implements: `manni:graph:1.0.0`, the built-in
 * schema the metadata tool publishes under `src/meta/schemas/`. It defines the
 * `graph:` block a page carries. Pages are validated against that schema
 * itself, imported and bundled into the build, so kg and `manni meta validate`
 * read the same bytes.
 *
 * kg ships no copy of the schema. A copy is a second artifact to keep in step,
 * with nothing but a test to say the two still match. A consumer who wants to
 * validate pages names `manni:graph:1.0.0` to `manni meta validate`, or
 * validates programmatically against the object below.
 */
import schema from "../meta/schemas/graph/1.0.0.json" with { type: "json" };

/** The graph vocabulary, for validators that accept an inline schema. */
export const frontmatterSchema = schema as Record<string, unknown>;

/** The vocabulary's `$id`: `manni:graph:1.0.0`. */
export const FRONTMATTER_SCHEMA_ID: string = schema.$id;
