/**
 * The page vocabulary manni docevals implements: `manni:evals:1.0.0-proposal.3`,
 * the evals draft proposal 0023 publishes for review. Pages are validated
 * against the draft itself, imported from `docs/proposals/` and bundled into
 * the build, so the built CLI never reads `docs/` at runtime.
 *
 * docevals ships no copy of the schema. A copy is a second artifact to keep in
 * step with the draft, and the copies it used to publish drifted from it: they
 * kept `eval-provenance` and the `info` severity after proposal 0046 removed
 * both. A consumer who wants to validate pages with `manni meta validate`
 * copies the draft into their repository, as the citations vocabulary's
 * consumers do, or validates programmatically against the object below.
 */
import schema from "../../docs/proposals/0023/schemas/evals/1.0.0-proposal.3.json" with { type: "json" };

/** The evals draft, for validators that accept an inline schema. */
export const frontmatterSchema = schema as Record<string, unknown>;

/** The draft's `$id`: `manni:evals:1.0.0-proposal.3`. */
export const FRONTMATTER_SCHEMA_ID: string = schema.$id;
