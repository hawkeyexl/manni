/**
 * Fill prompt and proposal schema. The proposal schema is restricted to the
 * fields being requested for the specific doc, so a provider physically
 * cannot propose fields the run should not touch. Alongside the field values,
 * the model returns a per-field `confidence` (0..1) and `reasoning`; the fill
 * command gates on confidence (ADR 01015).
 */
import type { FillField } from "../core/config.js";
import type { DocModel } from "../types.js";

/** Bump when the prompt changes — invalidates the fill cache. */
export const PROMPT_VERSION = 3;

const TOPIC_TYPES = [
  "task",
  "concept",
  "reference",
  "learning",
  "troubleshooting",
  "form",
];
const LIFECYCLE_PHASES = [
  "administration",
  "customization",
  "update",
  "deployment",
  "integration",
  "deinstallation",
];
const SOFTWARE_SUBJECTS = ["architecture", "interface", "system-requirement"];

const labelArray = (description: string) => ({
  type: "array",
  items: { type: "string", minLength: 1 },
  uniqueItems: true,
  description,
});
const enumArray = (values: string[], description: string) => ({
  type: "array",
  items: { enum: values },
  uniqueItems: true,
  description,
});

/** Exported for the schema-sync drift guard (test/unit/schema-sync.test.ts). */
export const FIELD_SCHEMAS: Record<FillField, Record<string, unknown>> = {
  label: {
    type: "string",
    minLength: 1,
    description:
      "Preferred label of the single concept this document is primarily about.",
  },
  "alt-labels": labelArray(
    "Alternative labels: synonyms, abbreviations, common variants.",
  ),
  broader: labelArray("Labels of broader (parent) concepts."),
  narrower: labelArray("Labels of narrower (child) concepts."),
  "related-concepts": labelArray("Labels of associatively related concepts."),
  concepts: labelArray("Subject labels for the document, like tags."),
  type: {
    enum: TOPIC_TYPES,
    description:
      "iiRDS topic type — the functional kind of this page. Only if the page clearly fits one.",
  },
  "applies-to": labelArray(
    "Product/variant names this page applies to. ONLY names the text explicitly states; never guess product names.",
  ),
  "about-product-lifecycle": enumArray(
    LIFECYCLE_PHASES,
    "Software lifecycle phases this page covers, only if clearly evidenced.",
  ),
  "about-product-aspect": enumArray(
    SOFTWARE_SUBJECTS,
    "Software information subjects this page is about, only if clearly evidenced.",
  ),
  "not-applicable-to": labelArray(
    "Product/variant names the text EXPLICITLY says this page does NOT apply to. Only with explicit textual evidence.",
  ),
  "not-about-product-aspect": enumArray(
    SOFTWARE_SUBJECTS,
    "Software subjects the text EXPLICITLY says this page is NOT about. Only with explicit textual evidence.",
  ),
};

/**
 * Memoized by the requested field set. A corpus has only a handful of distinct
 * field combinations, but a fresh schema object per document would defeat the
 * inference library's identity-keyed validator cache and recompile Ajv once per
 * file. The returned object must therefore be treated as immutable.
 */
const schemaCache = new Map<string, Record<string, unknown>>();

/**
 * The `kg` fields a section block accepts (ADR 01013). `label` is absent
 * deliberately — a "primary topic per section" is meaningless, so it is not
 * proposable either.
 */
export const SECTION_FILL_FIELDS: readonly FillField[] = [
  "type",
  "applies-to",
  "about-product-lifecycle",
  "about-product-aspect",
  "not-applicable-to",
  "not-about-product-aspect",
  "concepts",
];

/**
 * @param fields  Document-level fields to offer — narrowed to what this
 *   document is missing, so a provider cannot propose over a human's value.
 * @param options.sections  Section-level fields to offer, or absent for no
 *   section half. Passed **separately and unnarrowed** on purpose: section
 *   presence is independent of document presence (ADR 01032), so a page whose
 *   `kg.type` is already set must still be able to type its sections. Deriving
 *   this list from `fields` handed a strictly-constrained provider a section
 *   item with no data properties at all.
 */
export function proposalSchema(
  fields: FillField[],
  options: { sections?: FillField[]; lenient?: boolean } = {},
): Record<string, unknown> {
  // Build from the SAME sorted list the key is derived from. Keying on the
  // sorted set while building from the caller's order would make the cached
  // schema's property order depend on whichever call arrived first — and that
  // order is observable: the schema is JSON.stringify'd into the claude-cli
  // and json_object prompts, so identical inputs could produce different
  // prompts across runs. Determinism is the product contract here.
  const sorted = [...fields].sort();
  // Sorted for the same reason `fields` is: the section item's property order
  // is observable through the stringified schema in the prompt.
  const sortedSections = options.sections
    ? [...options.sections]
        .filter((f) => SECTION_FILL_FIELDS.includes(f))
        .sort()
    : undefined;
  const lenient = options.lenient === true;
  const key = [
    sortedSections ? `s:${sortedSections.join(",")}` : "",
    lenient ? "l:" : "",
    sorted.join(","),
  ].join("|");
  const memoized = schemaCache.get(key);
  if (memoized) return memoized;
  const built = buildProposalSchema(sorted, sortedSections, lenient);
  schemaCache.set(key, built);
  return built;
}

function buildProposalSchema(
  fields: FillField[],
  sectionFields: FillField[] | undefined,
  lenient: boolean,
): Record<string, unknown> {
  // The value schemas are the contract and never relax. `confidence` and
  // `reasoning` are the model's own commentary on those values, and in the
  // validation schema they are accepted in whatever shape they arrive
  // (ADR 01034): `numberMap`/`stringMap` already ignore anything of the wrong
  // type, so a malformed score costs that one field its score rather than
  // discarding an otherwise good proposal. The REQUEST schema keeps the types,
  // so a provider is still asked — and a grammar-capable one still constrained
  // — to send a number.
  const scoreSchema = lenient ? {} : { type: "number", minimum: 0, maximum: 1 };
  const noteSchema = lenient ? {} : { type: "string" };
  const properties: Record<string, unknown> = {};
  const confidence: Record<string, unknown> = {};
  const reasoning: Record<string, unknown> = {};
  for (const field of fields) {
    properties[field] = FIELD_SCHEMAS[field];
    confidence[field] = scoreSchema;
    reasoning[field] = noteSchema;
  }
  properties["confidence"] = {
    type: "object",
    additionalProperties: false,
    properties: confidence,
    description:
      "For every field you propose a value for, a confidence 0..1 that the value is correct.",
  };
  properties["reasoning"] = {
    type: "object",
    additionalProperties: false,
    properties: reasoning,
    description:
      "For every field you propose a value for, a one-sentence justification grounded in the page text.",
  };

  if (sectionFields !== undefined) {
    // A **list** keyed by an explicit `slug`, not a map keyed by slug. Strict
    // structured output (OpenAI's json_schema, and the GBNF grammar it becomes)
    // requires `additionalProperties: false` on every object, which cannot
    // express an open-keyed map. A list of {slug, …} says the same thing in a
    // shape every provider can constrain.
    const sectionProps: Record<string, unknown> = {
      slug: {
        type: "string",
        minLength: 1,
        description:
          "The heading slug, copied exactly from the outline. Do not invent one.",
      },
    };
    const sectionConfidence: Record<string, unknown> = {};
    const sectionReasoning: Record<string, unknown> = {};
    for (const field of sectionFields) {
      sectionProps[field] = FIELD_SCHEMAS[field];
      sectionConfidence[field] = scoreSchema;
      sectionReasoning[field] = noteSchema;
    }
    sectionProps["confidence"] = {
      type: "object",
      additionalProperties: false,
      properties: sectionConfidence,
      description:
        "For every field you propose on this section, a confidence 0..1.",
    };
    sectionProps["reasoning"] = {
      type: "object",
      additionalProperties: false,
      properties: sectionReasoning,
      description:
        "For every field you propose on this section, a one-sentence justification.",
    };
    properties["sections"] = {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slug"],
        properties: sectionProps,
      },
      description:
        "Per-section metadata. Only for sections whose own content differs meaningfully from the page as a whole; omit a section rather than repeating the page's values.",
    };
  }

  return {
    type: "object",
    additionalProperties: false,
    properties,
  };
}

export const SYSTEM_PROMPT = [
  "You classify documentation pages into a controlled metadata vocabulary",
  "(SKOS concepts and iiRDS typing). For each requested field, first reason",
  "about whether the page's own text supports a value; propose a value only",
  "when it clearly does, and omit the field otherwise. Reuse the document's",
  "own terminology; do not invent concepts, product names, or classifications",
  "the document does not discuss.",
  "",
  "For every field you propose a value for, include a `confidence` (0..1) and",
  "a one-sentence `reasoning` grounded in the text. Score honestly and",
  "conservatively. Product/variant fields (applies-to, not-applicable-to) and the",
  "negative fields (not-applicable-to, not-about-product-aspect) require EXPLICIT",
  "textual evidence — score them low and prefer to omit unless the page states",
  "them outright. A field with no value needs no confidence or reasoning.",
].join("\n");

const EXCERPT_CHARS = 2000;

export function buildUserPrompt(
  doc: DocModel,
  body: string,
  fields: FillField[],
  options: { sections?: boolean } = {},
): string {
  const title =
    (typeof doc.frontmatter["title"] === "string" &&
      doc.frontmatter["title"]) ||
    doc.firstH1 ||
    "(untitled)";
  const tags = doc.frontmatter["tags"] ?? doc.frontmatter["keywords"];
  // With sections on, the outline carries each heading's slug: it is the key
  // the model must copy, and a slug it invents is dropped rather than written
  // (which would otherwise mint a dockg:brokenSectionRef — a finding fill must
  // never manufacture).
  const withSections = options.sections === true && doc.sections.length > 0;
  const outline = doc.sections
    .map(
      (s) =>
        `${"  ".repeat(Math.max(0, s.level - 1))}- ${s.title}` +
        (withSections ? `  [slug: ${s.slug}]` : ""),
    )
    .join("\n");

  return [
    `Propose the following frontmatter fields for this documentation page, with per-field confidence and reasoning: ${fields.join(", ")}.`,
    withSections
      ? "Also propose per-section metadata in `sections`, using the exact slug shown in the outline. Include a section ONLY when its own content differs meaningfully from the page as a whole — repeating the page's values on every heading adds noise, not granularity."
      : "",
    "",
    `Path: ${doc.path}`,
    `Title: ${title}`,
    Array.isArray(tags) && tags.length > 0
      ? `Existing tags: ${tags.join(", ")}`
      : "",
    "",
    "Heading outline:",
    outline || "(no headings)",
    "",
    "Body excerpt:",
    body.slice(0, EXCERPT_CHARS),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
