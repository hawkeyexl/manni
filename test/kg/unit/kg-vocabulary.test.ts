/**
 * The `docmeta:kg` vocabulary ladder — dockg's copy of docmeta's review oracle
 * for proposal 0023 (`docs/proposals/0023/ladders/kg-examples.cjs`), ported
 * case for case.
 *
 * dockg does not own this vocabulary any more (ADR 01023): docmeta publishes
 * the common metadata vocabularies, tools implement behavior against them. So
 * the schema ships here as vendored bytes, and these two suites are what make
 * the vendoring honest — the hash pin proves the bytes are upstream's, and the
 * ladder proves dockg reads them the way upstream says they read.
 *
 * A negative case failing for the *wrong* reason is a silent pass, so each one
 * names the key its error must point at.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { bundledSchemaPath } from "../../../src/kg/core/pkg.js";

/**
 * sha256 of docmeta's `docs/proposals/0023/schemas/kg/1.0.0-proposal.1.json`
 * at the revision dockg vendored. Pinned as a hash rather than compared
 * against a sibling checkout: docmeta is an npm dependency in CI, not a
 * working tree. When docmeta publishes a new revision of the draft, this is
 * the test that says so.
 */
const UPSTREAM_SHA256 =
  "2c260ae4b94ebcc875a6e24aad8e2de20ed5bbdfe8486985159ea0fee94128d4";

const schemaBytes = readFileSync(bundledSchemaPath(import.meta.url));
const schema: unknown = JSON.parse(schemaBytes.toString("utf8"));

describe("vendored docmeta:kg schema", () => {
  it("is byte-identical to docmeta's published draft", () => {
    expect(createHash("sha256").update(schemaBytes).digest("hex")).toBe(
      UPSTREAM_SHA256,
    );
  });

  it("declares the upstream $id, not a dockg one", () => {
    expect(schema).toMatchObject({ $id: "manni:kg:1.0.0-proposal.1" });
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
    "8 provenance trail with fields and confidence",
    true,
    `kg:
  label: API keys
  provenance:
    - generated-by: claude-opus-4-6
      fields: [label, type]
      confidence:
        label: 0.92
        type: 0.81`,
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
    "N4 the deprecated single-object provenance shape is dropped",
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
    "N6 a provenance fields entry using the old spelling",
    false,
    `kg:
  label: X
  provenance:
    - generated-by: m
      fields: [prefLabel]`,
    "fields",
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
    "N9 empty provenance array",
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
];

describe("docmeta:kg ladder", () => {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
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

  it("covers docmeta's whole ladder", () => {
    expect(cases).toHaveLength(21);
    expect(cases.filter(([, valid]) => valid)).toHaveLength(9);
    expect(cases.filter(([, valid]) => !valid)).toHaveLength(12);
  });
});
