import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { bundledSchemaPath, bundledShapesPath } from "../../../src/kg/core/pkg.js";
import { LANGUAGE_TAG } from "../../../src/kg/core/localizations.js";
import { FIELD_SCHEMAS } from "../../../src/kg/llm/prompt.js";
import {
  COVERAGE_FIELDS,
  COVERAGE_FIELD_NAMES,
  SECTION_COVERAGE_FIELDS,
  UNMEASURED_BY_DESIGN,
} from "../../../src/kg/core/coverage.js";
import { PROVIDER_NAMES } from "../../../src/kg/core/config.js";
import {
  IIRDS_HAS_SUBJECT,
  IIRDS_HAS_TOPIC_TYPE,
  IIRDS_RELATES_TO_LIFECYCLE_PHASE,
  IIRDS_RELATES_TO_PRODUCT_VARIANT,
  PAGE_TYPE_TO_TOPIC_TYPE,
  SOFTWARE_LIFECYCLE_IRIS,
  SOFTWARE_SUBJECT_IRIS,
  TOPIC_TYPE_IRIS,
} from "../../../src/kg/core/iirds.js";

/**
 * Drift guard: fill's proposal field schemas must stay a subset of the
 * bundled frontmatter schema's kg properties, or `manni kg fill` writes
 * frontmatter that `manni kg validate` rejects.
 */
describe("prompt FIELD_SCHEMAS ↔ bundled schema", () => {
  const schema = JSON.parse(
    readFileSync(bundledSchemaPath(import.meta.url), "utf8"),
  ) as {
    properties: { kg: { properties: Record<string, unknown> } };
    $defs?: {
      provenanceEntry?: {
        properties?: { fields?: { items?: { enum?: string[] } } };
      };
    };
  };
  const kgProperties = schema.properties.kg.properties;

  it("every fillable field exists in the bundled schema", () => {
    for (const field of Object.keys(FIELD_SCHEMAS)) {
      expect(
        kgProperties,
        `schema is missing fill field "${field}"`,
      ).toHaveProperty(field);
    }
  });

  /**
   * The property the guard exists for, tested directly rather than through a
   * proxy: a `kg` block shaped the way fill proposes must validate. Comparing
   * declared `type` strings stopped working once docmeta:kg put every field
   * behind a $ref — and it was always the weaker check, since it never proved
   * a proposed *value* was legal.
   */
  it("a kg block shaped like fill's proposal validates", () => {
    const sample = (fieldSchema: Record<string, unknown>): unknown => {
      if (Array.isArray(fieldSchema.enum)) return fieldSchema.enum[0];
      if (fieldSchema.type === "string") return "Sample";
      const items = fieldSchema.items as { enum?: string[] } | undefined;
      return [items?.enum ? items.enum[0] : "Sample"];
    };
    const kg = Object.fromEntries(
      Object.entries(FIELD_SCHEMAS).map(([field, fieldSchema]) => [
        field,
        sample(fieldSchema),
      ]),
    );

    const validate = new Ajv2020({
      allErrors: true,
      allowUnionTypes: true,
    }).compile(schema);
    expect(validate({ kg }), JSON.stringify(validate.errors)).toBe(true);
  });

  it("the provenance fields enum covers every fillable field", () => {
    const allowed =
      schema.$defs?.provenanceEntry?.properties?.fields?.items?.enum ?? [];
    for (const field of Object.keys(FIELD_SCHEMAS)) {
      expect(allowed, `provenance enum is missing "${field}"`).toContain(field);
    }
  });
});

/**
 * Drift guard: the coverage field list and the config schema's per-field
 * coverageThreshold map must name exactly the same fields, or a threshold set
 * in config would silently gate nothing (or Ajv would reject a valid field).
 */
describe("COVERAGE_FIELD_NAMES ↔ config schema", () => {
  const configSchema = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "src",
        "kg",
        "core",
        "config-schema.json",
      ),
      "utf8",
    ),
  ) as {
    properties: {
      stats: {
        properties: {
          coverageThreshold: {
            anyOf: Array<{ properties?: Record<string, unknown> }>;
          };
        };
      };
    };
  };

  it("the per-field threshold map names exactly the measured fields", () => {
    const mapForm =
      configSchema.properties.stats.properties.coverageThreshold.anyOf.find(
        (s) => s.properties,
      );
    expect(mapForm, "no object form in coverageThreshold anyOf").toBeDefined();
    expect(Object.keys(mapForm!.properties!).sort()).toEqual(
      [...COVERAGE_FIELD_NAMES].sort(),
    );
  });
});

/**
 * Drift guard: each iiRDS frontmatter enum in the bundled schema must name
 * exactly the keys of its src/core/iirds.ts map, or a valid frontmatter value
 * would derive no triple (or Ajv would reject a mapped one). ADR 01012.
 */
describe("iiRDS enums ↔ bundled schema", () => {
  type Node = {
    $ref?: string;
    enum?: string[];
    items?: { enum?: string[] };
    then?: { items?: { enum?: string[] } };
    else?: { enum?: string[] };
  };
  const parsed = JSON.parse(
    readFileSync(bundledSchemaPath(import.meta.url), "utf8"),
  ) as {
    properties: { kg: { properties: Record<string, Node> } };
    $defs: Record<string, Node> & {
      sectionMetadata: { properties: Record<string, Node> };
    };
  };
  const kg = parsed.properties.kg.properties;
  const sec = parsed.$defs.sectionMetadata.properties;

  /**
   * Follow the one $ref level docmeta:kg uses. Resolving rather than reading
   * `$defs` directly is deliberate: it catches a field repointed at the wrong
   * definition, which reading the definition by name never would.
   */
  const deref = (node: Node | undefined): Node | undefined => {
    if (!node?.$ref) return node;
    const name = node.$ref.replace("#/$defs/", "");
    return parsed.$defs[name];
  };

  /**
   * The values a field accepts. Every list field takes the single-string
   * shorthand (docmeta:kg widened these over dockg 0.8), so its enum lives on
   * both branches of a string-or-list conditional — and the two branches must
   * agree, or one spelling would accept a value the other rejects.
   */
  const valuesOf = (node: Node | undefined): string[] => {
    const d = deref(node);
    if (!d) return [];
    if (d.enum) return d.enum;
    const list = d.then?.items?.enum ?? d.items?.enum ?? [];
    const scalar = d.else?.enum;
    if (scalar) expect([...scalar].sort()).toEqual([...list].sort());
    return list;
  };

  // Both the document-level fields and the section-level (sectionMetadata)
  // fields are pinned to the same iirds.ts maps, so they cannot diverge from
  // the source of truth — or from each other. ADR 01012/01013.
  it.each([
    ["kg.type", () => valuesOf(kg["type"]), TOPIC_TYPE_IRIS],
    [
      "kg.about-product-lifecycle",
      () => valuesOf(kg["about-product-lifecycle"]),
      SOFTWARE_LIFECYCLE_IRIS,
    ],
    [
      "kg.about-product-aspect",
      () => valuesOf(kg["about-product-aspect"]),
      SOFTWARE_SUBJECT_IRIS,
    ],
    ["section.type", () => valuesOf(sec["type"]), TOPIC_TYPE_IRIS],
    [
      "section.about-product-lifecycle",
      () => valuesOf(sec["about-product-lifecycle"]),
      SOFTWARE_LIFECYCLE_IRIS,
    ],
    [
      "section.about-product-aspect",
      () => valuesOf(sec["about-product-aspect"]),
      SOFTWARE_SUBJECT_IRIS,
    ],
    // Negative-scope subject enums share the same value set (ADR 01014).
    [
      "kg.not-about-product-aspect",
      () => valuesOf(kg["not-about-product-aspect"]),
      SOFTWARE_SUBJECT_IRIS,
    ],
    [
      "section.not-about-product-aspect",
      () => valuesOf(sec["not-about-product-aspect"]),
      SOFTWARE_SUBJECT_IRIS,
    ],
  ] as const)("%s enum matches its IRI map keys", (_name, getEnum, map) => {
    expect([...getEnum()].sort()).toEqual(Object.keys(map).sort());
  });

  /**
   * The page-type derivation (ADR 01024) targets `kg.type`, so every value it
   * can produce must be a legal one — otherwise a derived type would silently
   * emit no triple.
   */
  it("every derived page type is a legal kg.type value", () => {
    for (const derived of Object.values(PAGE_TYPE_TO_TOPIC_TYPE)) {
      expect(valuesOf(kg["type"])).toContain(derived);
    }
  });
});

/**
 * The kg tool's docs site section has not moved into this repository yet, so
 * the guards below that read its pages are skipped until it lands under
 * `docs/src/content/docs/kg/`. They are kept, not deleted: each one caught a
 * real drift once, and the pages are owed on this branch.
 */
const KG_DOCS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "docs",
  "src",
  "content",
  "docs",
  "kg",
);
const kgDocsPage = (...segments: string[]): string | null => {
  const path = join(KG_DOCS, ...segments);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

describe("documented bundled defaults ↔ pkg.ts", () => {
  const configPage = kgDocsPage("reference", "configuration.mdx");
  const schemaFile = basename(bundledSchemaPath(import.meta.url));
  const shapesFile = basename(bundledShapesPath(import.meta.url));

  it.skipIf(configPage === null)("names the current bundled schema file", () => {
    expect(configPage).toContain(`schemas/kg/${schemaFile}`);
  });

  it.skipIf(configPage === null)("names the current bundled shapes file", () => {
    expect(configPage).toContain(`shapes/kg/${shapesFile}`);
  });
});

describe("PROVIDER_NAMES ↔ config schema", () => {
  it("names exactly the providers the schema accepts", () => {
    // One source of truth for the provider list. `--provider` is validated
    // against PROVIDER_NAMES and `fill.provider` against the JSON schema enum;
    // if the two drift, one path admits a name the other refuses, and
    // `providerSpecFor`'s cast to ProviderName stops being sound.
    const schema = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "..",
          "src",
        "kg",
          "core",
          "config-schema.json",
        ),
        "utf8",
      ),
    ) as {
      properties: {
        fill: { properties: { provider: { enum: string[] } } };
      };
    };
    expect([...PROVIDER_NAMES].sort()).toEqual(
      [...schema.properties.fill.properties.provider.enum].sort(),
    );
  });
});

describe("coverage IRIs ↔ iirds.ts", () => {
  it("measures the same iiRDS predicates the emitter mints", () => {
    // A drift guard, and only that: comparing values cannot tell an imported
    // constant from a retyped literal that happens to match. What it does
    // catch is the failure that matters — a predicate moving in iirds.ts (a
    // namespace revision, an iiRDS version bump) while coverage.ts still
    // counts the old IRI, and every row silently reads 0%.
    const byField = new Map(COVERAGE_FIELDS.map((f) => [f.field, f.iri]));
    expect(byField.get("type")).toBe(IIRDS_HAS_TOPIC_TYPE);
    expect(byField.get("applies-to")).toBe(IIRDS_RELATES_TO_PRODUCT_VARIANT);
    expect(byField.get("about-product-lifecycle")).toBe(
      IIRDS_RELATES_TO_LIFECYCLE_PHASE,
    );
    expect(byField.get("about-product-aspect")).toBe(IIRDS_HAS_SUBJECT);
  });
});

describe("the library entry point ↔ what the docs promise", () => {
  // reference/library-api.mdx tells a consumer to import these from the
  // package. `SECTION_COVERAGE_FIELDS` was documented there while living only
  // in src/core/coverage.ts, which is not a public entry point — so the
  // documented import resolved to undefined.
  const page = kgDocsPage("reference", "library-api.mdx");
  it.skipIf(page === null)("re-exports every coverage symbol library-api.mdx names", async () => {
    const index = (await import("../../../src/kg/index.js")) as Record<
      string,
      unknown
    >;
    for (const name of [
      "COVERAGE_FIELDS",
      "COVERAGE_FIELD_NAMES",
      "SECTION_COVERAGE_FIELDS",
    ]) {
      expect(page, `${name} is not named on the page`).toContain(name);
      expect(
        index[name],
        `${name} is not exported from src/index.ts`,
      ).toBeDefined();
    }
  });
});

describe("SECTION_FIELD_NAMES ↔ COVERAGE_FIELDS", () => {
  // The guard `src/core/coverage.ts` points at for its unreachable throw. It
  // pointed at a path that did not exist, so the name agreement it describes
  // was enforced only by the throw itself — at runtime, in the one code path
  // `c8 ignore` says is never taken.
  it("every section field resolves to a measured document field", () => {
    const measured = new Set(COVERAGE_FIELDS.map((f) => f.field));
    for (const { field } of SECTION_COVERAGE_FIELDS) {
      expect(measured.has(field), `${field} is not in COVERAGE_FIELDS`).toBe(
        true,
      );
    }
    expect(SECTION_COVERAGE_FIELDS.length).toBeGreaterThan(0);
  });

  it("keeps the two negative predicates out of coverage, on purpose", () => {
    // ADR 01014/01029: absence of a negative predicate means *unknown* under
    // open-world semantics, not under-annotation, so counting it would park two
    // rows near zero on every healthy corpus. UNMEASURED_BY_DESIGN records that
    // decision; this asserts it, so the constant is enforced rather than prose.
    const measured = new Set(COVERAGE_FIELDS.map((f) => f.field));
    for (const field of UNMEASURED_BY_DESIGN) {
      expect(measured.has(field), `${field} is measured after all`).toBe(false);
    }
  });
});

/**
 * Drift guard: the docs state the measured-field count in prose, and three
 * pages said "eleven" for a release after the list grew to twelve. A number
 * spelled out in four places is a number that goes stale, so pin it.
 */
describe("documented coverage field count ↔ COVERAGE_FIELDS", () => {
  const WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
  ];
  const pages = [
    join("govern", "coverage.mdx"),
    join("reference", "configuration.mdx"),
    join("reference", "glossary.mdx"),
    join("reference", "library-api.mdx"),
  ];

  it.skipIf(!existsSync(KG_DOCS))("no page names a count other than the measured one", () => {
    const correct = WORDS[COVERAGE_FIELDS.length];
    expect(correct, "extend WORDS if the field list grew").toBeDefined();
    const wrong = WORDS.filter((w) => w !== correct && w !== "one");

    for (const page of pages) {
      const text = readFileSync(join(KG_DOCS, page), "utf8");
      for (const word of wrong) {
        // Only where the number is qualifying "fields": `eleven commands` on
        // the CLI page is a different (correct) count.
        const stale = new RegExp(`\\b${word}\\b[^.\\n]{0,40}\\bfields\\b`, "i");
        expect(
          stale.test(text),
          `${page} says "${word} … fields" but ${correct ?? "?"} are measured`,
        ).toBe(false);
      }
    }
  });
});

/**
 * The BCP-47 grammar lives in three places, and they must agree: the config
 * schema (routes[].language, embed.byLanguage keys), the SHACL shapes
 * (dcterms:language), and `LANGUAGE_TAG` in localizations.ts — which exists
 * because a tag also becomes a filename, and the shapes only run under
 * `manni kg check`.
 */
describe("BCP-47 pattern ↔ config schema ↔ shapes", () => {
  const source = LANGUAGE_TAG.source;

  it("matches every copy in the config schema", () => {
    const schema = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "..",
          "src",
        "kg",
          "core",
          "config-schema.json",
        ),
        "utf8",
      ),
    ) as unknown;
    const found = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (
          key === "pattern" &&
          typeof value === "string" &&
          /A-Za-z/.test(value)
        ) {
          found.add(value);
        }
        // patternProperties keys are patterns too — that is how
        // embed.byLanguage constrains its language keys.
        if (key === "patternProperties" && value && typeof value === "object") {
          for (const p of Object.keys(value)) found.add(p);
        }
        walk(value);
      }
    };
    walk(schema);
    expect(found.size).toBeGreaterThan(0);
    for (const pattern of found) expect(pattern).toBe(source);
  });

  it("matches the dcterms:language pattern in the bundled shapes", () => {
    const shapes = readFileSync(bundledShapesPath(import.meta.url), "utf8");
    // The shape *definition*, not its mention in DocumentShape's sh:property
    // list — slicing from the mention picks up dockg:contentHash's pattern.
    const start = shapes.indexOf("dsh:Document-language\n  a sh:PropertyShape");
    expect(
      start,
      "no dsh:Document-language shape in the bundled shapes",
    ).toBeGreaterThan(-1);
    const block = shapes.slice(start, shapes.indexOf(" .", start));
    const match = /sh:pattern "([^"]+)"/.exec(block);
    expect(match, "shapes declare no sh:pattern for dcterms:language").not.toBe(
      null,
    );
    expect(match![1]).toBe(source);
  });
});
