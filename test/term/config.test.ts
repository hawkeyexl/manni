/**
 * The `term:` section (proposal 0052). Every key has a default, so a docset
 * with no section is fully configured. The document set is `collections:`,
 * and Vale's config is the family `tools:`; neither is a `term:` key.
 */
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TermError } from "../../src/term/errors.js";
import { parseTermConfig, resolveTermRun } from "../../src/term/core/config.js";

const SOURCE = "manni.config.yaml";
const parse = (raw: unknown) => parseTermConfig(raw, SOURCE);

describe("parseTermConfig", () => {
  it("treats an empty section as no keys", () => {
    expect(parse(null)).toEqual({});
  });

  it("reads every key", () => {
    expect(
      parse({
        manifests: ["terms.yaml"],
        abstractMaxLength: 80,
        baseline: ".base.json",
        severity: { "unused-term": "off", "asymmetric-hierarchy": "error" },
        allowEmpty: true,
        respectGitignore: false,
      }),
    ).toEqual({
      manifests: ["terms.yaml"],
      abstractMaxLength: 80,
      baseline: ".base.json",
      severity: { "unused-term": "off", "asymmetric-hierarchy": "error" },
      allowEmpty: true,
      respectGitignore: false,
    });
  });

  it("refuses a section that is not a mapping", () => {
    expect(() => parse(["x"])).toThrow(TermError);
    expect(() => parse(["x"])).toThrow(`term: in ${SOURCE} must be a mapping.`);
  });

  it.each(["paths", "exclude"])("refuses %s by name, pointing at collections", (key) => {
    expect(() => parse({ [key]: ["docs"] })).toThrow(
      `${SOURCE}: term does not carry "${key}". Name a collection under collections:.`,
    );
  });

  it("refuses a Vale key, pointing at tools", () => {
    expect(() => parse({ vale: { config: ".vale.ini" } })).toThrow(
      `${SOURCE}: term does not carry "vale". Vale's settings live under tools.vale.`,
    );
  });

  it("refuses an unknown key, naming the supported ones", () => {
    expect(() => parse({ allowEmtpy: true })).toThrow(
      `Unknown key "allowEmtpy" under term: in ${SOURCE}. Supported keys: manifests, abstractMaxLength, baseline, severity, allowEmpty, respectGitignore.`,
    );
  });

  it.each([
    ["allowEmpty", "yes", "a boolean"],
    ["respectGitignore", 1, "a boolean"],
    ["baseline", 3, "a string"],
    ["manifests", "terms.yaml", "a list of non-empty strings"],
    ["manifests", [""], "a list of non-empty strings"],
    ["abstractMaxLength", -1, "a non-negative integer"],
    ["abstractMaxLength", 2.5, "a non-negative integer"],
    ["severity", "off", "a mapping"],
  ])("refuses %s given as %j", (key, value, expected) => {
    expect(() => parse({ [key]: value })).toThrow(`term.${key} in ${SOURCE} must be ${expected}.`);
  });

  it("refuses a severity for a rule that does not exist", () => {
    expect(() => parse({ severity: { "undefined-concept": "off" } })).toThrow(
      `Unknown key "undefined-concept" under term.severity: in ${SOURCE}.`,
    );
  });

  it("refuses a level that is not one, quoting a string level back", () => {
    expect(() => parse({ severity: { "undefined-term": "fatal" } })).toThrow(
      `${SOURCE}: term.severity.undefined-term "fatal" is not a level. Expected notice | warning | error | off.`,
    );
    expect(() => parse({ severity: { "undefined-term": 2 } })).toThrow(
      `${SOURCE}: term.severity.undefined-term is not a level. Expected notice | warning | error | off.`,
    );
  });
});

describe("resolveTermRun", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function tree(spec: Record<string, string>): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-term-")));
    await mkdir(join(tmp, ".git"));
    for (const [rel, content] of Object.entries(spec)) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }
    return tmp;
  }

  it("falls back to every collection's paths, resolved from the config directory", async () => {
    const root = await tree({
      "manni.config.yaml":
        "collections:\n  - name: site\n    paths: [docs]\n  - name: terms\n    paths: [glossary]\n",
    });
    const run = await resolveTermRun({ cwd: join(root), inputs: [] });
    expect(run.inputs).toEqual(["docs", "glossary"]);
    expect(run.base).toBe(root);
    expect(run.fromCollections).toBe(true);
  });

  it("keeps positional inputs cwd-relative", async () => {
    const root = await tree({ "manni.config.yaml": "term: {}\n", "sub/.keep": "" });
    const cwd = join(root, "sub");
    const run = await resolveTermRun({ cwd, inputs: ["a.md"] });
    expect(run.inputs).toEqual(["a.md"]);
    expect(run.base).toBe(cwd);
    expect(run.fromCollections).toBe(false);
  });

  it("resolves manifests against the config directory", async () => {
    const root = await tree({
      "manni.config.yaml": "term:\n  manifests: [terms/glossary.yaml]\n",
      "sub/.keep": "",
    });
    const run = await resolveTermRun({ cwd: join(root, "sub"), inputs: [] });
    expect(run.manifests).toEqual([join(root, "terms", "glossary.yaml")]);
  });

  it("carries the family tools", async () => {
    const root = await tree({
      "manni.config.yaml": "tools:\n  vale:\n    config: .vale.ini\n",
    });
    const run = await resolveTermRun({ cwd: root, inputs: [] });
    expect(run.tools).toEqual({ vale: { config: ".vale.ini" } });
    expect(run.config).toEqual({});
  });

  it("runs on defaults with no config at all", async () => {
    const root = await tree({});
    const run = await resolveTermRun({ cwd: root, inputs: ["x.md"] });
    expect(run.config).toBeNull();
    expect(run.tools).toEqual({});
    expect(run.manifests).toEqual([]);
  });

  it("refuses --collection with positional paths", async () => {
    const root = await tree({ "manni.config.yaml": "collections:\n  - name: s\n    paths: [d]\n" });
    await expect(resolveTermRun({ cwd: root, inputs: ["a.md"], collection: ["s"] })).rejects.toThrow(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  });

  it("refuses --collection with no config to select from", async () => {
    const root = await tree({});
    await expect(resolveTermRun({ cwd: root, inputs: [], collection: ["s"] })).rejects.toThrow(
      "--collection needs a config file to select from.",
    );
  });
});
