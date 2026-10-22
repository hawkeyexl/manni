/**
 * `@hawkeyexl/manni/site/rehype` is built `platform: "neutral"` and runs inside
 * a docs framework's build: the built file imports nothing at all. Scans
 * dist/, so it needs `npm run build` first, as the graph runtime's test does.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const bundle = join(root, "dist", "site", "rehype.js");

describe("@hawkeyexl/manni/site/rehype bundle", () => {
  it("emits every file the ./site/rehype export names", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      exports: Record<string, Record<string, string> | string>;
    };
    const entry = pkg.exports["./site/rehype"];
    expect(typeof entry).toBe("object");
    for (const target of Object.values(entry as Record<string, string>)) {
      expect(existsSync(join(root, target)), `missing ${target}`).toBe(true);
    }
  });

  it("imports nothing, from Node or anywhere else", () => {
    const source = readFileSync(bundle, "utf8");
    expect(source).not.toMatch(/["'`]node:/);
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toMatch(/^#!/);
  });

  it("exports the plugin as its default", async () => {
    const mod = (await import(pathToFileURL(bundle).href)) as { default: unknown };
    expect(typeof mod.default).toBe("function");
  });
});
