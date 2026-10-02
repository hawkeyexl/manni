/**
 * The page vocabulary manni docevals implements: `manni:evals:1.0.0`, the
 * built-in schema the metadata tool publishes under `src/meta/schemas/`.
 * Pages are validated against that schema itself, imported and bundled into
 * the build, so docevals and `manni meta validate` read the same bytes.
 *
 * docevals ships no copy of the schema. A copy is a second artifact to keep in
 * step, and the copies it used to publish drifted from the draft they copied:
 * they kept `eval-provenance` and the `info` severity after proposal 0046
 * removed both. A consumer who wants to validate pages names
 * `manni:evals:1.0.0` to `manni meta validate`, or validates programmatically
 * against the object below.
 */
import schema from "../meta/schemas/evals/1.0.0.json" with { type: "json" };

/** The evals vocabulary, for validators that accept an inline schema. */
export const frontmatterSchema = schema as Record<string, unknown>;

/** The vocabulary's `$id`: `manni:evals:1.0.0`. */
export const FRONTMATTER_SCHEMA_ID: string = schema.$id;
