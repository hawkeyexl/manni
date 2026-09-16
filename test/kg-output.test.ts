/**
 * `x-manni-kg-output` (proposal 0051 §5): the schema keyword that says whether
 * a top-level key belongs in a published graph, and
 * `Validator.kgOutputPreferences`, the one question kg's harvest asks of it.
 */
import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Validator } from "../src/meta/core/validator.js";
import { KG_OUTPUT_KEYWORD } from "../src/meta/core/kg-output.js";
import { DocmetaError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "kg-output");
const PLAIN = join(fixtures, "plain.schema.json");
const COMPOSED = join(fixtures, "composed.schema.json");
const OWNER_HARVESTED = join(fixtures, "owner-harvested.schema.json");
const ANYOF = join(fixtures, "anyof.schema.json");
const BAD_VALUE = join(fixtures, "bad-value.schema.json");

/** The map as a plain object, for readable equality. */
async function prefs(
  validator: Validator,
  data: Record<string, unknown>,
  refs: string[],
): Promise<Record<string, unknown>> {
  return Object.fromEntries(await validator.kgOutputPreferences(data, refs));
}

describe("x-manni-kg-output: the keyword", () => {
  it("is spelled x-manni-kg-output", () => {
    expect(KG_OUTPUT_KEYWORD).toBe("x-manni-kg-output");
  });

  it("records plain marks on top-level properties, keyed by unescaped name", async () => {
    const data = { title: "t", owner: "o", "a/b": "x", audiences: [] };
    expect(await prefs(new Validator(), data, [PLAIN])).toEqual({
      owner: false,
      "a/b": false,
      audiences: true,
    });
  });

  it("gives no entry for a key no schema marks, which the caller reads as true", async () => {
    expect(await prefs(new Validator(), { title: "t" }, [PLAIN])).toEqual({});
  });

  it("gives no entry for a property the data does not hold", async () => {
    expect(await prefs(new Validator(), { owner: "o" }, [PLAIN])).toEqual({
      owner: false,
    });
  });

  it("counts marks through $ref and allOf, and a taken if/then branch", async () => {
    const data = { kind: "internal", owner: "o", stakeholders: "s", ticket: "T-1" };
    expect(await prefs(new Validator(), data, [COMPOSED])).toEqual({
      owner: false,
      stakeholders: false,
      ticket: false,
    });
  });

  it("ignores a then branch Ajv does not take", async () => {
    const data = { kind: "public", owner: "o", ticket: "T-1" };
    expect(await prefs(new Validator(), data, [COMPOSED])).toEqual({
      owner: false,
    });
  });

  it("accepts and ignores a mark nested inside kg", async () => {
    const data = { kg: { label: "l" } };
    expect(await prefs(new Validator(), data, [COMPOSED])).toEqual({});
  });

  it("strips $schema from the subject before evaluating", async () => {
    const data = { $schema: "x.json", owner: "o" };
    expect(await prefs(new Validator(), data, [PLAIN])).toEqual({ owner: false });
  });

  it("records a mark whether or not the value is valid, and does not change validation", async () => {
    const validator = new Validator();
    const data = { owner: 5 };
    const before = await validator.validate(data, [PLAIN], () => undefined);
    expect(await prefs(validator, data, [PLAIN])).toEqual({ owner: false });
    const after = await validator.validate(data, [PLAIN], () => undefined);
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
  });

  it("lets the later ref win a disagreement", async () => {
    const validator = new Validator();
    const data = { owner: "o" };
    expect(await prefs(validator, data, [PLAIN, OWNER_HARVESTED])).toEqual({
      owner: true,
    });
    expect(await prefs(validator, data, [OWNER_HARVESTED, PLAIN])).toEqual({
      owner: false,
    });
  });

  it("gives no preference when one schema says both across branches", async () => {
    const validator = new Validator();
    // Both anyOf branches are evaluated for a string, so this ref decides nothing.
    expect(await prefs(validator, { owner: "platform" }, [ANYOF])).toEqual({});
    expect(await validator.validate({ owner: "platform" }, [ANYOF], () => undefined)).toEqual([]);
  });

  it("keeps an earlier ref's preference when a later ref says both at evaluation", async () => {
    expect(await prefs(new Validator(), { owner: "platform" }, [PLAIN, ANYOF])).toEqual({
      owner: false,
    });
  });

  it("refuses a value that is not true or false at compile, exit 2", async () => {
    const run = new Validator().kgOutputPreferences({ owner: "o" }, [BAD_VALUE]);
    await expect(run).rejects.toThrow(DocmetaError);
    await expect(run).rejects.toThrow(
      `${BAD_VALUE}: "x-manni-kg-output" must be true or false.`,
    );
    await expect(run).rejects.toMatchObject({ exitCode: 2 });
    // Ordinary validation compiles the same schema and refuses it the same way.
    await expect(
      new Validator().validate({ owner: "o" }, [BAD_VALUE], () => undefined),
    ).rejects.toThrow(`${BAD_VALUE}: "x-manni-kg-output" must be true or false.`);
  });

  it("leaves markedPointers and locationPreferences untouched", async () => {
    const validator = new Validator();
    const data = { owner: "o" };
    expect([...(await validator.markedPointers(data, [PLAIN]))]).toEqual([]);
    expect(
      Object.fromEntries(await validator.locationPreferences(data, [PLAIN])),
    ).toEqual({});
  });
});
