import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  applyKgFields,
  existingKgFields,
} from "../../../src/kg/core/frontmatter-edit.js";

const BODY = "\n# Title\n\nBody text stays untouched.\n";

describe("applyKgFields", () => {
  it("adds a kg map to existing frontmatter, preserving body byte-for-byte", () => {
    const content = `---\ntitle: T\ntags: [x] # keep me\n---${BODY}`;
    const result = applyKgFields(content, "a.md", {
      label: "Config",
      concepts: ["reference"],
    });
    expect(result.applied.sort()).toEqual(["concepts", "label"]);
    expect(result.content.endsWith(BODY)).toBe(true);
    expect(result.content).toContain("# keep me"); // YAML comment survives
    expect(result.content).toContain("label: Config");
    expect(result.content).toContain("concepts: [ reference ]");
  });

  it("creates a frontmatter block when the file has none", () => {
    const content = "# No frontmatter\n";
    const result = applyKgFields(content, "a.md", { label: "Topic" });
    expect(result.content.startsWith("---\n")).toBe(true);
    expect(result.content).toContain("kg:");
    expect(result.content).toContain("label: Topic");
    expect(result.content.endsWith("# No frontmatter\n")).toBe(true);
  });

  it("nests a dotted field when the file has no frontmatter at all", () => {
    // The no-frontmatter branch builds the whole `kg` map from scratch, and a
    // dotted section path has to nest inside it rather than land as a key
    // literally named `sections.install.type` (ADR 01032). Every fixture in
    // fill-sections.test.ts starts from a page that already has a block, so
    // this branch had no coverage.
    const content = "# No frontmatter\n";
    const result = applyKgFields(content, "a.md", {
      "sections.install.type": "task",
    });
    expect(result.applied).toEqual(["sections.install.type"]);
    expect(result.content).toContain("sections:");
    expect(result.content).toContain("install:");
    expect(result.content).toContain("type: task");
    expect(result.content).not.toContain("sections.install.type");
  });

  it("leaves a non-map where a section path needs one, and reports it", () => {
    // A human wrote `kg.sections: none`. Writing through it would destroy their
    // value to make room for a shape we cannot infer they wanted, so the field
    // is skipped rather than applied — the `missingParent` guard.
    const content = `---\ntitle: T\nkg:\n  sections: none\n---${BODY}`;
    const result = applyKgFields(content, "a.md", {
      "sections.install.type": "task",
    });
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(["sections.install.type"]);
    expect(result.content).toContain("sections: none");
  });

  it("preserves human-set fields unless forced", () => {
    const content = `---\nkg:\n  label: Human Choice\n---${BODY}`;
    const soft = applyKgFields(content, "a.md", { label: "Model Choice" });
    expect(soft.applied).toEqual([]);
    expect(soft.skipped).toEqual(["label"]);
    expect(soft.content).toBe(content); // untouched

    const forced = applyKgFields(
      content,
      "a.md",
      { label: "Model Choice" },
      { force: true },
    );
    expect(forced.applied).toEqual(["label"]);
    expect(forced.content).toContain("label: Model Choice");
  });

  it("keeps CRLF line endings", () => {
    const content = "---\r\ntitle: Win\r\n---\r\n\r\n# H\r\n";
    const result = applyKgFields(content, "a.md", { label: "Topic" });
    expect(result.content).toContain("\r\n");
    expect(result.content).not.toMatch(/(?<!\r)\n.*label/);
    expect(result.content.endsWith("# H\r\n")).toBe(true);
  });

  it("drops empty and null values", () => {
    const content = `---\ntitle: T\n---${BODY}`;
    const result = applyKgFields(content, "a.md", {
      label: "X",
      "alt-labels": [],
      "related-concepts": null,
    });
    expect(result.applied).toEqual(["label"]);
    expect(result.content).not.toContain("alt-labels");
  });

  /**
   * `options.page` writes beside the `kg` map rather than inside it, so a fill
   * is still one parse and one serialization (proposal 0046's
   * `meta-provenance` is the one caller).
   */
  describe("options.page", () => {
    const RECORD = [{ "generated-by": "m1", fields: ["/kg/label"] }];

    it("writes a top-level key beside kg, keeping the body byte-for-byte", () => {
      const content = `---\ntitle: T\n---${BODY}`;
      const result = applyKgFields(
        content,
        "a.md",
        { label: "X" },
        { page: { "meta-provenance": RECORD } },
      );
      expect(result.applied).toEqual(["label"]); // page keys are not fields
      const data = parse(result.content.slice(4, result.content.indexOf("\n---", 4))) as Record<string, unknown>;
      expect(data["meta-provenance"]).toEqual(RECORD);
      expect(data["kg"]).toEqual({ label: "X" });
      expect(result.content.endsWith(BODY)).toBe(true);
    });

    it("always overwrites, because the caller computes the value whole", () => {
      const content = `---\nmeta-provenance:\n  - generated-by: old\n    fields: [/kg/label]\n---${BODY}`;
      const result = applyKgFields(
        content,
        "a.md",
        { label: "X" },
        { page: { "meta-provenance": RECORD } },
      );
      expect(result.content).toContain("m1");
      expect(result.content).not.toContain("old");
    });

    it("writes even when no kg field does, and mints no empty kg map", () => {
      const content = `---\ntitle: T\n---${BODY}`;
      const result = applyKgFields(
        content,
        "a.md",
        {},
        { page: { "meta-provenance": RECORD } },
      );
      expect(result.applied).toEqual([]);
      expect(result.content).toContain("generated-by: m1");
      expect(result.content).not.toContain("kg:");
    });

    it("creates a block carrying both keys when the file has no frontmatter", () => {
      const result = applyKgFields(
        "# Title\n\nBody.\n",
        "a.md",
        { label: "X" },
        { page: { "meta-provenance": RECORD } },
      );
      const data = parse(result.content.slice(4, result.content.indexOf("\n---", 4))) as Record<string, unknown>;
      expect(data["meta-provenance"]).toEqual(RECORD);
      expect(data["kg"]).toEqual({ label: "X" });
      expect(result.content.endsWith("# Title\n\nBody.\n")).toBe(true);
    });

    it("carries CRLF through to the new top-level key", () => {
      const content = "---\r\ntitle: T\r\n---\r\n\r\n# T\r\n";
      const result = applyKgFields(
        content,
        "a.md",
        { label: "X" },
        { page: { "meta-provenance": RECORD } },
      );
      expect(result.content).toContain("\r\n");
      expect(/(?<!\r)\n/.test(result.content)).toBe(false);
    });
  });
});

describe("existingKgFields", () => {
  it("lists fields present on the kg map", () => {
    const content = `---\nkg:\n  label: X\n  concepts: [a]\n---\n`;
    expect(existingKgFields(content).sort()).toEqual(["concepts", "label"]);
  });

  it("returns [] without frontmatter or kg key", () => {
    expect(existingKgFields("# nothing\n")).toEqual([]);
    expect(existingKgFields("---\ntitle: T\n---\n")).toEqual([]);
  });
});
