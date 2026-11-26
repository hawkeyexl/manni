/**
 * The `vector:` section (proposal 0128): every key, a positive and a negative
 * case, and presence as a setting of its own.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadVectorConfig, parseVectorSection } from "../../src/vector/core/config.js";
import { VectorError } from "../../src/vector/types.js";

const parse = (raw: unknown) => parseVectorSection(raw, "manni.config.yaml", true);

function project(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-vector-config-"));
  writeFileSync(join(dir, "manni.config.yaml"), text, "utf8");
  return dir;
}

describe("the vector: section", () => {
  it("defaults every key", () => {
    expect(parse(null)).toEqual({
      model: "onnx-community/granite-embedding-small-english-r2-ONNX",
      dtype: "q8",
      cacheDir: ".manni/vector/cache",
      byLanguage: {},
      declared: true,
    });
  });

  it("takes any model id, a dtype, a cacheDir and per-language overrides", () => {
    expect(
      parse({ model: "some/new-model", dtype: "fp32", cacheDir: ".c", byLanguage: { de: { model: "x", dtype: "q4" } } }),
    ).toEqual({
      model: "some/new-model",
      dtype: "fp32",
      cacheDir: ".c",
      byLanguage: { de: { model: "x", dtype: "q4" } },
      declared: true,
    });
  });

  it.each([
    ["model", { model: "" }, "/vector/model"],
    ["dtype", { dtype: 8 }, "/vector/dtype"],
    ["cacheDir", { cacheDir: [] }, "/vector/cacheDir"],
    ["byLanguage tag", { byLanguage: { German: { model: "x" } } }, "/vector/byLanguage"],
    ["byLanguage entry", { byLanguage: { de: { bogus: 1 } } }, '/vector/byLanguage/de: unknown key "bogus"'],
    ["byLanguage model", { byLanguage: { de: { model: "" } } }, "/vector/byLanguage/de/model"],
    ["byLanguage dtype", { byLanguage: { de: { dtype: 1 } } }, "/vector/byLanguage/de/dtype"],
    ["unknown key", { out: "graph" }, '/vector: unknown key "out"'],
  ])("refuses a bad %s, exit 2", (_name, raw, where) => {
    const go = () => parse(raw);
    expect(go).toThrow(VectorError);
    expect(go).toThrow("Invalid config in manni.config.yaml:\n");
    expect(go).toThrow(where);
  });
});

describe("loadVectorConfig", () => {
  it.each([
    ["vector: {}", true],
    ["vector:", true],
    ["baseIri: https://example.com/id/", false],
  ])("reads %s as declared: %s", (text, declared) => {
    expect(loadVectorConfig({}, project(`${text}\n`)).declared).toBe(declared);
  });

  it("reads the section's values from the family file", () => {
    expect(loadVectorConfig({}, project("vector:\n  model: mock\n")).model).toBe("mock");
  });

  it("names the file in a schema error", () => {
    const dir = project("vector:\n  bogus: 1\n");
    expect(() => loadVectorConfig({}, dir)).toThrow(
      'Invalid config in manni.config.yaml:\n  /vector: unknown key "bogus"',
    );
  });

  it("runs on the defaults under --no-config", () => {
    const dir = project("vector:\n  model: mock\n");
    expect(loadVectorConfig({ noConfig: true }, dir)).toMatchObject({ model: expect.stringContaining("granite") as unknown, declared: false });
  });
});
