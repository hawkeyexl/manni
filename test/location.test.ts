/**
 * `x-manni-location` (proposal 0047): the schema keyword that says whether a
 * top-level key prefers the page or external metadata, and
 * `Validator.locationPreferences`, the one question commands ask of it.
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Validator } from "../src/meta/core/validator.js";
import { LOCATION_KEYWORD } from "../src/meta/core/location.js";
import { DocmetaError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "location");
const PLAIN = join(fixtures, "plain.schema.json");
const COMPOSED = join(fixtures, "composed.schema.json");
const OWNER_PAGE = join(fixtures, "owner-page.schema.json");
const BAD_VALUE = join(fixtures, "bad-value.schema.json");
const SCHEMA_EXTERNAL = join(fixtures, "schema-external.schema.json");
const CONFLICT = join(fixtures, "conflict.schema.json");

/** The map as a plain object, for readable equality. */
async function prefs(
  validator: Validator,
  data: Record<string, unknown>,
  refs: string[],
): Promise<Record<string, unknown>> {
  return Object.fromEntries(await validator.locationPreferences(data, refs));
}

describe("x-manni-location: the keyword", () => {
  it("is spelled x-manni-location", () => {
    expect(LOCATION_KEYWORD).toBe("x-manni-location");
  });

  it("records plain marks on top-level properties, keyed by unescaped name", async () => {
    const data = { title: "t", owner: "o", "a/b": "x", tags: [] };
    expect(await prefs(new Validator(), data, [PLAIN])).toEqual({
      title: { location: "page", schema: PLAIN },
      owner: { location: "external", schema: PLAIN },
      "a/b": { location: "external", schema: PLAIN },
    });
  });

  it("gives no entry for a property the data does not hold", async () => {
    expect(await prefs(new Validator(), { title: "t" }, [PLAIN])).toEqual({
      title: { location: "page", schema: PLAIN },
    });
  });

  it("counts marks through $ref and allOf, and a taken if/then branch", async () => {
    const data = { kind: "internal", owner: "o", team: "t", ticket: "T-1" };
    expect(await prefs(new Validator(), data, [COMPOSED])).toEqual({
      owner: { location: "external", schema: COMPOSED },
      team: { location: "external", schema: COMPOSED },
      ticket: { location: "external", schema: COMPOSED },
    });
  });

  it("ignores a then branch Ajv does not take", async () => {
    const data = { kind: "public", owner: "o", ticket: "T-1" };
    expect(await prefs(new Validator(), data, [COMPOSED])).toEqual({
      owner: { location: "external", schema: COMPOSED },
    });
  });

  it("accepts and ignores a nested mark", async () => {
    const data = { review: { notes: "n" } };
    expect(await prefs(new Validator(), data, [COMPOSED])).toEqual({});
  });

  it("strips $schema from the subject before evaluating", async () => {
    const data = { $schema: "x.json", title: "t" };
    expect(await prefs(new Validator(), data, [PLAIN])).toEqual({
      title: { location: "page", schema: PLAIN },
    });
  });

  it("records a mark whether or not the value is valid, and does not change validation", async () => {
    const validator = new Validator();
    const data = { owner: 5 };
    const before = await validator.validate(data, [PLAIN], () => undefined);
    expect(await prefs(validator, data, [PLAIN])).toEqual({
      owner: { location: "external", schema: PLAIN },
    });
    const after = await validator.validate(data, [PLAIN], () => undefined);
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
  });

  it("lets the later ref win a disagreement, and names it", async () => {
    const validator = new Validator();
    const data = { owner: "o", title: "t" };
    expect(await prefs(validator, data, [PLAIN, OWNER_PAGE])).toEqual({
      owner: { location: "page", schema: OWNER_PAGE },
      title: { location: "page", schema: PLAIN },
    });
    expect(await prefs(validator, data, [OWNER_PAGE, PLAIN])).toEqual({
      owner: { location: "external", schema: PLAIN },
      title: { location: "page", schema: PLAIN },
    });
  });

  it("refuses one schema that says both values for one key", async () => {
    const run = new Validator().locationPreferences({ owner: "o" }, [CONFLICT]);
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(
      `${CONFLICT}: "x-manni-location" says both "page" and "external" for "owner".`,
    );
  });

  it("refuses a value other than page or external at compile, exit 2", async () => {
    const run = new Validator().locationPreferences({ owner: "o" }, [BAD_VALUE]);
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(
      `${BAD_VALUE}: "x-manni-location" must be "page" or "external".`,
    );
    await expect(run).rejects.toMatchObject({ exitCode: 2 });
    // Ordinary validation compiles the same schema and refuses it the same way.
    await expect(
      new Validator().validate({ owner: "o" }, [BAD_VALUE], () => undefined),
    ).rejects.toThrow(`${BAD_VALUE}: "x-manni-location" must be "page" or "external".`);
  });

  it("refuses $schema marked external at compile, exit 2", async () => {
    const run = new Validator().validate({ title: "t" }, [SCHEMA_EXTERNAL], () => undefined);
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(
      `${SCHEMA_EXTERNAL}: "$schema" cannot be stored in external metadata.`,
    );
    await expect(run).rejects.toMatchObject({ exitCode: 2 });
  });

  it("leaves markedPointers untouched", async () => {
    const marks = await new Validator().markedPointers({ owner: "o" }, [PLAIN]);
    expect([...marks]).toEqual([]);
  });
});
