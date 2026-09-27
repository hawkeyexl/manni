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

/** The draft with `locale` gone from its properties, which 0067 dropped from core. */
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
