/**
 * Per-item lines for manifest values.
 *
 * A manifest can supply a list of mappings (`citations:`), and a schema
 * finding deep inside it used to report the line of the owned key above the
 * whole list. The rule under test: a pointer inside a manifest-supplied value
 * resolves to the line of the deepest node it reaches, and falls back to the
 * nearest ancestor that exists. A mapping member sits on its key's line, a
 * list item on the line its node starts. Block and flow style both count.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCollections } from "../src/shared/collections.js";
import { memberOf } from "../src/meta/core/collections.js";
import {
  loadExternalMetadata,
  mergeExternalMetadata,
} from "../src/meta/core/external-metadata.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { DocmetaError, type ExtractedMetadata } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "fixtures", "external-metadata-items");
const MANIFEST = "items-meta.yaml";

const COLLECTIONS = parseCollections(
  [
    {
      name: "pages",
      paths: ["docs/**/*.md"],
      externalMetadata: [{ file: `./${MANIFEST}`, keys: ["citations"] }],
    },
  ],
  "manni.config.yaml",
  (message) => new DocmetaError(message),
);

function doc(data: Record<string, unknown>): ExtractedMetadata {
  return {
    present: true,
    data,
    format: "frontmatter",
    lineFor: () => undefined,
  };
}

async function merged(label: string) {
  const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
  return mergeExternalMetadata(
    label,
    doc({ title: "T" }),
    index,
    memberOf(COLLECTIONS, corpus, corpus, label),
    corpus,
  );
}

describe("external metadata: per-item lines", () => {
  it("records a line for every node inside a collection value, keyed by relative pointer", async () => {
    const index = await loadExternalMetadata(COLLECTIONS, { configDir: corpus, base: corpus });
    const sv = index?.byPath.get(resolve(corpus, "docs/block.md"))?.get("citations");
    expect(sv?.line).toBe(3);
    expect(sv?.lines?.get("/0")).toBe(4);
    expect(sv?.lines?.get("/0/id")).toBe(4);
    expect(sv?.lines?.get("/1/source")).toBe(8);
    expect(sv?.lines?.get("/1/source/file")).toBe(9);
    expect(sv?.lines?.get("/2")).toBe(10);
    expect(sv?.lines?.get("/3/extra")).toBe(13);
  });

  it("locates a block-style item, and each member, at its own line", async () => {
    const m = await merged("docs/block.md");
    expect(m.locate("/citations")).toEqual({ file: MANIFEST, line: 3 });
    expect(m.locate("citations")).toEqual({ file: MANIFEST, line: 3 });
    expect(m.locate("/citations/1")).toEqual({ file: MANIFEST, line: 7 });
    expect(m.locate("/citations/1/source")).toEqual({ file: MANIFEST, line: 8 });
    expect(m.locate("/citations/1/source/file")).toEqual({ file: MANIFEST, line: 9 });
  });

  it("locates a flow-style item at the line its node starts", async () => {
    const m = await merged("docs/flow.md");
    expect(m.locate("/citations")).toEqual({ file: MANIFEST, line: 15 });
    expect(m.locate("/citations/0")).toEqual({ file: MANIFEST, line: 16 });
    expect(m.locate("/citations/1/source/file")).toEqual({ file: MANIFEST, line: 17 });
    expect(m.locate("/citations/3/extra")).toEqual({ file: MANIFEST, line: 19 });
  });

  it("falls back to the nearest ancestor the pointer reaches", async () => {
    const m = await merged("docs/block.md");
    // Past a scalar: the scalar's line.
    expect(m.locate("/citations/1/source/file/deeper")).toEqual({ file: MANIFEST, line: 9 });
    // A member the item does not have: the item's line.
    expect(m.locate("/citations/2/id")).toEqual({ file: MANIFEST, line: 10 });
    // No such item: the owned key's line.
    expect(m.locate("/citations/9")).toEqual({ file: MANIFEST, line: 3 });
    // Still nothing for what the document owns.
    expect(m.locate("/title")).toBeUndefined();
  });
});

describe("external metadata: validate reports the deep line", () => {
  const run = () =>
    runValidate({ cwd: corpus, configPath: resolve(corpus, "manni.config.yaml"), inputs: [] });

  const lineOf = (
    errors: readonly { instancePath: string; keyword: string; file?: string; line?: number }[],
    instancePath: string,
    keyword: string,
  ) => {
    const e = errors.find((x) => x.instancePath === instancePath && x.keyword === keyword);
    expect(e?.file).toBe(MANIFEST);
    return e?.line;
  };

  it("block style: a type error, a missing member and a stray member each sit on their own line", async () => {
    const r = await run();
    const errors = r.results.find((x) => x.file === "docs/block.md")?.errors ?? [];
    expect(lineOf(errors, "/citations/1/source/file", "type")).toBe(9);
    expect(lineOf(errors, "/citations/2", "required")).toBe(10);
    // The stray key's own line, not the item's: the offending value is the child.
    expect(lineOf(errors, "/citations/3", "additionalProperties")).toBe(13);
  });

  it("flow style: the same findings sit on each item's line", async () => {
    const r = await run();
    const errors = r.results.find((x) => x.file === "docs/flow.md")?.errors ?? [];
    expect(lineOf(errors, "/citations/1/source/file", "type")).toBe(17);
    expect(lineOf(errors, "/citations/2", "required")).toBe(18);
    expect(lineOf(errors, "/citations/3", "additionalProperties")).toBe(19);
  });
});
