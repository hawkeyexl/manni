/**
 * The terminology vocabulary and kg's definition fields (proposal 0052, § 1
 * and § 2).
 *
 * `manni:terminology:1.0.0-proposal.1` is a draft in proposal 0023's family,
 * unregistered like its siblings, so every case validates through a file ref
 * into docs/proposals/0023/schemas. That is what `runValidate` does with a
 * `./x.json` schema entry, so the semantics under test are the shipped
 * pipeline's.
 *
 * Pinned here:
 *
 * 1. The ten fields sit at the root, and none of them is a field another house
 *    schema claims. `type`, `id` and `language` stay with core, and the draft
 *    constrains `type` through `if` without declaring it.
 * 2. A `type: term` page names its label, and either defines the term or
 *    redirects with `see`. Carrying both is a check finding, not a schema
 *    error.
 * 3. kg's proposal.4 is proposal.3 plus `definition` and `abstract`, their
 *    dependencies, and one harvest sentence on each field that has a root
 *    twin. Nothing else moved.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runValidate } from "../../src/meta/commands/validate.js";
import type { ValidationResult } from "../../src/meta/types.js";
import { loadSchema } from "../../src/meta/core/schema-registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

const DRAFTS = "./docs/proposals/0023/schemas";
const TERMINOLOGY = `${DRAFTS}/terminology/1.0.0-proposal.1.json`;
const CORE = `${DRAFTS}/core/1.0.0-proposal.4.json`;
const KG_3 = `${DRAFTS}/kg/1.0.0-proposal.3.json`;
const KG_4 = `${DRAFTS}/kg/1.0.0-proposal.4.json`;

/** The other house schemas, at the revisions default-schema.test.ts loads. */
const HOUSE = [
  CORE,
  `${DRAFTS}/stewardship/1.0.0-proposal.3.json`,
  `${DRAFTS}/audience/1.0.0-proposal.2.json`,
  `${DRAFTS}/lifecycle/1.0.0-proposal.2.json`,
  `${DRAFTS}/structure/1.0.0-proposal.2.json`,
  `${DRAFTS}/ai-context/1.0.0-proposal.3.json`,
];

const FIELDS = [
  "abstract",
  "alt-labels",
  "broader",
  "definition",
  "hidden-labels",
  "label",
  "narrower",
  "related-terms",
  "scope-note",
  "see",
];

/** kg fields with a root twin in the terminology vocabulary. */
const HARVESTED = [
  "label",
  "alt-labels",
  "broader",
  "narrower",
  "related-concepts",
  "definition",
  "abstract",
];

interface Property {
  description?: string;
  "x-manni-location"?: string;
  [key: string]: unknown;
}

interface Draft {
  $id: string;
  title: string;
  description: string;
  additionalProperties?: boolean;
  properties: Record<string, Property>;
  [key: string]: unknown;
}

interface KgDraft extends Draft {
  properties: {
    kg: Property & {
      properties: Record<string, Property>;
      dependentRequired: Record<string, string[]>;
    };
  };
}

/** Drop validate's location warnings (proposal 0047), not this file's subject. */
function withoutLocation(r: ValidationResult): ValidationResult {
  return { ...r, errors: r.errors.filter((e) => e.keyword !== "location") };
}

async function check(
  fixture: string,
  cliSchemas: string[] = [CORE, TERMINOLOGY],
): Promise<ValidationResult> {
  const { results } = await runValidate({
    inputs: [`test/fixtures/term/vocabulary/${fixture}`],
    cliSchemas,
    cwd: root,
    noConfig: true,
  });
  const r = results[0];
  if (!r) throw new Error(`no result for ${fixture}`);
  return withoutLocation(r);
}

async function checkStdin(
  yaml: string,
  cliSchemas: string[] = [TERMINOLOGY],
): Promise<ValidationResult> {
  const { results } = await runValidate({
    inputs: ["-"],
    as: "markdown",
    stdinContent: `---\n${yaml}\n---\n`,
    cliSchemas,
    cwd: root,
    noConfig: true,
  });
  const r = results[0];
  if (!r) throw new Error("no result for stdin");
  return withoutLocation(r);
}

describe("manni:terminology:1.0.0-proposal.1, the draft", () => {
  it("declares the ten fields at the root, and only those", async () => {
    const schema = (await loadSchema(TERMINOLOGY)) as Draft;
    expect(schema.$id).toBe("manni:terminology:1.0.0-proposal.1");
    expect(schema.title).toMatch(/^manni /);
    expect(schema.additionalProperties).toBe(true);
    expect(Object.keys(schema.properties).sort()).toEqual(FIELDS);
  });

  it("marks every field for the page, names its source, and spells it kebab-case", async () => {
    const schema = (await loadSchema(TERMINOLOGY)) as Draft;
    for (const [key, prop] of Object.entries(schema.properties)) {
      expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(prop["x-manni-location"], key).toBe("page");
      expect(prop.description, key).toMatch(/\S/);
    }
  });

  it("claims no field another house schema claims, core's type, id and language included", async () => {
    const schema = (await loadSchema(TERMINOLOGY)) as Draft;
    const own = new Set(Object.keys(schema.properties));
    for (const ref of HOUSE) {
      const other = (await loadSchema(ref)) as Draft;
      for (const key of Object.keys(other.properties)) {
        expect(own.has(key), `${key} claimed by ${ref} and terminology`).toBe(
          false,
        );
      }
    }
    for (const key of ["type", "id", "language"]) {
      expect(own.has(key), key).toBe(false);
    }
  });

  it("carries no em dash in any string", async () => {
    const schema = await loadSchema(TERMINOLOGY);
    expect(JSON.stringify(schema)).not.toContain("—");
  });
});

describe("manni:terminology:1.0.0-proposal.1, validating pages", () => {
  it("accepts a full term page, stacked on core", async () => {
    const r = await check("full-term.md");
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("accepts a redirect entry, with see and no definition", async () => {
    const r = await check("redirect-term.md");
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("leaves an entry carrying both see and a definition to the check", async () => {
    const r = await checkStdin(
      "type: term\nlabel: varifocal\nsee: progressive lens\ndefinition: A lens.",
    );
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects a term that neither defines nor redirects, attributed to terminology", async () => {
    const r = await check("term-without-definition-or-see.md");
    expect(r.ok).toBe(false);
    for (const e of r.errors) expect(e.schema).toBe(TERMINOLOGY);
    expect(
      r.errors.some(
        (e) =>
          e.keyword === "required" &&
          (e.subject === "definition" || e.subject === "see"),
      ),
    ).toBe(true);
  });

  it("rejects a term with no label, attributed to terminology", async () => {
    const r = await check("term-without-label.md");
    expect(r.ok).toBe(false);
    for (const e of r.errors) expect(e.schema).toBe(TERMINOLOGY);
    expect(
      r.errors.some((e) => e.keyword === "required" && e.subject === "label"),
    ).toBe(true);
  });

  it("accepts alt-labels as a single string", async () => {
    const r = await checkStdin(
      "type: term\nlabel: progressive lens\ndefinition: A lens.\nalt-labels: PAL",
    );
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects alt-labels as an empty list", async () => {
    const r = await checkStdin(
      "type: term\nlabel: progressive lens\ndefinition: A lens.\nalt-labels: []",
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.instancePath).toBe("/alt-labels");
  });

  it("rejects alt-labels with a duplicate", async () => {
    const r = await checkStdin(
      "type: term\nlabel: progressive lens\ndefinition: A lens.\nalt-labels: [PAL, PAL]",
    );
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.instancePath).toBe("/alt-labels");
  });

  it("rejects an empty definition", async () => {
    const r = await checkStdin(
      'type: term\nlabel: progressive lens\ndefinition: ""',
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.instancePath === "/definition")).toBe(true);
  });

  it("passes a page with no type and none of the vocabulary's fields", async () => {
    const r = await check("unrelated-page.md");
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("passes a page of another type that carries none of the fields", async () => {
    const r = await checkStdin("type: how-to");
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("imposes nothing on a term set", async () => {
    const r = await check("empty-term-set.md");
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("manni:kg:1.0.0-proposal.4", () => {
  it("accepts kg.definition and kg.abstract once kg.label is present", async () => {
    const r = await check("kg-definition.md", [KG_4]);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects kg.definition without kg.label", async () => {
    const r = await check("kg-definition-without-label.md", [KG_4]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.schema).toBe(KG_4);
    expect(r.errors[0]?.instancePath).toBe("/kg");
  });

  it("rejects kg.abstract without kg.definition", async () => {
    const r = await check("kg-abstract-without-definition.md", [KG_4]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.schema).toBe(KG_4);
    expect(r.errors[0]?.instancePath).toBe("/kg");
  });

  it("is proposal.3 plus the two fields, their dependencies and the harvest sentences", async () => {
    const p3 = (await loadSchema(KG_3)) as KgDraft;
    const p4 = (await loadSchema(KG_4)) as KgDraft;

    expect(p4.$id).toBe("manni:kg:1.0.0-proposal.4");
    expect(p4.title).toBe(p3.title.replace("proposal.3", "proposal.4"));

    // Everything outside kg's properties and dependencies is unchanged.
    const strip = (d: KgDraft): Record<string, unknown> => {
      const { $id: _id, title: _title, properties, ...rest } = d;
      const { properties: _props, dependentRequired: _deps, ...kg } =
        properties.kg;
      return { ...rest, kg };
    };
    expect(strip(p4)).toEqual(strip(p3));

    const old = p3.properties.kg.properties;
    const added = p4.properties.kg.properties;
    expect(Object.keys(added).sort()).toEqual(
      [...Object.keys(old), "abstract", "definition"].sort(),
    );

    expect(p4.properties.kg.dependentRequired).toEqual({
      ...p3.properties.kg.dependentRequired,
      definition: ["label"],
      abstract: ["definition"],
    });

    for (const [key, before] of Object.entries(old)) {
      const after = added[key];
      if (!after) throw new Error(`kg.${key} went missing`);
      const { description: beforeText, ...beforeShape } = before;
      const { description: afterText, ...afterShape } = after;
      expect(afterShape, key).toEqual(beforeShape);
      if (HARVESTED.includes(key)) {
        // One sentence appended, naming the root fallback.
        expect(afterText?.startsWith(`${beforeText ?? ""} `), key).toBe(true);
        expect(afterText?.slice((beforeText ?? "").length), key).toMatch(
          /manni:terminology/,
        );
      } else {
        expect(afterText, key).toBe(beforeText);
      }
    }

    for (const key of ["definition", "abstract"]) {
      const prop = added[key];
      expect(prop?.type, key).toBe("string");
      expect(prop?.minLength, key).toBe(1);
      expect(prop?.description, key).toMatch(/manni:terminology/);
    }
  });

  it("adds no em dash in the new text", async () => {
    const p3 = (await loadSchema(KG_3)) as KgDraft;
    const p4 = (await loadSchema(KG_4)) as KgDraft;
    const old = p3.properties.kg.properties;
    for (const [key, prop] of Object.entries(p4.properties.kg.properties)) {
      const added = (prop.description ?? "").slice(
        old[key]?.description?.length ?? 0,
      );
      expect(added, key).not.toContain("—");
    }
  });
});
