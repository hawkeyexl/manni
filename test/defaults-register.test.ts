/**
 * Proposal 0070: the vocabularies join the default set, `meta.schemas` adds
 * to it, `strict` stacks the strict versions, and `meta.register` names local
 * schemas by `$id`.
 *
 * The resolver is pinned directly for the precedence table; the ladder rungs
 * run through `runValidate` against `test/fixtures/defaults/` and
 * `test/fixtures/register/`; every new config message is pinned against a
 * family file written to a temp directory, so each reads with its `meta.`
 * prefix exactly as a user sees it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runValidate } from "../src/meta/commands/validate.js";
import { runDerive } from "../src/meta/commands/derive.js";
import { getSchemasInfo } from "../src/meta/commands/schemas.js";
import { loadConfig, type DocmetaConfig } from "../src/meta/core/config.js";
import {
  DEFAULT_SCHEMAS,
  isDefaultSetOnly,
  resolveSchemaSetWithSource,
} from "../src/meta/core/resolve-schema.js";
import {
  loadSchema,
  type RegisteredSchema,
} from "../src/meta/core/schema-registry.js";
import { deriveCovers, DERIVED_STALE_SCHEMA } from "../src/meta/core/derive/types.js";
import { DocmetaError, type ValidationResult } from "../src/meta/types.js";
import { resetWarnings } from "../src/shared/warn.js";
import { commit, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = resolve(here, "fixtures", "defaults");
const REGISTER = resolve(here, "fixtures", "register");
const DERIVE_SCOPE = resolve(here, "fixtures", "derive-scope");

const STRICT_DEFAULTS = [
  "google:okf:0.1",
  "passo-uno:seven-action:1.0",
  "manni:core:1.0.0",
  "manni:core-strict:1.0.0",
  "manni:audience:1.0.0",
  "manni:audience-strict:1.0.0",
  "manni:structure:1.0.0",
  "manni:structure-strict:1.0.0",
  "manni:stewardship:1.0.0",
  "manni:stewardship-strict:1.0.0",
  "manni:lifecycle:1.0.0",
  "manni:lifecycle-strict:1.0.0",
  "manni:ai-context:1.0.0",
  "manni:ai-context-strict:1.0.0",
  "manni:evals:1.0.0",
  "manni:evals-strict:1.0.0",
  "manni:graph:1.0.0",
  "manni:graph-strict:1.0.0",
  "manni:citations:1.0.0",
  "manni:citations-strict:1.0.0",
];

/** A registered-schema table, for resolver cases that need no files. */
function registry(...ids: string[]): Map<string, RegisteredSchema> {
  return new Map(
    ids.map((id) => [id, { id, file: `${id}.json`, path: `/${id}.json`, schema: { $id: id } }]),
  );
}

function resolveFor(config: DocmetaConfig, filePath = "docs/a.md") {
  return resolveSchemaSetWithSource({ filePath, config });
}

describe("the default set (0070)", () => {
  it("is OKF, Seven-Action, then the nine manni vocabularies", () => {
    expect(DEFAULT_SCHEMAS).toEqual([
      "google:okf:0.1",
      "passo-uno:seven-action:1.0",
      "manni:core:1.0.0",
      "manni:audience:1.0.0",
      "manni:structure:1.0.0",
      "manni:stewardship:1.0.0",
      "manni:lifecycle:1.0.0",
      "manni:ai-context:1.0.0",
      "manni:evals:1.0.0",
      "manni:graph:1.0.0",
      "manni:citations:1.0.0",
    ]);
  });
});

describe("precedence after 0070", () => {
  it("tier 5: no config is the default set, defaults on and strict off", () => {
    const r = resolveSchemaSetWithSource({ filePath: "a.md" });
    expect(r).toEqual({ schemas: [...DEFAULT_SCHEMAS], source: "default", defaults: true, strict: false });
  });

  it("tier 4: meta.schemas joins after the defaults, duplicates removed with the first kept", () => {
    const r = resolveFor({ schemas: ["./house.json", "manni:core:1.0.0"] });
    expect(r.schemas).toEqual([...DEFAULT_SCHEMAS, "./house.json"]);
    expect(r).toMatchObject({ source: "config", defaults: true, strict: false });
  });

  it("tier 4: defaults: false makes meta.schemas replace the defaults", () => {
    const r = resolveFor({ defaults: false, schemas: ["./house.json"] });
    expect(r).toMatchObject({ schemas: ["./house.json"], source: "config", defaults: false });
  });

  it("tier 3: an override replaces the set, and never inherits meta.schemas or meta.strict", () => {
    const r = resolveFor({
      schemas: ["./top.json"],
      strict: true,
      overrides: [{ files: "docs/**", schemas: ["./house.json"] }],
    });
    expect(r).toMatchObject({ schemas: ["./house.json"], source: "override", defaults: false, strict: false });
  });

  it("tier 3: an override with defaults: true puts the defaults first", () => {
    const r = resolveFor({
      overrides: [{ files: "docs/**", defaults: true, schemas: ["./house.json"] }],
    });
    expect(r.schemas).toEqual([...DEFAULT_SCHEMAS, "./house.json"]);
    expect(r).toMatchObject({ source: "override", overrideIndex: 0, defaults: true });
  });

  it("tier 3: an override's strict applies to its own set", () => {
    const r = resolveFor({
      overrides: [{ files: "docs/**", defaults: true, strict: true, schemas: ["./house.json"] }],
    });
    expect(r.schemas).toEqual([...STRICT_DEFAULTS, "./house.json"]);
    expect(r.strict).toBe(true);
  });

  it("tiers 1 and 2 replace, unchanged: strict and defaults never reach them", () => {
    const config: DocmetaConfig = { strict: true, schemas: ["./house.json"] };
    const cli = resolveSchemaSetWithSource({ filePath: "a.md", cliSchemas: ["google:okf:0.1"], config });
    expect(cli).toEqual({ schemas: ["google:okf:0.1"], source: "cli", defaults: false, strict: false });
    const doc = resolveSchemaSetWithSource({ filePath: "a.md", fileSchema: "manni:core:1.0.0", config });
    expect(doc).toEqual({ schemas: ["manni:core:1.0.0"], source: "document", defaults: false, strict: false });
  });

  it("strict stacks each default's strict version right after its base", () => {
    expect(resolveFor({ strict: true }).schemas).toEqual(STRICT_DEFAULTS);
  });

  it("strict never touches a listed built-in outside the default set", () => {
    const r = resolveFor({ strict: true, schemas: ["tgdp:templates:1.1"] });
    expect(r.schemas).toEqual([...STRICT_DEFAULTS, "tgdp:templates:1.1"]);
    expect(r.schemas).not.toContain("tgdp:templates-strict:1.1");
  });

  it("strict keeps one copy of an overlay also listed by hand, after its base", () => {
    const r = resolveFor({ strict: true, schemas: ["manni:core-strict:1.0.0"] });
    expect(r.schemas).toEqual(STRICT_DEFAULTS);
  });

  it("strict stacks a registered schema's registered strict version", () => {
    const registered = registry("house:page:1.0.0", "house:page-strict:1.0.0", "house:other:1.0.0");
    const r = resolveFor({
      defaults: false,
      strict: true,
      schemas: ["house:page:1.0.0", "house:other:1.0.0"],
      registered,
    });
    expect(r.schemas).toEqual(["house:page:1.0.0", "house:page-strict:1.0.0", "house:other:1.0.0"]);
  });

  it("isDefaultSetOnly reads the default set, strict or not, and nothing more", () => {
    expect(isDefaultSetOnly(resolveFor({}))).toBe(true);
    expect(isDefaultSetOnly(resolveFor({ strict: true }))).toBe(true);
    expect(isDefaultSetOnly(resolveFor({ schemas: ["./house.json"] }))).toBe(false);
    expect(isDefaultSetOnly(resolveFor({ defaults: false, schemas: ["manni:core:1.0.0"] }))).toBe(false);
  });
});

/** Validate fixtures in `test/fixtures/defaults/` under one of its configs. */
async function inDefaults(files: string[], config?: string): Promise<ValidationResult[]> {
  const { results } = await runValidate({
    inputs: files,
    cwd: DEFAULTS,
    ...(config === undefined ? { noConfig: true } : { configPath: config }),
  });
  return results;
}

const failing = (r: ValidationResult | undefined): string[] =>
  (r?.errors ?? [])
    .filter((e) => e.severity === undefined || e.severity === "error")
    .map((e) => `${e.schema} ${e.keyword} ${e.subject ?? ""}`.trim());

describe("the ladder (0070)", () => {
  beforeEach(() => {
    resetWarnings();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. with no config, a page with a title and a description passes", async () => {
    const [r] = await inDefaults(["page.md"]);
    expect(r?.ok).toBe(true);
    expect(r?.schemas).toEqual([...DEFAULT_SCHEMAS]);
  });

  it("2. with no description, core requires it", async () => {
    const [r] = await inDefaults(["no-description.md"]);
    expect(r?.ok).toBe(false);
    expect(failing(r)).toEqual(["manni:core:1.0.0 required description"]);
  });

  it("3. owner: passes, with a location:external warning", async () => {
    const [r] = await inDefaults(["owner.md"]);
    expect(r?.ok).toBe(true);
    const location = r?.errors.filter((e) => e.keyword === "location") ?? [];
    expect(location.length).toBeGreaterThan(0);
    expect(location.every((e) => e.severity === "warning")).toBe(true);
  });

  it("5. meta.schemas judges by the defaults plus the house schema", async () => {
    const [r] = await inDefaults(["no-description.md"], "joined.yaml");
    expect(failing(r)).toEqual([
      "manni:core:1.0.0 required description",
      "./house.json required team",
    ]);
  });

  it("5. with defaults: false, the house schema alone", async () => {
    const [r] = await inDefaults(["no-description.md"], "replaced.yaml");
    expect(r?.schemas).toEqual(["./house.json"]);
    expect(failing(r)).toEqual(["./house.json required team"]);
  });

  it("6. an override replaces the set, unchanged", async () => {
    const [r] = await inDefaults(["no-description.md"], "override.yaml");
    expect(r?.schemas).toEqual(["./house.json"]);
    expect(failing(r)).toEqual(["./house.json required team"]);
  });

  it("6. an override with defaults: true is the defaults plus its schemas", async () => {
    const [r] = await inDefaults(["no-description.md"], "override-defaults.yaml");
    expect(r?.schemas).toEqual([...DEFAULT_SCHEMAS, "./house.json"]);
    expect(failing(r)).toEqual([
      "manni:core:1.0.0 required description",
      "./house.json required team",
    ]);
  });

  it("7. strict: true fails language: en_US on manni:core-strict:1.0.0", async () => {
    const [plain] = await inDefaults(["en-us.md"]);
    expect(plain?.ok).toBe(true);
    const [strict] = await inDefaults(["en-us.md"], "strict.yaml");
    expect(strict?.ok).toBe(false);
    expect(new Set(failing(strict).map((f) => f.split(" ")[0]))).toEqual(
      new Set(["manni:core-strict:1.0.0"]),
    );
  });

  it("8. a registered schema and its strict version both judge, through the config", async () => {
    const { results } = await runValidate({
      inputs: ["good.md", "loose-team.md", "bad-language.md", "no-team.md"],
      cwd: REGISTER,
    });
    const by = new Map(results.map((r) => [r.file, r]));
    expect(by.get("good.md")?.schemas).toEqual([
      ...STRICT_DEFAULTS,
      "house:page:1.0.0",
      "house:page-strict:1.0.0",
    ]);
    expect(by.get("good.md")?.ok).toBe(true);
    expect(failing(by.get("loose-team.md")).map((f) => f.split(" ")[0])).toEqual([
      "house:page-strict:1.0.0",
    ]);
    expect(failing(by.get("bad-language.md")).every((f) => f.startsWith("manni:core-strict:1.0.0"))).toBe(true);
    expect(failing(by.get("no-team.md"))).toEqual(["house:page:1.0.0 required team"]);
  });

  it("8. -s house:page:1.0.0 resolves through the config", async () => {
    const { results } = await runValidate({
      inputs: ["no-team.md"],
      cliSchemas: ["house:page:1.0.0"],
      cwd: REGISTER,
    });
    expect(results[0]?.schemas).toEqual(["house:page:1.0.0"]);
    expect(failing(results[0])).toEqual(["house:page:1.0.0 required team"]);
  });

  it("8. a page whose $schema is a registered id resolves", async () => {
    const { results } = await runValidate({ inputs: ["self-described.md"], cwd: REGISTER });
    expect(results[0]?.schemas).toEqual(["house:page:1.0.0"]);
    expect(results[0]?.ok).toBe(true);
  });

  it("8. a registered id resolves under documentRefs: local, as a built-in does", async () => {
    const loaded = await loadConfig(undefined, REGISTER);
    const config = loaded?.config;
    expect(config?.registered?.has("house:page:1.0.0")).toBe(true);
    const url = "https://schemas.example.test/house.json";
    const withUrl: DocmetaConfig = {
      ...config,
      schemaTrust: { documentRefs: "local" },
      registered: registry(url),
    };
    const r = resolveSchemaSetWithSource({ filePath: "a.md", fileSchema: url, config: withUrl });
    expect(r.schemas).toEqual([url]);
  });

  it("8. a local schema can $ref a registered one by id", async () => {
    const { results } = await runValidate({
      inputs: ["good.md", "no-team.md"],
      cliSchemas: ["./ref-house.schema.json"],
      cwd: REGISTER,
    });
    const by = new Map(results.map((r) => [r.file, r]));
    expect(by.get("good.md")?.ok).toBe(true);
    expect(failing(by.get("no-team.md"))).toEqual(["./ref-house.schema.json required team"]);
  });

  it("9. -s house:page:1.0.0 --no-config is an unknown schema, naming both lists", async () => {
    const run = runValidate({
      inputs: ["good.md"],
      cliSchemas: ["house:page:1.0.0"],
      cwd: REGISTER,
      noConfig: true,
    });
    await expect(run).rejects.toBeInstanceOf(DocmetaError);
    await expect(run).rejects.toThrow(
      /^Unknown schema "house:page:1\.0\.0"\. manni meta schemas lists the built-in ids\. Registered by meta\.register: none\.$/,
    );
  });
});

describe("registered schemas in loading (0070)", () => {
  it("answers a registered https id from its file, with no fetch", async () => {
    const url = "https://schemas.example.test/house.json";
    const schema = { $id: url, type: "object" };
    const registered = new Map([[url, { id: url, file: "house.json", path: "/house.json", schema }]]);
    // offline: a fetch would fail loudly, so a pass proves none was made.
    await expect(loadSchema(url, { registered, offline: true })).resolves.toBe(schema);
  });

  it("names the registered ids when an id is unknown", async () => {
    await expect(loadSchema("house:nope:1.0.0", { registered: registry("house:page:1.0.0") })).rejects.toThrow(
      /Registered by meta\.register: house:page:1\.0\.0\.$/,
    );
  });

  it("registers a symlinked schema inside a registered directory", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "manni-register-link-"));
    try {
      mkdirSync(join(dir, "real"));
      mkdirSync(join(dir, "schemas"));
      cpSync(join(REGISTER, "schemas", "house-page.json"), join(dir, "real", "house-page.json"));
      try {
        symlinkSync(join(dir, "real", "house-page.json"), join(dir, "schemas", "house-page.json"), "file");
      } catch {
        // Windows without Developer Mode refuses symlinks to unprivileged users.
        ctx.skip();
      }
      writeFileSync(join(dir, "manni.config.yaml"), "meta:\n  register: [./schemas/]\n");
      const loaded = await loadConfig(undefined, dir);
      expect([...(loaded?.config.registered?.keys() ?? [])]).toEqual(["house:page:1.0.0"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns that a directory symlink inside a registered directory is not followed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-register-dirlink-"));
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      resetWarnings();
      mkdirSync(join(dir, "real"));
      mkdirSync(join(dir, "schemas"));
      cpSync(join(REGISTER, "schemas", "house-page.json"), join(dir, "schemas", "house-page.json"));
      // A junction on Windows needs no privilege, and Node reads it as a symlink.
      symlinkSync(join(dir, "real"), join(dir, "schemas", "linked"), "junction");
      writeFileSync(join(dir, "manni.config.yaml"), "meta:\n  register: [./schemas/]\n");
      const loaded = await loadConfig(undefined, dir);
      expect([...(loaded?.config.registered?.keys() ?? [])]).toEqual(["house:page:1.0.0"]);
      expect(written.join("")).toContain(
        "meta.register: schemas/linked is a symlink to a directory, which is not followed.",
      );
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses a register path that is neither a file nor a directory",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "manni-register-fifo-"));
      try {
        // A FIFO: reading it would block until a writer opens it.
        execFileSync("mkfifo", [join(dir, "pipe.json")]);
        writeFileSync(join(dir, "manni.config.yaml"), "meta:\n  register: [./pipe.json]\n");
        await expect(loadConfig(undefined, dir)).rejects.toThrow(
          "manni.config.yaml: meta.register[0] names ./pipe.json, which is not a file or a directory.",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("lists registered schemas with their files for manni meta schemas", async () => {
    const loaded = await loadConfig(undefined, REGISTER);
    const info = getSchemasInfo(loaded?.config.registered);
    expect(info.registered).toEqual([
      { id: "house:page-strict:1.0.0", file: "schemas/house-page-strict.json" },
      { id: "house:page:1.0.0", file: "schemas/house-page.json" },
    ]);
    expect(getSchemasInfo().registered).toEqual([]);
  });
});

describe("config messages (0070)", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-0070-")));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(rel: string, text: string): void {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }

  /** The config error loading `manni.config.yaml` with this text raises. */
  async function refusal(yaml: string): Promise<string> {
    write("manni.config.yaml", yaml);
    try {
      await loadConfig(undefined, dir);
    } catch (err) {
      expect(err).toBeInstanceOf(DocmetaError);
      return (err as Error).message;
    }
    throw new Error("the config loaded");
  }

  const house = (id: string): string => JSON.stringify({ $id: id, type: "object" });

  it.each([
    ["meta:\n  defaults: maybe\n", "manni.config.yaml: meta.defaults must be true or false."],
    ["meta:\n  strict: 1\n", "manni.config.yaml: meta.strict must be true or false."],
    [
      "meta:\n  overrides:\n    - files: '*.md'\n      schemas: [google:okf:0.1]\n      defaults: yes please\n",
      "manni.config.yaml: meta.overrides[0].defaults must be true or false.",
    ],
    [
      "meta:\n  overrides:\n    - files: '*.md'\n      schemas: [google:okf:0.1]\n      strict: on-please\n",
      "manni.config.yaml: meta.overrides[0].strict must be true or false.",
    ],
    [
      "meta:\n  defaults: false\n",
      "manni.config.yaml: meta.defaults: false with no meta.schemas leaves files with no schema. List schemas, or remove defaults.",
    ],
    [
      "meta:\n  overrides:\n    - files: '*.md'\n      elements: [article/title]\n      strict: true\n",
      "manni.config.yaml: meta.overrides[0] sets strict, which applies to the entry's schemas. Add schemas, or remove strict.",
    ],
    [
      "meta:\n  overrides:\n    - files: '*.md'\n      elements: [article/title]\n      defaults: true\n      strict: false\n",
      "manni.config.yaml: meta.overrides[0] sets defaults and strict, which apply to the entry's schemas. Add schemas, or remove them.",
    ],
    [
      "collections:\n  - name: site\n    paths: ['docs/**']\nmeta:\n  derive:\n    collections: [elsewhere]\n",
      'manni.config.yaml: meta.derive.collections names "elsewhere", which no collection declares.',
    ],
    [
      "meta:\n  register: [./missing/]\n",
      "manni.config.yaml: meta.register[0] names ./missing/, which does not exist.",
    ],
  ])("%j", async (yaml, message) => {
    expect(await refusal(yaml)).toBe(message);
  });

  it("refuses a directory with no .json files", async () => {
    write("schemas/readme.txt", "no schemas here");
    expect(await refusal("meta:\n  register: [./schemas]\n")).toBe(
      "manni.config.yaml: meta.register[0] names a directory with no .json files.",
    );
  });

  it("refuses a file that is not JSON", async () => {
    write("schemas/broken.json", "{ nope");
    expect(await refusal("meta:\n  register: [./schemas]\n")).toBe(
      "manni.config.yaml: meta.register: schemas/broken.json is not valid JSON.",
    );
  });

  it("refuses a schema with no $id", async () => {
    write("house.json", JSON.stringify({ type: "object" }));
    expect(await refusal("meta:\n  register: [./house.json]\n")).toBe(
      "manni.config.yaml: meta.register: house.json has no $id. A registered schema is named by its $id.",
    );
  });

  it("refuses an $id of neither shape", async () => {
    write("house.json", house("house-page"));
    expect(await refusal("meta:\n  register: [./house.json]\n")).toBe(
      'manni.config.yaml: meta.register: house.json\'s $id "house-page" is neither vendor:name:version nor an https URL.',
    );
  });

  it("refuses two files registering one $id", async () => {
    write("schemas/a.json", house("house:page:1.0.0"));
    write("schemas/b.json", house("house:page:1.0.0"));
    expect(await refusal("meta:\n  register: [./schemas]\n")).toBe(
      'manni.config.yaml: meta.register: schemas/a.json and schemas/b.json both register "house:page:1.0.0".',
    );
  });

  it("refuses a built-in id", async () => {
    write("okf.json", house("google:okf:0.1"));
    expect(await refusal("meta:\n  register: [./okf.json]\n")).toBe(
      'manni.config.yaml: meta.register: okf.json registers "google:okf:0.1", which is a built-in id.',
    );
  });

  it.each(["manni", "check", "external", "encrypted", "derived"])(
    "refuses the reserved %s vendor",
    async (vendor) => {
      write("house.json", house(`${vendor}:house:1.0.0`));
      expect(await refusal("meta:\n  register: [./house.json]\n")).toBe(
        `manni.config.yaml: meta.register: house.json registers "${vendor}:house:1.0.0" under the reserved "${vendor}" vendor.`,
      );
    },
  );

  it("registers a file named twice once, and an https id", async () => {
    write("schemas/page.json", house("https://schemas.example.test/page.json"));
    write("manni.config.yaml", "meta:\n  register: [./schemas, ./schemas/page.json]\n");
    const loaded = await loadConfig(undefined, dir);
    expect([...(loaded?.config.registered?.keys() ?? [])]).toEqual([
      "https://schemas.example.test/page.json",
    ]);
  });
});

describe("derive.collections (0070)", () => {
  const dirs: string[] = [];
  beforeEach(() => {
    resetWarnings();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const d of dirs.splice(0)) removeTempRepo(d);
  });

  it("covers a file in one of the collections, and every file when absent", () => {
    expect(deriveCovers(undefined, [])).toBe(true);
    expect(deriveCovers({}, [])).toBe(true);
    expect(deriveCovers({ collections: ["site"] }, ["site", "other"])).toBe(true);
    expect(deriveCovers({ collections: ["site"] }, ["other"])).toBe(false);
    expect(deriveCovers({ collections: ["site"] }, [])).toBe(false);
  });

  it("stamps and compares members of the named collections only", async () => {
    const dir = makeTempRepo({ files: {} });
    dirs.push(dir);
    cpSync(DERIVE_SCOPE, dir, { recursive: true });
    commit(dir, "add docs");

    const { results } = await runValidate({ inputs: [], cwd: dir });
    const stale = results.flatMap((r) =>
      r.errors.filter((e) => e.schema === DERIVED_STALE_SCHEMA).map((e) => `${r.file}: ${e.subject ?? ""}`),
    );
    expect(stale).toEqual(["docs/site/guide.md: owner"]);

    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });
    const fieldsOf = (file: string): string[] =>
      run.results.find((r) => r.file === file)?.fields.map((f) => f.field) ?? ["(no result)"];
    expect(fieldsOf("docs/site/guide.md")).toEqual(["owner"]);
    expect(fieldsOf("docs/other/note.md")).toEqual([]);
  });
});
