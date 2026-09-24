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
 * 4. `manni:graph:1.0.0-proposal.1` is kg's proposal.4 with the block renamed
 *    to `graph` and its prose moved to match (proposal 0063). Every field,
 *    type and dependency is the same.
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
const GRAPH_1 = `${DRAFTS}/graph/1.0.0-proposal.1.json`;

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

    // Everything outside kg's properties and dependencies is unchanged, except
    // the top-level description, which gains one sentence naming the seven
    // facts terminology's root fields are now the fallback for.
    const strip = (d: KgDraft): Record<string, unknown> => {
      const {
        $id: _id,
        title: _title,
        description: _description,
        properties,
        ...rest
      } = d;
      const { properties: _props, dependentRequired: _deps, ...kg } =
        properties.kg;
      return { ...rest, kg };
    };
    expect(strip(p4)).toEqual(strip(p3));
    const fallback =
      " The root fields of manni:terminology:1.0.0-proposal.1 are the fallback for seven more: `label`, `alt-labels`, `broader`, `narrower`, `related-concepts` (from `related-terms`), `definition` and `abstract`.";
    const anchor = "the page-level field is the harvest fallback.";
    expect(p4.description).toBe(
      p3.description.replace(anchor, `${anchor}${fallback}`),
    );

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

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The one sentence the graph draft adds to kg's top-level description. */
const PREDECESSOR =
  " This is the kg vocabulary renamed, and manni:kg:1.0.0-proposal.4 is its predecessor.";

/**
 * Undo the prose moves the rename made, and nothing else: the added sentence,
 * the block's name, its pointers, and the history sentence that names kg's
 * proposal.1 by id so it cannot read as this draft's own proposal.1.
 *
 * These are deliberate, one per edit the rename made to a description, and
 * each is spelled narrowly enough that it cannot reach a field name. That is
 * the point. A broad `graph` → `kg` replace would also rewrite a key or a
 * value, and the deep-equality check below would then pass on a draft that
 * had drifted. Keep one replacement per rename move rather than simplifying.
 */
function asKgProse(text: string): string {
  return text
    .replace(PREDECESSOR, "")
    .replaceAll("`graph`", "`kg`")
    .replaceAll("/graph/", "/kg/")
    .replaceAll("graph fields", "kg fields")
    .replace("manni:kg:1.0.0-proposal.1 carried", "proposal.1 carried");
}

/** Apply `asKgProse` to every description string, and leave every other value alone. */
function withKgProse(node: Json, key?: string): Json {
  if (typeof node === "string") return key === "description" ? asKgProse(node) : node;
  if (Array.isArray(node)) return node.map((item) => withKgProse(item));
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [k, withKgProse(v, k)]),
    );
  }
  return node;
}

describe("manni:graph:1.0.0-proposal.1", () => {
  it("accepts graph.definition and graph.abstract once graph.label is present", async () => {
    const r = await check("graph-definition.md", [GRAPH_1]);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects graph.definition without graph.label", async () => {
    const r = await check("graph-definition-without-label.md", [GRAPH_1]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.schema).toBe(GRAPH_1);
    expect(r.errors[0]?.instancePath).toBe("/graph");
  });

  it("rejects graph.abstract without graph.definition", async () => {
    const r = await check("graph-abstract-without-definition.md", [GRAPH_1]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.schema).toBe(GRAPH_1);
    expect(r.errors[0]?.instancePath).toBe("/graph");
  });

  it("does not read a kg block, which the closed-block rules no longer reach", async () => {
    const r = await check("kg-definition-without-label.md", [GRAPH_1]);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("is kg's proposal.4 with only the block renamed and its prose to match", async () => {
    const kg = (await loadSchema(KG_4)) as Draft;
    const graph = (await loadSchema(GRAPH_1)) as Draft;

    expect(graph.$id).toBe("manni:graph:1.0.0-proposal.1");
    expect(graph.title).toBe("manni graph frontmatter (1.0.0-proposal.1)");
    expect(Object.keys(graph.properties)).toEqual(["graph"]);
    expect(graph.properties["graph"]?.["x-manni-location"]).toBe("page");
    expect(graph.description).toContain(PREDECESSOR.trim());

    // No description still names the kg block or points into it.
    const text = JSON.stringify(graph);
    expect(text).not.toContain("`kg`");
    expect(text).not.toContain("/kg/");

    // Rename the block back, undo the prose moves, and restore kg's id and
    // title: what remains must be kg's proposal.4, value for value.
    const reverted = withKgProse(graph as unknown as Json);
    if (reverted === null || typeof reverted !== "object" || Array.isArray(reverted)) {
      throw new Error("the graph draft is not an object");
    }
    const { properties, ...rest } = reverted;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
      throw new Error("the graph draft has no properties");
    }
    const { graph: block, ...others } = properties;
    expect(others).toEqual({});
    expect({
      ...rest,
      $id: kg.$id,
      title: kg.title,
      properties: { kg: block },
    }).toEqual(kg);
  });
});
