/**
 * A Flare meta tag set read as a JSON Schema (proposal 0125, decision 20).
 */
import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { flareMetaSchema } from "../src/meta/core/flare-meta-schema.js";
import { loadSchema } from "../src/meta/core/schema-registry.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { renderPretty } from "../src/meta/reporters/index.js";
import { runQuery } from "../src/meta/commands/query.js";
import { DocmetaError } from "../src/meta/types.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "flare-meta");
const topics = (): string => readFileSync(join(dir, "Topics.flmeta"), "utf8");
const props = (schema: Record<string, unknown>): Record<string, Record<string, unknown>> =>
  schema.properties as Record<string, Record<string, unknown>>;

describe("flareMetaSchema", () => {
  const schema = flareMetaSchema(topics(), "./Topics.flmeta");

  it("reads the set as a 2020-12 object schema titled by its name", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.title).toBe("Topics");
    expect(schema.description).toBe("The meta tags every topic carries.");
  });

  it("requires nothing and leaves other keys to other schemas", () => {
    expect(schema.required).toBeUndefined();
    expect(schema.additionalProperties).toBeUndefined();
  });

  it("reads each tag as a property named as written", () => {
    expect(Object.keys(props(schema))).toEqual(["description", "Status", "Products", "Owner"]);
    expect(props(schema).description).toEqual({ type: "string", description: "Description meta tag" });
    // A type Flare adds later is still a string.
    expect(props(schema).Owner).toEqual({ type: "string" });
    expect(props(schema).Status).toEqual({
      type: "string",
      description: "Where the topic is in review.",
      pattern: "^(Draft|Reviewed|Published)(,(Draft|Reviewed|Published))*$",
    });
  });

  it("matches one or more Enum values joined by commas, and nothing else", () => {
    const re = new RegExp(props(schema).Status?.pattern as string);
    for (const ok of ["Draft", "Draft,Reviewed", "Published,Draft,Reviewed"]) expect(re.test(ok), ok).toBe(true);
    for (const bad of ["Reviewd", "Draft,", "Draft, Reviewed", "", ",Draft"]) expect(re.test(bad), bad).toBe(false);
  });

  it("escapes metacharacters, trims values and drops empty ones", () => {
    const pattern = props(schema).Products?.pattern as string;
    expect(pattern).toBe(
      "^(Widget Pro|C\\+\\+ SDK|A\\.B|\\(beta\\)\\|x)(,(Widget Pro|C\\+\\+ SDK|A\\.B|\\(beta\\)\\|x))*$",
    );
    const re = new RegExp(pattern);
    expect(re.test("C++ SDK,Widget Pro")).toBe(true);
    expect(re.test("(beta)|x")).toBe(true);
    expect(re.test("AxB")).toBe(false);
    expect(re.test("beta")).toBe(false);
  });

  it("compiles under the 2020-12 Ajv", () => {
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate({ Status: "Reviewed", Other: 1 })).toBe(true);
    expect(validate({ Status: "Reviewd" })).toBe(false);
  });

  it("refuses a file whose root is not a meta tag set, with exit 2", () => {
    const text = readFileSync(join(dir, "not-a-set.flmeta"), "utf8");
    expect(() => flareMetaSchema(text, "./not-a-set.flmeta")).toThrow(DocmetaError);
    expect(() => flareMetaSchema(text, "./not-a-set.flmeta")).toThrow(
      "./not-a-set.flmeta is not a Flare meta tag set: its root element is CatapultVariableSet.",
    );
    expect(new DocmetaError("x").exitCode).toBe(2);
  });

  it("refuses a file that is not XML", () => {
    expect(() => flareMetaSchema("{}", "./x.flmeta")).toThrow(
      "./x.flmeta is not a Flare meta tag set: its root element is missing.",
    );
  });
});

describe("a .flmeta schema ref", () => {
  it("loads through loadSchema, BOM and all, whatever the extension's case", async () => {
    const schema = await loadSchema("./Topics.flmeta", { fileBase: dir });
    expect(schema.title).toBe("Topics");
    const tmp = mkdtempSync(join(tmpdir(), "flmeta-"));
    try {
      writeFileSync(join(tmp, "Upper.FLMETA"), topics());
      expect((await loadSchema("./Upper.FLMETA", { fileBase: tmp })).title).toBe("Topics");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refuses a .flmeta that is not a meta tag set, naming the ref as written", async () => {
    await expect(loadSchema("./not-a-set.flmeta", { fileBase: dir })).rejects.toThrow(
      "./not-a-set.flmeta is not a Flare meta tag set: its root element is CatapultVariableSet.",
    );
  });

  it("fails a topic whose Status is not in the set, naming the set and its guidance", async () => {
    const { results, summary } = await runValidate({
      inputs: ["status-typo.htm"],
      cliSchemas: ["./Topics.flmeta"],
      noConfig: true,
      cwd: dir,
    });
    expect(summary.failed).toBe(1);
    const out = renderPretty(results, summary);
    expect(out).toContain(
      '/Status  must match pattern "^(Draft|Reviewed|Published)(,(Draft|Reviewed|Published))*$"',
    );
    expect(out).toContain("[./Topics.flmeta]");
    expect(out).toContain("      ./Topics.flmeta Status: Where the topic is in review.");
  });

  it("is never written by a meta query schema change, and still reads as a set member", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "flmeta-ddl-"));
    try {
      cpSync(join(dir, "..", "query-ddl"), tmp, { recursive: true });
      cpSync(join(dir, "Topics.flmeta"), join(tmp, "schemas", "Topics.flmeta"));
      writeFileSync(join(tmp, "docs", "one.md"), "---\ntitle: One\ndraft: false\nStatus: Draft\n---\n\nBody one.\n");
      const before = readFileSync(join(tmp, "schemas", "Topics.flmeta"), "utf8");
      const ddl = (sql: string, schemas: string[]) =>
        runQuery({ sql, inputs: ["docs"], cwd: tmp, dryRun: false, schemas });
      const refusal = "./schemas/Topics.flmeta is a Flare meta tag set, which manni reads and never writes.";
      for (const sql of ["ALTER TABLE docs ADD COLUMN reviewed TEXT", "ALTER TABLE docs DROP COLUMN Status"]) {
        const run = ddl(sql, ["./schemas/Topics.flmeta"]);
        await expect(run, sql).rejects.toThrow(refusal);
        await expect(ddl(sql, ["./schemas/Topics.flmeta"])).rejects.toBeInstanceOf(DocmetaError);
      }
      // A change to another schema of the set reads the tag set and leaves it be.
      await ddl("ALTER TABLE docs DROP COLUMN draft", ["./schemas/house.json", "./schemas/Topics.flmeta"]);
      expect(readFileSync(join(tmp, "schemas", "Topics.flmeta"), "utf8")).toBe(before);
      expect(readFileSync(join(tmp, "schemas", "house.json"), "utf8")).not.toContain('"draft"');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("passes a topic whose Status lists set values", async () => {
    const { summary } = await runValidate({
      inputs: ["status-ok.htm"],
      cliSchemas: ["./Topics.flmeta"],
      noConfig: true,
      cwd: dir,
    });
    expect(summary.failed).toBe(0);
  });
});
