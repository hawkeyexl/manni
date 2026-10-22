/**
 * Verification metadata (proposal 0098): `verified-by` and `last-verified`,
 * on a page in manni:stewardship:1.2.0 and on a citation entry in
 * manni:citations:1.1.0, each with a strict overlay.
 *
 * Every fixture under test/fixtures/verification/ goes through the real
 * validate path, under the default set and with the strict overlays stacked.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runValidate } from "../src/meta/commands/validate.js";
import { DEFAULT_SCHEMAS } from "../src/meta/core/resolve-schema.js";
import { isBuiltinId, loadSchema, strictIdOf } from "../src/meta/core/schema-registry.js";
import type { FieldError, ValidationResult } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const FIXTURES = "test/fixtures/verification";
const CITATIONS = resolve(root, FIXTURES, "citations");

const STEWARDSHIP = "manni:stewardship:1.2.0";
const STEWARDSHIP_STRICT = "manni:stewardship-strict:1.2.0";
const CITATIONS_ID = "manni:citations:1.1.0";
const CITATIONS_STRICT = "manni:citations-strict:1.1.0";

const DATE_GUIDANCE =
  "A day such as 2026-10-21, or a timestamp with a timezone such as 2026-10-21T14:02:11Z.";
const TOOL_GUIDANCE = "Each entry names the verifier in tool.";

/** Findings other than location preferences, which have their own tests. */
function findings(r: ValidationResult): FieldError[] {
  return r.errors.filter((e) => e.keyword !== "location");
}

async function page(fixture: string, cliSchemas?: string[]): Promise<ValidationResult> {
  const { results } = await runValidate({
    inputs: [`${FIXTURES}/${fixture}`],
    cwd: root,
    noConfig: true,
    ...(cliSchemas ? { cliSchemas } : {}),
  });
  const r = results[0];
  if (!r) throw new Error(`no result for ${fixture}`);
  return r;
}

async function pin(fixture: string, cliSchemas?: string[]): Promise<ValidationResult> {
  const { results } = await runValidate({
    inputs: [fixture],
    cwd: CITATIONS,
    ...(cliSchemas ? { cliSchemas } : {}),
  });
  const r = results[0];
  if (!r) throw new Error(`no result for ${fixture}`);
  return r;
}

describe("the defaults move", () => {
  it("carries stewardship 1.2.0 and citations 1.1.0", () => {
    expect(DEFAULT_SCHEMAS).toContain(STEWARDSHIP);
    expect(DEFAULT_SCHEMAS).toContain(CITATIONS_ID);
    expect(DEFAULT_SCHEMAS).not.toContain("manni:stewardship:1.1.0");
    expect(DEFAULT_SCHEMAS).not.toContain("manni:citations:1.0.0");
  });

  it("pairs each new version with its strict overlay", () => {
    expect(strictIdOf(STEWARDSHIP)).toBe(STEWARDSHIP_STRICT);
    expect(strictIdOf(CITATIONS_ID)).toBe(CITATIONS_STRICT);
  });

  it.each([
    "manni:stewardship:1.0.0",
    "manni:stewardship:1.1.0",
    "manni:stewardship-strict:1.1.0",
    "manni:citations:1.0.0",
    "manni:citations-strict:1.0.0",
    STEWARDSHIP,
    STEWARDSHIP_STRICT,
    CITATIONS_ID,
    CITATIONS_STRICT,
  ])("still resolves %s", async (id) => {
    expect(isBuiltinId(id)).toBe(true);
    const schema = await loadSchema(id);
    expect(schema.$id).toBe(id);
  });
});

describe("the page fields", () => {
  it.each([
    "one-entry.md",
    "two-entries.md",
    "no-check.md",
    "last-verified-no-entries.md",
    "same-tool-two-checks.md",
    "duplicate-tool.md",
  ])("%s passes the default set", async (fixture) => {
    const r = await page(fixture);
    expect(r.schemas).toContain(STEWARDSHIP);
    expect(findings(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it.each(["one-entry.md", "two-entries.md", "no-check.md", "last-verified-no-entries.md", "same-tool-two-checks.md"])(
    "%s passes the strict overlay too",
    async (fixture) => {
      const r = await page(fixture, [STEWARDSHIP, STEWARDSHIP_STRICT]);
      expect(findings(r)).toEqual([]);
    },
  );

  it("refuses reduced precision on both fields, with the date guidance", async () => {
    const r = await page("bad-reduced-precision.md");
    expect(r.ok).toBe(false);
    const errs = findings(r);
    expect(errs.map((e) => e.instancePath).sort()).toEqual(["/last-verified", "/verified-by/0/passed"]);
    for (const e of errs) {
      expect(e.schema).toBe(STEWARDSHIP);
      expect(e.keyword).toBe("pattern");
      expect(e.guidance?.description).toBe(DATE_GUIDANCE);
    }
  });

  it("refuses a time with no timezone", async () => {
    const r = await page("bad-no-timezone.md");
    const errs = findings(r);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.instancePath).toBe("/verified-by/0/passed");
    expect(errs[0]?.guidance?.rule).toBe("verified-by/passed");
    expect(errs[0]?.guidance?.description).toBe(DATE_GUIDANCE);
    expect(errs[0]?.line).toBe(8);
  });

  it("refuses an entry with no tool, with the tool guidance", async () => {
    const r = await page("bad-missing-tool.md");
    const errs = findings(r);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.keyword).toBe("required");
    expect(errs[0]?.guidance?.rule).toBe("verified-by/tool");
    expect(errs[0]?.guidance?.description).toBe(TOOL_GUIDANCE);
  });

  it("refuses a duplicate entry under the strict overlay only", async () => {
    const r = await page("duplicate-tool.md", [STEWARDSHIP, STEWARDSHIP_STRICT]);
    const errs = findings(r);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.schema).toBe(STEWARDSHIP_STRICT);
    expect(errs[0]?.instancePath).toBe("/verified-by");
    expect(errs[0]?.keyword).toBe("uniqueItems");
  });

  it("is refused by a pinned 1.1.0 only where 1.1.0 constrains the key", async () => {
    // 1.1.0 does not claim the new keys, so a page pinned to it passes them through.
    const r = await page("bad-missing-tool.md", ["manni:stewardship:1.1.0"]);
    expect(findings(r)).toEqual([]);
  });

  it("marks both fields page-located, with neither left out of graph output", async () => {
    const schema = await loadSchema(STEWARDSHIP);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    for (const key of ["last-verified", "verified-by"]) {
      expect(props[key]?.["x-manni-location"]).toBe("page");
      expect(props[key]?.["x-manni-graph-output"]).toBeUndefined();
    }
  });
});

describe("the citation-entry fields", () => {
  it("passes a verified pin under the default set and the strict overlay", async () => {
    const r = await pin("good.md");
    expect(r.schemas).toContain(CITATIONS_ID);
    expect(findings(r)).toEqual([]);
    const strict = await pin("good.md", [CITATIONS_ID, CITATIONS_STRICT]);
    expect(findings(strict)).toEqual([]);
  });

  it("refuses a missing tool and an offset-less time, on the manifest's lines", async () => {
    const r = await pin("bad.md");
    expect(r.ok).toBe(false);
    const errs = findings(r).filter((e) => e.schema === CITATIONS_ID);
    const byPath = new Map(errs.map((e) => [e.instancePath, e]));
    expect([...byPath.keys()].sort()).toEqual([
      "/citations/0/verified-by/0",
      "/citations/1/last-verified",
      "/citations/1/verified-by/0/passed",
    ]);
    expect(byPath.get("/citations/0/verified-by/0")?.guidance?.description).toBe(TOOL_GUIDANCE);
    expect(byPath.get("/citations/1/last-verified")?.guidance?.description).toBe(DATE_GUIDANCE);
    expect(byPath.get("/citations/1/verified-by/0/passed")?.guidance?.description).toBe(DATE_GUIDANCE);
    for (const e of errs) expect(e.file).toBe("bad.citations.yaml");
    expect(byPath.get("/citations/1/verified-by/0/passed")?.line).toBe(16);
  });

  it("refuses a duplicate entry under the strict overlay only", async () => {
    expect(findings(await pin("duplicate.md"))).toEqual([]);
    const errs = findings(await pin("duplicate.md", [CITATIONS_ID, CITATIONS_STRICT]));
    expect(errs).toHaveLength(1);
    expect(errs[0]?.schema).toBe(CITATIONS_STRICT);
    expect(errs[0]?.instancePath).toBe("/citations/0/verified-by");
  });
});
