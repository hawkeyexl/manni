/**
 * The `manni:kg` vocabulary ladder — the review oracle proposal 0023 publishes
 * with its page vocabulary (`docs/proposals/0023/ladders/kg-examples.cjs`),
 * ported case for case.
 *
 * kg does not own this vocabulary (ADR 01023): manni publishes the common
 * metadata vocabularies and tools implement graph behavior against them. It is
 * no longer copied here either. `src/kg/schema.ts` imports the draft under
 * `docs/proposals/0023/schemas/kg/` and the build inlines it, so one file is
 * both the draft under review and the schema the tool enforces — there is no
 * second artifact, and nothing left for a hash pin to protect. What is still
 * worth pinning is the other half of the old pair: that kg reads the draft the
 * way the proposal says it reads.
 *
 * A negative case failing for the *wrong* reason is a silent pass, so each one
 * names the key its error must point at.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  frontmatterSchema,
  FRONTMATTER_SCHEMA_ID,
} from "../../../src/kg/schema.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const DRAFT = "docs/proposals/0023/schemas/kg/1.0.0-proposal.3.json";

const schema: unknown = frontmatterSchema;

describe("the manni:kg page schema", () => {
  it("is the kg draft, byte for byte", () => {
    expect(frontmatterSchema).toEqual(
      JSON.parse(readFileSync(resolve(ROOT, DRAFT), "utf8")),
    );
  });

  it("declares the draft's $id, not one of kg's own", () => {
    expect(FRONTMATTER_SCHEMA_ID).toBe("manni:kg:1.0.0-proposal.3");
    expect(schema).toMatchObject({ $id: "manni:kg:1.0.0-proposal.3" });
  });
});

/** [name, expected valid, frontmatter YAML, error must mention (negatives)] */
type Case = [string, boolean, string, string?];

const cases: Case[] = [
  [
    "1 no kg key at all — files without kg pass",
    true,
    `title: Plain page
description: Nothing graph-related here.`,
  ],
  ["2 label alone", true, `kg:\n  label: Configuration`],
  [
    "3 full SKOS, arrays",
    true,
    `kg:
  label: Configuration
  alt-labels: [config, settings]
  broader: [Administration]
  narrower: [Environment variables]
  related-concepts: [Installation]
  concepts: [reference]`,
  ],
  [
    "4 single-string shorthand on label fields (widening over 0.8)",
    true,
    `kg:
  label: Configuration
  alt-labels: config
  broader: Administration
  concepts: reference`,
  ],
  [
    "5 iiRDS typing, list and single forms",
    true,
    `kg:
  type: task
  applies-to: [SP-X100, SP-X200]
  about-product-lifecycle: deployment
  about-product-aspect: [interface]`,
  ],
  [
    "6 negative scope",
    true,
    `kg:
  applies-to: [SP-X100]
  not-applicable-to: [SP-X300]
  about-product-aspect: [interface]
  not-about-product-aspect: [architecture]`,
  ],
  [
    "7 sections with per-section typing",
    true,
    `kg:
  type: task
  sections:
    install:
      type: reference
      applies-to: SP-X200
      concepts: [installation]
    options:
      not-about-product-aspect: [architecture]`,
  ],
  [
    "8 page-level meta-provenance with /kg/ pointers, beside a kg block",
    true,
    `title: API keys
kg:
  label: API keys
meta-provenance:
  - generated-by: claude-opus-4-6
    fields: ["/kg/label"]
    confidence:
      "/kg/label": 0.92`,
  ],
  [
    "9 the 0.8 worked example, translated (capability-fidelity demo)",
    true,
    `title: Configuration Reference
kg:
  label: Configuration
  alt-labels: [config, settings]
  broader: [Administration]
  related-concepts: [Installation]
  concepts: [reference]
  type: reference
  applies-to: [SP-X100, SP-X200]
  about-product-aspect: [interface]
  not-applicable-to: [SP-X300]
  sections:
    options:
      not-about-product-aspect: [architecture]`,
  ],

  [
    "N1 hierarchy without a label (dependentRequired)",
    false,
    `kg:
  alt-labels: [orphaned]`,
    // Not the bare word `label`: it is a substring of `alt-labels`, so this
    // case would pass on an error that named only the wrong key.
    '"missingProperty":"label"',
  ],
  [
    "N2 the 0.8 camelCase spelling now fails loudly",
    false,
    `kg:
  prefLabel: Configuration`,
    "prefLabel",
  ],
  [
    "N3 kg.generatedBy is gone — top-level generated-by owns it",
    false,
    `kg:
  label: Configuration
  generatedBy: gpt-5`,
    "generatedBy",
  ],
  [
    "N4 a single provenance object under kg — not a property of the block",
    false,
    `kg:
  label: API keys
  provenance:
    generated-by: claude-opus-4-6`,
    "provenance",
  ],
  [
    "N5 a type outside the published iiRDS list",
    false,
    `kg:
  type: tutorial`,
    "type",
  ],
  [
    "N6 a provenance entry with a fields list — the key is gone, not its shape",
    false,
    `kg:
  label: X
  provenance:
    - generated-by: m
      fields: [prefLabel]`,
    // Not `fields` any more. proposal.3 removed `kg.provenance` outright, so
    // the block's closed property set rejects the container and never reaches
    // what is inside it.
    "provenance",
  ],
  [
    "N7 duplicate labels in a list",
    false,
    `kg:
  label: Configuration
  alt-labels: [config, config]`,
    "alt-labels",
  ],
  [
    "N8 the 0.8 field names subjects / softwareSubject now fail",
    false,
    `kg:
  label: Configuration
  subjects: [reference]
  softwareSubject: [interface]`,
    "subjects",
  ],
  [
    "N9 an empty provenance array is still an unknown kg property",
    false,
    `kg:
  label: API keys
  provenance: []`,
    "provenance",
  ],
  [
    "N10 empty about-product-lifecycle list",
    false,
    `kg:
  label: API keys
  about-product-lifecycle: []`,
    "about-product-lifecycle",
  ],
  [
    "N11 empty about-product-aspect list",
    false,
    `kg:
  label: API keys
  about-product-aspect: []`,
    "about-product-aspect",
  ],
  [
    "N12 an empty section entry is not a declaration",
    false,
    `kg:
  label: API keys
  sections:
    install: {}`,
    "install",
  ],
  [
    "N13 kg.provenance is gone in proposal.3 — machine attribution is the page-level meta-provenance",
    false,
    `kg:
  label: API keys
  provenance:
    - generated-by: claude-opus-4-6
      fields: [label, type]
      confidence:
        label: 0.92
        type: 0.81`,
    "provenance",
  ],
];

describe("manni:kg ladder", () => {
  // `strict: false` is the setting `manni meta` itself compiles with
  // (src/meta/core/validator.ts), and the ladder has to compile the draft the
  // way the tool does or it is grading a different schema. proposal.3 marks the
  // `kg` block `x-manni-location: page` (proposal 0047), an annotation Ajv has
  // no vocabulary for and refuses outright under strict mode.
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: false,
  });
  const validate = ajv.compile(schema as object);

  it.each(cases)("%s", (_name, expectValid, yamlText, mustMention) => {
    const ok = validate(parse(yamlText));
    expect(ok, JSON.stringify(validate.errors?.slice(0, 3))).toBe(expectValid);

    if (!expectValid && mustMention) {
      // Guard against passing for the wrong reason: the rejection has to point
      // at the key the case is about, not at some unrelated sibling.
      const where = (validate.errors ?? [])
        .map(
          (e) =>
            `${e.instancePath} ${e.message ?? ""} ${JSON.stringify(e.params)}`,
        )
        .join(" | ");
      expect(where).toContain(mustMention);
    }
  });

  it("covers the draft's whole ladder", () => {
    expect(cases).toHaveLength(22);
    expect(cases.filter(([, valid]) => valid)).toHaveLength(9);
    expect(cases.filter(([, valid]) => !valid)).toHaveLength(13);
  });
});

/**
 * Two keys 0023's ladder does not reach, kept from the integration file that
 * used to assert them through `manni kg validate` (removed in proposal 0051
 * §8). They are properties of the draft rather than of any verb, so they are
 * checked against the draft directly — the vocabulary keeps its coverage, the
 * removed command takes only its own with it.
 */
describe("the draft beyond 0023's ladder", () => {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: false,
  });
  const validate = ajv.compile(schema as object);

  const errorText = (): string =>
    (validate.errors ?? [])
      .map((e) => `${e.instancePath} ${e.message ?? ""}`)
      .join(" | ");

  it("takes revision-of as a list or a bare string", () => {
    // The single-string shorthand manni:kg widened over dockg 0.8: one value is
    // a string, many values are a list. This used to be a rejection.
    expect(validate(parse(`kg:\n  revision-of: [old/guide.md]`))).toBe(true);
    expect(validate(parse(`kg:\n  revision-of: old/guide.md`))).toBe(true);
  });

  it("rejects an empty revision-of list", () => {
    // …but an empty list is not a declaration. `minItems: 1` closes the hole
    // where `revision-of: []` read as "revised something" and named nothing.
    expect(validate(parse(`kg:\n  revision-of: []`))).toBe(false);
    expect(errorText()).toContain("revision-of");
  });

  it("rejects an out-of-enum not-about-product-aspect", () => {
    expect(
      validate(
        parse(
          `kg:\n  not-applicable-to: [SP-X300]\n  not-about-product-aspect: [architecture]`,
        ),
      ),
    ).toBe(true);

    expect(
      validate(parse(`kg:\n  not-about-product-aspect: [nonsense]`)),
    ).toBe(false);
    expect(errorText()).toContain("not-about-product-aspect");
  });
});
