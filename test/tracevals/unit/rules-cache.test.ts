import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RulesCache, rulesCacheKey } from "../../../src/tracevals/rules/cache.js";

describe("rules cache", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "manni-tracevals-rules-cache-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const key = (over: Partial<Parameters<typeof rulesCacheKey>[0]> = {}) =>
    rulesCacheKey({ provider: "mock", model: "m", sha256: "abc", ...over });

  it("is stable for identical inputs and moves with each part", () => {
    expect(key()).toBe(key());
    expect(key({ provider: "other" })).not.toBe(key());
    expect(key({ model: "other" })).not.toBe(key());
    expect(key({ sha256: "def" })).not.toBe(key());
  });

  it("has no path in the key, so identical content shares an entry", () => {
    // The parts type has no path field; two files with one hash are one key.
    expect(Object.keys({ provider: "mock", model: "m", sha256: "abc" })).not.toContain(
      "path",
    );
    expect(key({ sha256: "abc" })).toBe(key());
  });

  it("round-trips rules and leaves no temporary file behind", async () => {
    const cache = new RulesCache(dir, true);
    const rules = [
      { id: "ci-first", text: "Run npm ci first.", when: { "tool-used": "Bash" } },
      { id: "no-red", text: "Never use red." },
    ];
    expect(cache.get("k1")).toBeUndefined();
    cache.set("k1", rules);
    expect(cache.get("k1")).toEqual(rules);
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("overwrites an entry whole", () => {
    const cache = new RulesCache(dir, true);
    cache.set("k2", [{ id: "a", text: "A." }]);
    cache.set("k2", []);
    expect(cache.get("k2")).toEqual([]);
  });

  it("ignores corrupt and wrong-shape entries", async () => {
    const cache = new RulesCache(dir, true);
    await writeFile(join(dir, "bad-json.json"), "{ not json");
    await writeFile(join(dir, "wrong-shape.json"), JSON.stringify({ rules: [] }));
    await writeFile(
      join(dir, "bad-rule.json"),
      JSON.stringify([{ id: "a", text: "A." }, { id: 7 }]),
    );
    expect(cache.get("bad-json")).toBeUndefined();
    expect(cache.get("wrong-shape")).toBeUndefined();
    expect(cache.get("bad-rule")).toBeUndefined();
  });

  it("does nothing when disabled", () => {
    const cache = new RulesCache(dir, false);
    cache.set("k3", [{ id: "a", text: "A." }]);
    expect(cache.get("k3")).toBeUndefined();
  });
});
