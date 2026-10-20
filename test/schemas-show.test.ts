/**
 * `manni meta schemas show <ref>` (proposal 0089): what a schema asks for,
 * property by property, before an author writes a page against it.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runShowSchema } from "../src/meta/commands/schemas.js";
import { renderSchemaShow } from "../src/meta/reporters/schema-show.js";
import { DocmetaError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const GUIDANCE = resolve(here, "fixtures", "guidance");

describe("runShowSchema", () => {
  it("reads a built-in's properties in schema order, with what each accepts", async () => {
    const shown = await runShowSchema({ ref: "manni:core:1.0.0", cwd: root, noConfig: true });
    expect(shown.id).toBe("manni:core:1.0.0");
    expect(shown.title).toBe("manni core vocabulary v1.0.0");
    expect(shown.guide).toBe("https://hawkeyexl.github.io/manni/meta/reference/schemas/manni-core/");
    expect(shown.properties.map((p) => p.key).slice(0, 3)).toEqual(["title", "description", "id"]);
    expect(shown.properties[0]).toMatchObject({
      key: "title",
      required: true,
      types: ["string"],
      bounds: [["minLength", 1]],
    });
  });

  it("counts a key required through an allOf $ref as required", async () => {
    const shown = await runShowSchema({ ref: "./allof-ref.schema.json", cwd: GUIDANCE, noConfig: true });
    expect(shown.properties.map((p) => [p.key, p.required])).toEqual([
      ["title", true],
      ["summary", false],
    ]);
  });

  it("answers a published URL with the built-in it names", async () => {
    const byUrl = await runShowSchema({
      ref: "https://hawkeyexl.github.io/manni/schemas/dcmi/1.1.json",
      cwd: root,
      noConfig: true,
    });
    const byId = await runShowSchema({ ref: "dcmi:elements:1.1", cwd: root, noConfig: true });
    expect(renderSchemaShow(byUrl, "pretty")).toBe(renderSchemaShow(byId, "pretty"));
  });

  it("resolves a registered id through the discovered config, with no guide", async () => {
    const shown = await runShowSchema({ ref: "house:page:1.0.0", cwd: GUIDANCE });
    expect(shown.guide).toBeNull();
    expect(shown.properties.find((p) => p.key === "tier")).toMatchObject({
      required: true,
      values: ["gold", "silver"],
    });
  });

  it("reads -c over discovery, and --no-config ignores both", async () => {
    const shown = await runShowSchema({
      ref: "house:page:1.0.0",
      cwd: root,
      configPath: "test/fixtures/guidance/manni.config.yaml",
    });
    expect(shown.id).toBe("house:page:1.0.0");
    await expect(runShowSchema({ ref: "house:page:1.0.0", cwd: GUIDANCE, noConfig: true })).rejects.toThrow(
      'Unknown schema "house:page:1.0.0". manni meta schemas lists the built-in ids. Registered by meta.register: none.',
    );
  });

  it("refuses a file that is not there", async () => {
    const run = runShowSchema({ ref: "./schemas/nope.json", cwd: root, noConfig: true });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow('Schema file not found: "./schemas/nope.json".');
  });
});

describe("renderSchemaShow", () => {
  it("pretty prints the header, the guide, then one entry per property", async () => {
    const shown = await runShowSchema({ ref: "house:page:1.0.0", cwd: GUIDANCE });
    expect(renderSchemaShow(shown, "pretty")).toBe(
      [
        "house:page:1.0.0  House page",
        "Every page names its team and its tier.",
        "",
        "  team  required, string, minLength 1",
        "    The team that answers for the page. Use the slug from the team directory.",
        "  tier  required, one of: \"gold\", \"silver\"",
        "    How quickly the team answers a report.",
        "  review  optional, object",
        "    When the page was last reviewed.",
        "  contact  optional",
        "    An email address or a chat handle.",
        "  ticket  optional, string",
        "    The tracking ticket, kept in the collection's manifest.",
        "",
      ].join("\n"),
    );
  });

  it("pretty prints the Guide line for a built-in", async () => {
    const shown = await runShowSchema({ ref: "manni:core:1.0.0", cwd: root, noConfig: true });
    const lines = renderSchemaShow(shown, "pretty").split("\n");
    expect(lines[0]).toBe("manni:core:1.0.0  manni core vocabulary v1.0.0");
    expect(lines[2]).toBe("Guide: https://hawkeyexl.github.io/manni/meta/reference/schemas/manni-core/");
    expect(lines).toContain("  title  required, string, minLength 1");
  });

  it("json prints the schema as loaded", async () => {
    const shown = await runShowSchema({ ref: "house:page:1.0.0", cwd: GUIDANCE });
    expect(JSON.parse(renderSchemaShow(shown, "json"))).toEqual(shown.schema);
  });

  it("markdown writes a frontmatter skeleton, leaving external keys out", async () => {
    const shown = await runShowSchema({ ref: "house:page:1.0.0", cwd: GUIDANCE });
    expect(renderSchemaShow(shown, "markdown")).toBe(
      [
        "---",
        "# house:page:1.0.0, House page",
        "# The team that answers for the page.",
        "team:",
        "# How quickly the team answers a report.",
        'tier: "gold"',
        "# When the page was last reviewed.",
        "# review:",
        "# An email address or a chat handle.",
        "# contact:",
        "---",
        "",
      ].join("\n"),
    );
  });

  it("markdown names the guide of a built-in and quotes a key YAML would misread", async () => {
    const shown = await runShowSchema({ ref: "ogp:article:1.0", cwd: root, noConfig: true });
    const text = renderSchemaShow(shown, "markdown");
    expect(text.split("\n")[2]).toBe("# Guide: https://hawkeyexl.github.io/manni/meta/reference/schemas/ogp-article/");
    expect(text).toContain('"og:title":');
  });
});
