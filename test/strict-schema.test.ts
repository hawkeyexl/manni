/**
 * The strict overlays: one per registered manni vocabulary, stacked beside
 * its open schema. An overlay holds only the constraints strict adds, so it
 * can narrow the open schema and never widen it. Proposal 0066 is the record.
 * Both halves are built-ins at 1.0.0: `manni:<family>:1.0.0` and
 * `manni:<family>-strict:1.0.0`.
 *
 * Every family has a fixture directory, test/fixtures/strict-schema/<family>/:
 *
 * - `ok-*.md` passes the open schema alone and the open schema plus its overlay.
 * - `bad-*.md` passes the open schema alone and fails once the overlay joins.
 *   Every finding comes from the overlay. Each of the fixture's
 *   `# expect: <pointer>` lines (`(root)` stands for the empty pointer) is
 *   reported, at that path or below it, and nothing is reported elsewhere.
 *
 * So a bad fixture proves a strict rule fires, on the field it names, and that
 * the open schema would have let the value through.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { runValidate } from "../src/meta/commands/validate.js";
import type { ValidationResult } from "../src/meta/types.js";
import { loadSchema } from "../src/meta/core/schema-registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/** Every family with an open vocabulary and a strict overlay. */
const FAMILIES = [
  "core",
  "audience",
  "lifecycle",
  "stewardship",
  "structure",
  "terminology",
  "ai-context",
  "evals",
  "artifact-evals",
  "graph",
  "citations",
];

const openRef = (family: string): string => `manni:${family}:1.0.0`;
const strictRef = (family: string): string => `manni:${family}-strict:1.0.0`;

const FIXTURES = "test/fixtures/strict-schema";

/** validate's location warnings are validate-location.test.ts's subject. */
function withoutLocation(r: ValidationResult): ValidationResult {
  return { ...r, errors: r.errors.filter((e) => e.keyword !== "location") };
}

async function check(
  file: string,
  cliSchemas: string[],
): Promise<ValidationResult> {
  const { results } = await runValidate({
    inputs: [file],
    cliSchemas,
    cwd: root,
    noConfig: true,
  });
  const r = results[0];
  if (!r) throw new Error(`no result for ${file}`);
  return withoutLocation(r);
}

/** The `# expect: <pointer>` lines of a fixture, `(root)` read as "". */
async function expected(file: string): Promise<string[]> {
  const text = await readFile(join(root, file), "utf8");
  const pointers: string[] = [];
  for (const m of text.matchAll(/^# expect: (\S+)\s*$/gm)) {
    const p = m[1];
    if (p !== undefined) pointers.push(p === "(root)" ? "" : p);
  }
  return [...new Set(pointers)].sort();
}

async function fixturesOf(family: string): Promise<string[]> {
  const names = await readdir(join(root, FIXTURES, family));
  return names.filter((n) => n.endsWith(".md")).sort();
}

/** A registered schema, by built-in id. */
function readJson(ref: string): Promise<Record<string, unknown>> {
  return loadSchema(ref);
}

/** Every key used anywhere in a JSON value, at any depth. */
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysDeep(v, into);
    }
  }
  return into;
}

function propertyNames(schema: Record<string, unknown>): string[] {
  const props = schema.properties;
  if (typeof props !== "object" || props === null) return [];
  return Object.keys(props).sort();
}

describe.each(FAMILIES)("the %s strict overlay", (family) => {
  const open = openRef(family);
  const strict = strictRef(family);

  it("is an overlay: named for its family, marking nothing, requiring nothing", async () => {
    const s = await readJson(strict);
    expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(s.$id).toBe(`manni:${family}-strict:1.0.0`);
    expect(s.title).toBe(`manni ${family} strict overlay v1.0.0`);
    expect(typeof s.description).toBe("string");
    // The open schema owns the location marks, and every reader of these
    // schemas must agree, so no mark and no format keyword.
    const keys = keysDeep(s);
    expect(keys.has("x-manni-location")).toBe(false);
    expect(keys.has("format")).toBe(false);
    // Strict constrains a value's form; it never makes a key mandatory, and
    // it leaves the root as open as the schema beneath it, and says so.
    expect(s.required).toBeUndefined();
    expect(s.additionalProperties).toBe(true);
    expect(s.unevaluatedProperties).toBeUndefined();
  });

  it("constrains only top-level keys its open schema claims", async () => {
    const o = await readJson(open);
    const s = await readJson(strict);
    const claimed = new Set(propertyNames(o));
    const constrained = propertyNames(s);
    expect(constrained.length).toBeGreaterThan(0);
    for (const k of constrained) expect(claimed).toContain(k);
  });

  it("has at least one fixture of each kind", async () => {
    const names = await fixturesOf(family);
    expect(names.some((n) => n.startsWith("ok-"))).toBe(true);
    expect(names.some((n) => n.startsWith("bad-"))).toBe(true);
    for (const n of names) expect(n).toMatch(/^(ok|bad)-[a-z0-9-]+\.md$/);
  });

  it("passes every ok- fixture, open and strict alike", async () => {
    for (const name of await fixturesOf(family)) {
      if (!name.startsWith("ok-")) continue;
      const file = `${FIXTURES}/${family}/${name}`;
      const both = await check(file, [open, strict]);
      expect({ name, errors: both.errors }).toEqual({ name, errors: [] });
    }
  });

  it("fails every bad- fixture on strict alone, at the paths it expects", async () => {
    for (const name of await fixturesOf(family)) {
      if (!name.startsWith("bad-")) continue;
      const file = `${FIXTURES}/${family}/${name}`;
      const want = await expected(file);
      expect({ name, want: want.length }).not.toEqual({ name, want: 0 });

      const openOnly = await check(file, [open]);
      expect({ name, errors: openOnly.errors }).toEqual({ name, errors: [] });

      const both = await check(file, [open, strict]);
      expect({ name, ok: both.ok }).toEqual({ name, ok: false });
      for (const e of both.errors) {
        expect({ name, strict: e.schema === strict }).toEqual(
          { name, strict: true },
        );
      }
      // An anyOf reports each branch it tried, often one level down, so a
      // finding counts when an expected pointer is its path or an ancestor.
      const got = [...new Set(both.errors.map((e) => e.instancePath))].sort();
      const under = (path: string, p: string): boolean =>
        path === p || path.startsWith(`${p}/`) || p === "";
      const stray = got.filter((g) => !want.some((p) => under(g, p)));
      const missed = want.filter((p) => !got.some((g) => under(g, p)));
      expect({ name, stray, missed }).toEqual({ name, stray: [], missed: [] });
    }
  });
});
