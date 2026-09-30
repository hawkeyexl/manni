/**
 * The values `fill` offers for the fields that name a glossary term or a page.
 *
 * The term labels come from the termbase, through a source the term domain
 * registers, or from `FillOptions.termLabels`. The page ids come from the `id`
 * of every fellow member of the page's collections. Term values are checked;
 * page values are a hint the model may pass over for a URL.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill, collectCandidates, collectDefs } from "../src/meta/commands/fill.js";
import { buildEnvelopeSchema } from "../src/meta/commands/fill-prompt.js";
import {
  MAX_OFFERED,
  fieldHints,
  offered,
  pageIdReader,
  termValueCheck,
} from "../src/meta/commands/fill-hints.js";
import { loadSchema } from "../src/meta/core/schema-registry.js";
import { loadConfig } from "../src/meta/core/config.js";
import {
  CONCEPT_FIELDS,
  PAGE_FIELDS,
  TERM_FIELDS,
  TERM_RELATION_FIELDS,
} from "../src/shared/reference-fields.js";
import { registerTermLabelSource } from "../src/shared/term-labels.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "fixtures", "fill", "hints");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-fill-hints-"));
  await cp(fixtureDir, dir, { recursive: true });
});

afterEach(async () => {
  registerTermLabelSource(undefined);
  await rm(dir, { recursive: true, force: true });
});

/** A provider answering each request in turn with the given fields. */
function script(...answers: Record<string, { value: unknown; confidence: number }>[]): MockProvider {
  return new MockProvider(
    answers.map((fields) => ({
      json: Object.fromEntries(
        Object.entries(fields).map(([k, v]) => [k, { ...v, reasoning: "stated in the page" }]),
      ),
    })),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A node of a JSON value, by keys, or a failure naming the missing key. */
function at(value: unknown, ...keys: string[]): unknown {
  let node = value;
  for (const key of keys) {
    if (!isRecord(node) || !Object.hasOwn(node, key)) {
      throw new Error(`no "${key}" in ${JSON.stringify(node)}`);
    }
    node = node[key];
  }
  return node;
}

/** The `value` schema one request sent for `key`. */
function sentValue(provider: MockProvider, index: number, key: string): unknown {
  return at(provider.requests[index]?.schema, "properties", key, "properties", "value");
}

/** Every node of a JSON value, depth first. */
function nodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isRecord(value)) return [];
  return [value, ...Object.values(value).flatMap(nodes)];
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The `enum` lists anywhere in a schema. */
function enums(schema: unknown): unknown[][] {
  return nodes(schema).flatMap((node) => {
    const listed: unknown = node.enum;
    return Array.isArray(listed) ? [listed] : [];
  });
}

describe("the reference-field table", () => {
  it("lists the glossary-term fields and the page fields", () => {
    expect(TERM_FIELDS).toEqual([
      ["concepts"],
      ["graph", "concepts"],
      ["broader"],
      ["narrower"],
      ["related-terms"],
      ["see"],
    ]);
    expect(CONCEPT_FIELDS).toEqual([["concepts"], ["graph", "concepts"]]);
    expect(TERM_RELATION_FIELDS).toEqual(["broader", "narrower", "related-terms", "see"]);
    expect(PAGE_FIELDS).toEqual([
      ["related-pages"],
      ["next-steps"],
      ["prerequisites"],
      ["replaced-by"],
      ["supersedes"],
    ]);
  });
});

describe("offered", () => {
  it("dedupes and sorts the values", () => {
    expect(offered(["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("offers nothing for an empty list, which as an enum would admit nothing", () => {
    expect(offered([])).toBeUndefined();
  });

  it(`offers up to ${String(MAX_OFFERED)} values, and nothing over that`, () => {
    const values = (n: number): string[] => Array.from({ length: n }, (_, i) => `v${String(i).padStart(4, "0")}`);
    expect(MAX_OFFERED).toBe(500);
    expect(offered(values(500))).toHaveLength(500);
    expect(offered(values(501))).toBeUndefined();
  });
});

describe("pageIdReader", () => {
  it("offers the ids of the page's fellow members, never its own, and skips a page with no id", async () => {
    const loaded = await loadConfig(undefined, dir);
    if (loaded === null) throw new Error("expected the fixture config");
    const read = pageIdReader({ collections: loaded.collections, configDir: loaded.dir });
    expect(await read(join(dir, "guides", "start.md"), ["guides"])).toEqual(["guide-configure"]);
    expect(await read(join(dir, "guides", "untitled.md"), ["guides"])).toEqual([
      "guide-configure",
      "guide-start",
    ]);
  });

  it("offers nothing to a page in no collection", async () => {
    const loaded = await loadConfig(undefined, dir);
    if (loaded === null) throw new Error("expected the fixture config");
    const read = pageIdReader({ collections: loaded.collections, configDir: loaded.dir });
    expect(await read(join(dir, "elsewhere", "outside.md"), [])).toEqual([]);
  });
});

describe("fieldHints", () => {
  const candidate = (key: string) => ({ key, subschema: {}, required: false, present: false });

  it("gives each candidate in the table its kind's values, nested fields included", () => {
    const hints = fieldHints(
      [candidate("concepts"), candidate("graph"), candidate("related-pages"), candidate("title")],
      { terms: ["schema set"], pages: ["guide-start"] },
    );
    expect(hints).toEqual([
      { path: ["concepts"], kind: "term", values: ["schema set"] },
      { path: ["graph", "concepts"], kind: "term", values: ["schema set"] },
      { path: ["related-pages"], kind: "page", values: ["guide-start"] },
    ]);
  });

  it("gives no hint for a kind with nothing offered", () => {
    expect(fieldHints([candidate("concepts"), candidate("related-pages")], {})).toEqual([]);
  });
});

describe("termValueCheck", () => {
  const hints = fieldHints(
    ["concepts", "graph", "broader", "see"].map((key) => ({ key, subschema: {}, required: false, present: false })),
    { terms: ["extractor", "schema set"] },
  );
  const check = termValueCheck(hints, { labels: ["extractor", "schema set"], ids: ["metadata-extractor", "schema-set"] });

  it("accepts a label, ignoring case, and names each value that is not one", () => {
    expect(check("concepts", ["Schema Set", "extractor"])).toEqual([]);
    expect(check("concepts", ["schema set", "not-a-term"])).toEqual([
      "/concepts/1: must be a glossary term label",
    ]);
    expect(check("concepts", "not-a-term")).toEqual(["/concepts: must be a glossary term label"]);
  });

  it("refuses an id in concepts, as term check does", () => {
    expect(check("concepts", ["schema-set"])).toEqual(["/concepts/0: must be a glossary term label"]);
  });

  it("accepts a label or an id in a term relation, as term check resolves them", () => {
    expect(check("broader", ["metadata-extractor", "schema set"])).toEqual([]);
    expect(check("see", "nowhere")).toEqual(["/see: must be a glossary term label"]);
  });

  it("checks a nested field inside its candidate's value", () => {
    expect(check("graph", { concepts: ["schema set", "nope"], label: "x" })).toEqual([
      "/graph/concepts/1: must be a glossary term label",
    ]);
    expect(check("graph", { label: "x" })).toEqual([]);
  });

  it("leaves a key with no hint alone", () => {
    expect(check("title", "anything")).toEqual([]);
  });
});

describe("the offered values in the sent schema", () => {
  const envelopeFor = async (keys: string[], hints: Parameters<typeof buildEnvelopeSchema>[2]) => {
    const schemas = [
      await loadSchema("manni:structure:1.0.0"),
      await loadSchema("manni:graph:1.0.0"),
    ];
    const candidates = collectCandidates(schemas, {}, [], new Set(keys));
    return buildEnvelopeSchema(candidates, collectDefs(schemas), hints);
  };

  it("replaces a term field's strings with the labels, as an enum", async () => {
    const envelope = await envelopeFor(["concepts"], [
      { path: ["concepts"], kind: "term", values: ["extractor", "schema set"] },
    ]);
    const value = at(envelope.sent, "properties", "concepts", "properties", "value");
    const strings = nodes(value).filter((n) => n.type === "string");
    expect(strings.length).toBeGreaterThan(0);
    for (const node of strings) expect(node.enum).toEqual(["extractor", "schema set"]);
    // A list's items are the labels too.
    const arrays = nodes(value).filter((n) => n.type === "array");
    expect(arrays.length).toBeGreaterThan(0);
    for (const node of arrays) expect(at(node, "items", "enum")).toEqual(["extractor", "schema set"]);
  });

  it("offers a page field's ids beside a free string", async () => {
    const envelope = await envelopeFor(["related-pages"], [
      { path: ["related-pages"], kind: "page", values: ["guide-start"] },
    ]);
    const value = at(envelope.sent, "properties", "related-pages", "properties", "value");
    const listed = { type: "string", enum: ["guide-start"] };
    // Every place a string may go offers the ids, and a free string beside them.
    const branchesOf = (node: Record<string, unknown>): unknown[] => {
      const branches: unknown = node.oneOf;
      return Array.isArray(branches) ? branches : [];
    };
    const offers = nodes(value).filter((n) => branchesOf(n).some((b) => isEqual(b, listed)));
    expect(offers.length).toBeGreaterThan(1);
    for (const node of offers) {
      expect(branchesOf(node).some((b) => isEqual(b, { type: "string" }))).toBe(true);
    }
    const strings = nodes(value).filter((n) => n.type === "string");
    expect(strings.every((n) => isEqual(n, listed) || isEqual(n, { type: "string" }))).toBe(true);
  });

  it("offers the labels inside a nested field", async () => {
    const envelope = await envelopeFor(["graph"], [
      { path: ["graph", "concepts"], kind: "term", values: ["schema set"] },
    ]);
    const value = at(envelope.sent, "properties", "graph", "properties", "value");
    expect(enums(value)).toContainEqual(["schema set"]);
  });

  it("leaves the full subschema that checks the value untouched", async () => {
    const plain = await envelopeFor(["concepts"], []);
    const hinted = await envelopeFor(["concepts"], [
      { path: ["concepts"], kind: "term", values: ["schema set"] },
    ]);
    expect(hinted.full).toEqual(plain.full);
    expect(enums(plain.sent)).toEqual([]);
  });
});

describe("runFill — offered values", () => {
  const opts = (provider: MockProvider, fields: string[]) => ({
    cwd: dir,
    inputs: ["guides/start.md"],
    fields,
    dryRun: true,
    cache: false as const,
    inferenceProvider: provider,
  });

  it("offers FillOptions.termLabels for concepts", async () => {
    const provider = script({ concepts: { value: ["schema set"], confidence: 0.9 } });
    const run = await runFill({ ...opts(provider, ["concepts"]), termLabels: ["schema set", "extractor"] });
    expect(enums(sentValue(provider, 0, "concepts"))).toContainEqual(["extractor", "schema set"]);
    expect(run.results[0]?.fields[0]).toMatchObject({ field: "/concepts", written: true, value: ["schema set"] });
  });

  it("offers the registered source's labels when no termLabels are given", async () => {
    registerTermLabelSource(() =>
      Promise.resolve([
        { label: "schema set", id: "schema-set" },
        { label: "extractor", id: "metadata-extractor" },
      ]),
    );
    const provider = script({ concepts: { value: ["extractor"], confidence: 0.9 } });
    await runFill(opts(provider, ["concepts"]));
    expect(enums(sentValue(provider, 0, "concepts"))).toContainEqual(["extractor", "schema set"]);
  });

  it("offers no term values when nothing is registered", async () => {
    const provider = script({ concepts: { value: ["anything"], confidence: 0.9 } });
    const run = await runFill(opts(provider, ["concepts"]));
    expect(enums(sentValue(provider, 0, "concepts"))).toEqual([]);
    expect(provider.requests).toHaveLength(1);
    expect(run.results[0]?.fields[0]).toMatchObject({ written: true, value: ["anything"] });
  });

  it("asks once more for a value that is not a label, then skips it as schema-mismatch", async () => {
    const provider = script(
      { concepts: { value: ["not-a-term"], confidence: 0.9 } },
      { concepts: { value: ["still-not-a-term"], confidence: 0.9 } },
    );
    const run = await runFill({ ...opts(provider, ["concepts"]), termLabels: ["schema set"] });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.user).toContain("/concepts/0: must be a glossary term label");
    expect(run.results[0]?.fields[0]).toMatchObject({
      field: "/concepts",
      written: false,
      skipReason: "schema-mismatch",
    });
  });

  it("writes the retry's label when the second answer is one", async () => {
    const provider = script(
      { concepts: { value: ["not-a-term"], confidence: 0.9 } },
      { concepts: { value: ["schema set"], confidence: 0.9 } },
    );
    const run = await runFill({ ...opts(provider, ["concepts"]), termLabels: ["schema set"] });
    expect(run.results[0]?.fields[0]).toMatchObject({ written: true, value: ["schema set"] });
  });

  it("offers the fellow members' ids for a page field, and accepts a URL", async () => {
    const provider = script({
      "related-pages": { value: ["guide-configure", "https://example.com/elsewhere"], confidence: 0.9 },
    });
    const run = await runFill(opts(provider, ["related-pages"]));
    expect(provider.requests).toHaveLength(1);
    expect(enums(sentValue(provider, 0, "related-pages"))).toContainEqual(["guide-configure"]);
    expect(run.results[0]?.fields[0]).toMatchObject({
      field: "/related-pages",
      written: true,
      value: ["guide-configure", "https://example.com/elsewhere"],
    });
  });

  it("asks again when the offered values change, and replays when they do not", async () => {
    const cached = (provider: MockProvider) => ({ ...opts(provider, ["concepts"]), cache: true });
    const answer = { concepts: { value: ["schema set"], confidence: 0.9 } };
    const first = script(answer);
    await runFill({ ...cached(first), termLabels: ["schema set"] });
    expect(first.requests).toHaveLength(1);

    const same = script(answer);
    const replay = await runFill({ ...cached(same), termLabels: ["schema set"] });
    expect(same.requests).toHaveLength(0);
    expect(replay.summary.cached).toBe(1);

    const grown = script(answer);
    await runFill({ ...cached(grown), termLabels: ["schema set", "extractor"] });
    expect(grown.requests).toHaveLength(1);
  });
});
