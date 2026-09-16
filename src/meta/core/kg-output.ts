/**
 * `x-manni-kg-output` (proposal 0051 §5): whether a top-level key belongs in a
 * published knowledge graph. kg harvests frontmatter into Turtle, JSON-LD,
 * iiRDS and a search index, all of which get published, and which fields belong
 * in that output is a property of the field rather than of the tool — so it is
 * recorded where the field is defined.
 *
 * The keyword is registered on every Ajv meta builds (validator.ts), next to
 * `x-manni-location`, and like it records where it was evaluated. Ajv's own
 * resolution is the walker, so a mark counts through `$ref`, `allOf` and a
 * referenced built-in, and inside the `anyOf`, `oneOf` and `if`/`then` branches
 * Ajv takes. Absent means `true`: every field is harvested unless a schema says
 * otherwise. Only a top-level property's mark counts; a mark nested inside `kg`
 * is accepted and ignored, as 0047 rule 2 ignores a nested `x-manni-location`.
 * `Validator.kgOutputPreferences` is the one question a tool asks of it.
 *
 * Why this is not `x-manni-location` (0051 stress test 3): the two answer
 * different questions. `x-manni-location` says where a field is *written* — in
 * the page or in a manifest — and says nothing about whether a delivered
 * artifact should carry it. A field can be `external` and still belong in the
 * graph (`authors` on a published page), or be page-local and not belong in it
 * at all. Overloading one mark would make `manni meta relocate` a publishing
 * decision.
 */

/** The schema keyword. */
export const KG_OUTPUT_KEYWORD = "x-manni-kg-output";
