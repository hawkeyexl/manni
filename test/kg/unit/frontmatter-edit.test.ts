import { describe, expect, it } from "vitest";
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
