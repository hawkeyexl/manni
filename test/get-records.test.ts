/**
 * `meta get` names the strategy records a page's `audiences`, `personas`,
 * `journeys` or `audience` values name, as `records: [{ type, id, file }]`.
 * Nothing is named, no key: the entry is today's.
 */
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGet, type GetOptions } from "../src/meta/commands/get.js";
import { RECORD_FIELDS } from "../src/shared/reference-fields.js";
import { PAGE_FIELDS, PARENTS, RECORD_TYPES } from "../src/strategy/types.js";

const FIXTURE = resolve(import.meta.dirname, "fixtures/get-records");

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** A copy of the fixture, for a case that edits it. */
function copy(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "manni-get-records-")));
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const get = (opts: Partial<GetOptions>, cwd = FIXTURE) =>
  runGet({ fields: [], inputs: [], derived: false, cwd, ...opts });

const MAYA = { type: "persona", id: "maya", file: "strategy/personas/maya.md" };
const M1 = { type: "journey", id: "m1", file: "strategy/journeys/m1.md" };
const DOCS_ENGINEERS = { type: "audience", id: "docs-engineers", file: "strategy/audiences/docs-engineers.md" };

describe("meta get: records", () => {
  it("resolves named fields ignoring case, by file stem when no id, and leaves an unknown id out", async () => {
    const [entry] = await get({ fields: ["personas", "journeys"], inputs: ["docs/page.md"] });
    expect(entry?.values).toEqual({ personas: ["Maya"], journeys: ["m1", "m9"] });
    expect(entry?.records).toEqual([MAYA, M1]);
  });

  it("lists --all-fields records in the page's field order, each once", async () => {
    const [entry] = await get({ allFields: true, inputs: ["docs/page.md"] });
    expect(entry?.records).toEqual([DOCS_ENGINEERS, MAYA, M1]);
  });

  it("gives each reference exactly type, id and file, and no record content", async () => {
    const [entry] = await get({ allFields: true, inputs: ["docs/page.md"] });
    for (const record of entry?.records ?? []) expect(Object.keys(record).sort()).toEqual(["file", "id", "type"]);
    expect(JSON.stringify(entry?.records)).not.toMatch(/Maya, docs engineer|trigger|Set up the docs/);
  });

  it("has no records key when no reference field is requested", async () => {
    const [entry] = await get({ fields: ["title"], inputs: ["docs/page.md"] });
    expect(entry).toEqual({ file: "docs/page.md", present: true, collections: ["pages"], values: { title: "A page" } });
  });

  it("has no records key where nothing is named, and the entry is today's", async () => {
    const [plain] = await get({ allFields: true, inputs: ["docs/plain.md"] });
    expect(plain).toEqual({ file: "docs/plain.md", present: true, collections: ["pages"], values: { title: "A plain page" } });

    const [bare] = await get({ fields: ["personas"], inputs: ["docs/page.md"], noConfig: true });
    expect(bare).toEqual({ file: "docs/page.md", present: true, collections: [], values: { personas: undefined } });
    const [outside] = await get({ fields: ["personas"], inputs: ["notes/outside.md"], noConfig: true });
    expect(outside).toEqual({ file: "notes/outside.md", present: true, collections: [], values: { personas: ["maya"] } });

    const dir = copy();
    writeFileSync(join(dir, "docs/page.meta.yaml"), "docs/page.md:\n  journeys: [m9]\n");
    writeFileSync(join(dir, "docs/page.md"), "---\ntitle: A page\n---\n");
    const [unknown] = await get({ allFields: true, inputs: ["docs/page.md"] }, dir);
    expect(unknown).toEqual({ file: "docs/page.md", present: true, collections: ["pages"], values: { title: "A page", journeys: ["m9"] } });

    writeFileSync(join(dir, "docs/broken.md"), "---\npersonas: [unclosed\n---\n");
    const [broken] = await get({ fields: ["personas"], inputs: ["docs/broken.md"] }, dir);
    expect(broken).not.toHaveProperty("records");
    expect(broken?.error).toBeTypeOf("string");
  });

  it("lists both records that share an id, in walk order", async () => {
    const dir = copy();
    writeFileSync(join(dir, "strategy/personas/maya-two.md"), "---\ntype: persona\nid: MAYA\naudience: docs-engineers\n---\n");
    const [entry] = await get({ fields: ["personas"], inputs: ["docs/page.md"] }, dir);
    expect(entry?.records).toEqual([
      { type: "persona", id: "MAYA", file: "strategy/personas/maya-two.md" },
      MAYA,
    ]);
  });

  it("resolves a persona record's own audience", async () => {
    const [entry] = await get({ fields: ["audience"], inputs: ["strategy/personas/maya.md"] });
    expect(entry?.records).toEqual([DOCS_ENGINEERS]);
  });

  it("resolves stdin, with record files relative to the run's directory", async () => {
    const [entry] = await get({
      fields: ["personas"],
      inputs: ["-"],
      as: "markdown",
      stdinContent: "---\npersonas: [maya, mya]\n---\n",
    });
    expect(entry?.records).toEqual([MAYA]);
  });

  it("agrees with strategy's fields", () => {
    for (const type of RECORD_TYPES) expect(RECORD_FIELDS[PAGE_FIELDS[type]]).toBe(type);
    expect(RECORD_FIELDS[PARENTS.persona]).toBe("audience");
    expect(RECORD_FIELDS[PARENTS.journey]).toBe("persona");
    const named = new Set([...Object.values(PAGE_FIELDS), ...Object.values(PARENTS)]);
    expect(new Set(Object.keys(RECORD_FIELDS))).toEqual(named);
  });
});
