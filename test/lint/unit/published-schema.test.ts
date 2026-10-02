/**
 * The template schema, and the copy the docs site serves.
 *
 * A template file may carry `$schema: https://hawkeyexl.github.io/manni/schemas/
 * lint/template/2.json` so an editor can validate it while the author types.
 * That URL is served from `docs/public/`, which the docs build treats as a
 * separate checkout - it never sees the repository root. So the file is a copy,
 * and a copy drifts unless something says it must not.
 *
 * This is lint's half of the guarantee `test/builtin-schemas.test.ts` makes for
 * meta's published schemas. It runs in `npm test` rather than only in the docs
 * workflow, so a pull request that edits the schema and forgets the copy fails
 * here rather than shipping an editor a stale contract.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const source = join(root, "schemas", "lint", "template.json");
const published = join(root, "docs", "public", "schemas", "lint", "template", "2.json");

describe("the published template schema", () => {
  it("is byte-identical to schemas/lint/template.json", () => {
    expect(readFileSync(published).equals(readFileSync(source))).toBe(true);
  });

  it("is served at the URL its own $id names", () => {
    const schema = JSON.parse(readFileSync(published, "utf8")) as { $id?: string };
    // The version in the path is the version in the `$id`. A v3 would be a new
    // file beside this one rather than an edit to it, because a template file
    // in the wild goes on pointing at the URL it was written against.
    expect(schema.$id).toBe("manni-lint:template:2");
  });
});
