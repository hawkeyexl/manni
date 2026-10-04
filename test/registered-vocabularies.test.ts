/**
 * Each registered vocabulary is the draft it was cut from. Proposal 0067
 * registered the 0023 and 0044 drafts, and the 0066 overlays, at 1.0.0.
 * Registration rewrote ids, titles and descriptions, and made three changes
 * to shape, each named below. Anything else that differs is drift.
 *
 * The drafts stay in docs/proposals as the review record, and this is what
 * keeps the record honest about what shipped.
 */
import { describe, it, expect } from "vitest";
import { loadSchema } from "../src/meta/core/schema-registry.js";
import { type Json, withoutProse } from "./helpers/json.js";

const V0023 = "./docs/proposals/0023/schemas";
const V0044 = "./docs/proposals/0044/schemas";

/** Each family's draft, the revision it registered from. */
const DRAFTS: Record<string, string> = {
  core: `${V0023}/core/1.0.0-proposal.4.json`,
  stewardship: `${V0023}/stewardship/1.0.0-proposal.3.json`,
  audience: `${V0023}/audience/1.0.0-proposal.2.json`,
  lifecycle: `${V0023}/lifecycle/1.0.0-proposal.2.json`,
  structure: `${V0023}/structure/1.0.0-proposal.2.json`,
  terminology: `${V0023}/terminology/1.0.0-proposal.1.json`,
  "ai-context": `${V0023}/ai-context/1.0.0-proposal.3.json`,
  evals: `${V0023}/evals/1.0.0-proposal.4.json`,
  "artifact-evals": `${V0023}/artifact-evals/1.0.0-proposal.4.json`,
  graph: `${V0023}/graph/1.0.0-proposal.1.json`,
  citations: `${V0044}/citations/1.0.0-proposal.4.json`,
};

const strictDraft = (family: string): string =>
  `${family === "citations" ? V0044 : V0023}/${family}-strict/1.0.0-proposal.1.json`;

type JsonObject = Record<string, Json>;

async function load(ref: string): Promise<JsonObject> {
  return (await loadSchema(ref)) as unknown as JsonObject;
}

/**
 * The draft with `locale` gone from its properties, which 0067 dropped from core.
 *
 * It asserts the draft still has `locale` first. Both callers pass a core draft
 * that carries it, so a draft that had already lost the key fails here, rather
 * than letting the comparison pass on a draft 0067 never saw.
 */
function withoutLocale(schema: JsonObject): JsonObject {
  const props = schema.properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) {
    throw new Error("the schema has no properties");
  }
  expect(Object.keys(props)).toContain("locale");
  const { locale: _dropped, ...rest } = props;
  return { ...schema, properties: rest };
}

describe.each(Object.keys(DRAFTS))("manni:%s:1.0.0", (family) => {
  it("is its draft, with core's `locale` the one change of shape", async () => {
    const registered = await load(`manni:${family}:1.0.0`);
    const draft = await load(DRAFTS[family] ?? "");
    const expected = family === "core" ? withoutLocale(draft) : draft;
    expect(withoutProse(registered)).toEqual(withoutProse(expected));
  });

  it("is its strict overlay's draft, stating the open root it had left implicit", async () => {
    const registered = await load(`manni:${family}-strict:1.0.0`);
    const draft = await load(strictDraft(family));
    const trimmed = family === "core" ? withoutLocale(draft) : draft;
    const expected = { ...trimmed, additionalProperties: true };
    expect(withoutProse(registered)).toEqual(withoutProse(expected));
  });

  it("names no draft, no retired id and no locale key in its prose", async () => {
    for (const ref of [`manni:${family}:1.0.0`, `manni:${family}-strict:1.0.0`]) {
      const text = JSON.stringify(await load(ref));
      expect({ ref, draft: /-proposal\.\d|docmeta:|manni:kg:/.test(text) }).toEqual({
        ref,
        draft: false,
      });
      expect({ ref, locale: /"locale"/.test(text) }).toEqual({ ref, locale: false });
    }
  });
});

/**
 * artifact-evals 1.1.0 (proposal 0074) registers beside 1.0.0 and adds one
 * grader name, `tool-order`. The open vocabulary already accepted any kebab
 * name, so it gains the name in its recommended list and nothing else. The
 * strict overlay's closed list grows from ten names to eleven.
 */
describe("manni:artifact-evals:1.1.0 and its strict overlay", () => {
  /** The `enum` branch of the grader's `anyOf`, found along `path`. */
  function graderEnum(schema: JsonObject, path: readonly string[]): Json[] {
    let node: Json = schema;
    for (const key of path) {
      if (node === null || typeof node !== "object" || Array.isArray(node)) {
        throw new Error(`no ${key} on the way to grader`);
      }
      node = node[key] ?? null;
    }
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      throw new Error("grader is not an object");
    }
    const anyOf = node.anyOf;
    if (!Array.isArray(anyOf)) throw new Error("grader has no anyOf");
    for (const branch of anyOf) {
      if (branch !== null && typeof branch === "object" && !Array.isArray(branch)) {
        const values = branch.enum;
        if (Array.isArray(values)) return values;
      }
    }
    throw new Error("grader has no enum branch");
  }

  /** A copy, so a test never edits the bundled object the registry serves. */
  async function copy(ref: string): Promise<JsonObject> {
    return structuredClone(await load(ref));
  }

  const OPEN_GRADER = ["$defs", "grader"] as const;
  const STRICT_GRADER = ["$defs", "entry", "properties", "grader"] as const;

  it("is 1.0.0 with tool-order added to the recommended graders", async () => {
    const v100 = await copy("manni:artifact-evals:1.0.0");
    const v110 = await copy("manni:artifact-evals:1.1.0");
    const before = graderEnum(v100, OPEN_GRADER);
    expect(graderEnum(v110, OPEN_GRADER)).toEqual([...before, "tool-order"]);
    before.push("tool-order");
    expect(withoutProse(v110)).toEqual(withoutProse(v100));
  });

  it("is the 1.0.0 overlay with tool-order the eleventh named grader", async () => {
    const v100 = await copy("manni:artifact-evals-strict:1.0.0");
    const v110 = await copy("manni:artifact-evals-strict:1.1.0");
    const before = graderEnum(v100, STRICT_GRADER);
    expect(graderEnum(v110, STRICT_GRADER)).toEqual([...before, "tool-order"]);
    expect(graderEnum(v110, STRICT_GRADER)).toHaveLength(11);
    before.push("tool-order");
    expect(withoutProse(v110)).toEqual(withoutProse(v100));
  });

  it("names its neighbours at 1.1.0, and no draft", async () => {
    for (const ref of ["manni:artifact-evals:1.1.0", "manni:artifact-evals-strict:1.1.0"]) {
      const schema = await load(ref);
      expect(schema.$id).toBe(ref);
      const text = JSON.stringify(schema);
      expect({ ref, draft: /-proposal\.\d|docmeta:|:1\.0\.0"/.test(text) }).toEqual({
        ref,
        draft: false,
      });
      expect(text).toContain("tool-order");
    }
    const strict = await load("manni:artifact-evals-strict:1.1.0");
    expect(String(strict.description)).toContain("manni:artifact-evals:1.1.0");
  });
});
