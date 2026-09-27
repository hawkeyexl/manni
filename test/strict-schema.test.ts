/**
 * The strict overlays: one per proposed vocabulary, stacked beside its open
 * draft. An overlay holds only the constraints strict adds, so it can narrow
 * the open draft and never widen it. Proposal 0066 is the record.
 *
 * Every family has a fixture directory, test/fixtures/strict-schema/<family>/:
 *
 * - `ok-*.md` passes the open draft alone and the open draft plus its overlay.
 * - `bad-*.md` passes the open draft alone and fails once the overlay joins.
 *   Every finding comes from the overlay. Each of the fixture's
 *   `# expect: <pointer>` lines (`(root)` stands for the empty pointer) is
 *   reported, at that path or below it, and nothing is reported elsewhere.
 *
 * So a bad fixture proves a strict rule fires, on the field it names, and that
 * the open draft would have let the value through.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { runValidate } from "../src/meta/commands/validate.js";
import type { ValidationResult } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const V0023 = "./docs/proposals/0023/schemas";
const V0044 = "./docs/proposals/0044/schemas";
const STRICT_V = "1.0.0-proposal.1";

/** Each family's open draft, the revision its overlay is stacked on. */
const FAMILIES: Record<string, { base: string; dir: string }> = {
  core: { base: "1.0.0-proposal.4", dir: V0023 },
  audience: { base: "1.0.0-proposal.2", dir: V0023 },
  lifecycle: { base: "1.0.0-proposal.2", dir: V0023 },
  stewardship: { base: "1.0.0-proposal.3", dir: V0023 },
  structure: { base: "1.0.0-proposal.2", dir: V0023 },
  terminology: { base: "1.0.0-proposal.1", dir: V0023 },
  "ai-context": { base: "1.0.0-proposal.3", dir: V0023 },
  evals: { base: "1.0.0-proposal.4", dir: V0023 },
  "artifact-evals": { base: "1.0.0-proposal.4", dir: V0023 },
  graph: { base: "1.0.0-proposal.1", dir: V0023 },
  citations: { base: "1.0.0-proposal.4", dir: V0044 },
};

const openRef = (family: string): string => {
  const f = FAMILIES[family];
  if (!f) throw new Error(`unknown family ${family}`);
  return `${f.dir}/${family}/${f.base}.json`;
};
const strictRef = (family: string): string => {
  const f = FAMILIES[family];
  if (!f) throw new Error(`unknown family ${family}`);
  return `${f.dir}/${family}-strict/${STRICT_V}.json`;
};

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

async function readJson(ref: string): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(join(root, ref), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${ref} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
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

describe.each(Object.keys(FAMILIES))("the %s strict overlay", (family) => {
  const open = openRef(family);
  const strict = strictRef(family);

  it("is an overlay: named for its family, marking nothing, requiring nothing", async () => {
    const s = await readJson(strict);
    expect(s.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(s.$id).toBe(`manni:${family}-strict:${STRICT_V}`);
    expect(s.title).toBe(`manni ${family} strict (${STRICT_V})`);
    expect(typeof s.description).toBe("string");
    // The open draft owns the location marks, and every reader of these
    // schemas must agree, so no mark and no format keyword.
    const keys = keysDeep(s);
    expect(keys.has("x-manni-location")).toBe(false);
    expect(keys.has("format")).toBe(false);
    // Strict constrains a value's form; it never makes a key mandatory, and
    // it leaves the root as open as the draft beneath it.
    expect(s.required).toBeUndefined();
    expect(s.additionalProperties).not.toBe(false);
    expect(s.unevaluatedProperties).toBeUndefined();
  });

  it("constrains only top-level keys its open draft claims", async () => {
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
      const strictId = `manni:${family}-strict:${STRICT_V}`;
      for (const e of both.errors) {
        expect({ name, strict: [strict, strictId].includes(e.schema) }).toEqual(
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
