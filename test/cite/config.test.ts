import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  loadCiteConfig,
  parseCiteConfig,
  resolveCiteRun,
} from "../../src/cite/core/config.js";
import { CiteError } from "../../src/cite/errors.js";
import { CITE_RULES } from "../../src/cite/types.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "..", "fixtures", "cite", "config");
const FIXTURE = join(fixtures, "manni.config.yaml");

/** Fixed test keys; never the developer's environment. */
const CONFIG_KEY = "config-key-0123456789abcdef0123456789";
const ENV_KEY = "env-key-0123456789abcdef0123456789ab";

/** Parse a YAML snippet as the `cite:` slice, the way the loader hands it over. */
function parse(yaml: string): ReturnType<typeof parseCiteConfig> {
  return parseCiteConfig(parseYaml(yaml), "c.yaml");
}

/** Every directory at or above `from` holding a `.git` entry. */
function gitAncestors(from: string): string[] {
  const found: string[] = [];
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".git"))) found.push(dir);
    const parent = dirname(dir);
    if (parent === dir) return found;
    dir = parent;
  }
}

describe("parseCiteConfig", () => {
  it("treats an empty section as all-undefined", () => {
    expect(parseCiteConfig(null, "c.yaml")).toEqual({});
    expect(parseCiteConfig(undefined, "c.yaml")).toEqual({});
  });

  it("round-trips every key", () => {
    const cfg = parse(
      [
        "allowEmpty: true",
        "respectGitignore: false",
        "root: ../src",
        "baseline: .cite-baseline.json",
        "git: false",
        "sources: false",
        "severity:",
        "  moved: error",
        "  changed: warning",
        "  current: off",
      ].join("\n"),
    );
    expect(cfg).toEqual({
      allowEmpty: true,
      respectGitignore: false,
      root: "../src",
      baseline: ".cite-baseline.json",
      git: false,
      sources: false,
      severity: { moved: "error", changed: "warning", current: "off" },
    });
  });

  it("accepts every rule under severity", () => {
    const yaml = ["severity:", ...CITE_RULES.map((r) => `  ${r}: off`)].join("\n");
    const cfg = parse(yaml);
    for (const rule of CITE_RULES) expect(cfg.severity?.[rule]).toBe("off");
  });

  it("rejects a section that is not a mapping", () => {
    expect(() => parseCiteConfig(["a"], "c.yaml")).toThrow(CiteError);
    expect(() => parseCiteConfig("paths", "c.yaml")).toThrow(/cite:.*must be a mapping/);
  });

  it("rejects an unknown key, naming it and the supported keys", () => {
    expect(() => parse("allowEmtpy: true\n")).toThrow(CiteError);
    expect(() => parse("allowEmtpy: true\n")).toThrow(
      /^Unknown key "allowEmtpy" under cite: in c\.yaml\. Supported keys: allowEmpty, respectGitignore, root, baseline, git, sources, severity\.$/,
    );
  });

  it("refuses salt, naming the family key that replaced it", () => {
    // Refused before the unknown-key check, so the message says what replaced
    // the key rather than calling it a typo. Same shape as the moved keys.
    const refusal =
      'c.yaml: "salt" is no longer a cite key. Values are encrypted with a family key: a top-level encryptionKey:, or MANNI_ENCRYPTION_KEY. Run `manni key set`.';
    expect(() => parse("salt: s3cret\n")).toThrow(CiteError);
    expect(messageOf("salt: s3cret\n")).toBe(refusal);
    expect(messageOf("salt: [s3cret]\n")).toBe(refusal);
  });

  it("calls obfuscate what it now is, an unknown key", () => {
    expect(messageOf("obfuscate: true\n")).toBe(
      'Unknown key "obfuscate" under cite: in c.yaml. Supported keys: allowEmpty, respectGitignore, root, baseline, git, sources, severity.',
    );
  });

  it("refuses paths and exclude, saying where the document set went", () => {
    // Refused before the unknown-key check, so the message says where the key
    // moved rather than calling it a typo (proposal 0041).
    const where =
      "Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections";
    expect(() => parse("paths: ['pages/**/*.md']\n")).toThrow(CiteError);
    expect(messageOf("paths: ['pages/**/*.md']\n")).toBe(
      `c.yaml: "paths" is no longer a cite key. ${where}`,
    );
    expect(messageOf("exclude: ['**/drafts/**']\n")).toBe(
      `c.yaml: "exclude" is no longer a cite key. ${where}`,
    );
    // Even beside a typo: the moved key is the more useful thing to say.
    expect(messageOf("allowEmtpy: true\npaths: [pages]\n")).toMatch(/"paths" is no longer a cite key/);
  });

  it("rejects an unknown rule under severity, naming the rules", () => {
    expect(() => parse("severity:\n  drifted: error\n")).toThrow(
      /^Unknown key "drifted" under cite\.severity: in c\.yaml\. Supported keys: current, moved, .*quote-drift\.$/,
    );
  });

  it("rejects a bad severity level, naming the rule and the levels", () => {
    expect(() => parse("severity:\n  moved: loud\n")).toThrow(
      /cite\.severity\.moved in c\.yaml must be one of error, warning, off/,
    );
    expect(() => parse("severity:\n  moved: loud\n")).toThrow(/"loud"/);
    expect(() => parse("severity:\n  moved: 3\n")).toThrow(
      /cite\.severity\.moved in c\.yaml must be one of error, warning, off/,
    );
  });

  it("rejects a severity that is not a mapping", () => {
    expect(() => parse("severity: error\n")).toThrow(
      /cite\.severity in c\.yaml must be a mapping/,
    );
  });

  it("names the key and the expected type for a wrong-typed value", () => {
    for (const key of ["allowEmpty", "respectGitignore", "git", "sources"]) {
      expect(() => parse(`${key}: yes please\n`)).toThrow(
        new RegExp(`cite\\.${key} in c\\.yaml must be a boolean`),
      );
    }
    for (const key of ["root", "baseline"]) {
      expect(() => parse(`${key}: [a]\n`)).toThrow(
        new RegExp(`cite\\.${key} in c\\.yaml must be a string`),
      );
    }
  });

  function messageOf(yaml: string): string {
    try {
      parse(yaml);
    } catch (err) {
      return (err as Error).message;
    }
    return "";
  }

  it("never echoes a wrong-typed value", () => {
    const secret = "hunter2-do-not-print";
    // A salt, of any type, is refused by name and never quoted back.
    for (const yaml of [`salt: ${secret}\n`, `salt: [${secret}]\n`, `salt: {k: ${secret}}\n`]) {
      const message = messageOf(yaml);
      expect(message).toMatch(/"salt" is no longer a cite key/);
      expect(message).not.toContain(secret);
    }
    // The same rule for every other key.
    expect(messageOf(`root: [${secret}]\n`)).not.toContain(secret);
    expect(messageOf(`git: ${secret}\n`)).not.toContain(secret);
    expect(messageOf(`severity: ${secret}\n`)).not.toContain(secret);
  });
});

describe("loadCiteConfig", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function tree(spec: Record<string, string>): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-cite-cfg-")));
    for (const [rel, content] of Object.entries(spec)) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }
    return tmp;
  }

  it("reads every key of the fixture through an explicit path", async () => {
    const loaded = await loadCiteConfig(FIXTURE, here);
    expect(loaded?.path).toBe(FIXTURE);
    expect(loaded?.dir).toBe(fixtures);
    expect(loaded?.source).toBe(FIXTURE);
    // The document set is the family's, parsed by the shared layer (0041).
    expect(loaded?.collections).toEqual([
      { name: "pages", paths: ["pages/**/*.md", "guides/*.mdx"], exclude: ["**/drafts/**"], externalMetadata: [] },
    ]);
    expect(loaded?.config).toEqual({
      allowEmpty: true,
      respectGitignore: false,
      root: "../src",
      baseline: ".cite-baseline.json",
      git: false,
      sources: false,
      severity: { moved: "error", changed: "warning", current: "off" },
    });
  });

  it("takes its keys from under cite: and leaves meta: alone", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  schemas: [docs.schema.json]\ncite:\n  git: false\n",
    });
    const loaded = await loadCiteConfig(undefined, root);
    expect(loaded?.config).toEqual({ git: false });
    expect(loaded?.collections).toEqual([]);
    expect(loaded?.source).toBe("manni.config.yaml");
    expect(loaded?.path).toBe(join(root, "manni.config.yaml"));
    expect(loaded?.dir).toBe(root);
  });

  it("a family file with collections: and no cite: is cite's config", async () => {
    // The documents are declared; the tool just has no options of its own.
    // Discovery stops here rather than walking past it (0041).
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  git: false\n",
      "docs/manni.config.yaml": "collections:\n  - name: pages\n    paths: [pages]\n",
    });
    const loaded = await loadCiteConfig(undefined, join(root, "docs"));
    expect(loaded?.path).toBe(join(root, "docs", "manni.config.yaml"));
    expect(loaded?.config).toEqual({});
    expect(loaded?.collections.map((c) => c.name)).toEqual(["pages"]);
  });

  it("a bad collections: list is a CiteError", async () => {
    const root = await tree({
      "manni.config.yaml": "collections:\n  - name: docs\n    paths: [docs]\ncite:\n  git: false\n",
    });
    await expect(loadCiteConfig(undefined, root)).rejects.toBeInstanceOf(CiteError);
    await expect(loadCiteConfig(undefined, root)).rejects.toThrow(/collections\[0\]\.name "docs" collides/);
  });

  it("a family file with only meta: is not cite's config", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  git: false\n",
      "docs/manni.config.yaml": "meta:\n  schemas: [docs.schema.json]\n",
    });
    // Discovery keeps looking past the sibling tool's file...
    const loaded = await loadCiteConfig(undefined, join(root, "docs"));
    expect(loaded?.path).toBe(join(root, "manni.config.yaml"));
    expect(loaded?.config).toEqual({ git: false });
  });

  it("returns null when only a sibling tool is configured", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "meta:\n  schemas: [docs.schema.json]\n",
    });
    expect(await loadCiteConfig(undefined, root)).toBeNull();
  });

  it("a discovered file with a typo is a CiteError, not a fall-through", async () => {
    const root = await tree({
      "manni.config.yaml": "cite:\n  gti: false\n",
    });
    await expect(loadCiteConfig(undefined, root)).rejects.toBeInstanceOf(CiteError);
    await expect(loadCiteConfig(undefined, root)).rejects.toThrow(
      /Unknown key "gti" under cite: in manni\.config\.yaml/,
    );
  });

  it("an explicit path that is missing is an error", async () => {
    const root = await tree({});
    await expect(loadCiteConfig("nope.yaml", root)).rejects.toThrow(
      /Config file not found: "nope\.yaml"/,
    );
  });

  it("an explicit path without a cite: key is read whole", async () => {
    const root = await tree({ "cite.yaml": "git: false\n" });
    const loaded = await loadCiteConfig("cite.yaml", root);
    expect(loaded?.config).toEqual({ git: false });
  });
});

describe("resolveCiteRun", () => {
  let tmp: string | undefined;
  let repo: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
    removeTempRepo(repo);
    repo = undefined;
  });

  async function tree(spec: Record<string, string>): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-cite-run-")));
    for (const [rel, content] of Object.entries(spec)) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }
    return tmp;
  }

  /** Two collections and a `cite:` section, the family shape (0041). */
  const TWO_COLLECTIONS = [
    "collections:",
    "  - name: pages",
    "    paths: [pages]",
    "    exclude: ['**/drafts/**']",
    "  - name: guides",
    "    paths: ['guides/*.mdx']",
    "cite:",
    "  git: false",
    "",
  ].join("\n");

  it("falls back to every collection's paths, resolved from the config directory", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": TWO_COLLECTIONS,
      "docs/.keep": "",
    });
    const cwd = join(root, "docs");
    const seen: { path: string; dir: string }[] = [];
    const run = await resolveCiteRun({
      cwd,
      inputs: [],
      env: {},
      onConfigLoaded: (info) => seen.push(info),
    });
    expect(run.inputs).toEqual(["pages", "guides/*.mdx"]);
    expect(run.base).toBe(root);
    expect(run.fromCollections).toBe(true);
    expect(run.collections.map((c) => c.name)).toEqual(["pages", "guides"]);
    expect(run.configDir).toBe(root);
    expect(run.configPath).toBe(join(root, "manni.config.yaml"));
    expect(run.config).toEqual({ git: false });
    expect(seen).toEqual([{ path: join(root, "manni.config.yaml"), dir: root }]);
  });

  it("--collection narrows the run to the named collections, in declaration order", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": TWO_COLLECTIONS,
    });
    const one = await resolveCiteRun({ cwd: root, inputs: [], collection: ["guides"], env: {} });
    expect(one.inputs).toEqual(["guides/*.mdx"]);
    expect(one.collections.map((c) => c.name)).toEqual(["guides"]);
    const both = await resolveCiteRun({
      cwd: root,
      inputs: [],
      collection: ["guides", "pages", "guides"],
      env: {},
    });
    expect(both.inputs).toEqual(["pages", "guides/*.mdx"]);
    // An empty list is no list: commander's collector hands `[]` over.
    const all = await resolveCiteRun({ cwd: root, inputs: [], collection: [], env: {} });
    expect(all.collections.map((c) => c.name)).toEqual(["pages", "guides"]);
  });

  it("an unknown --collection is an error naming the configured ones", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": TWO_COLLECTIONS,
    });
    const failing = resolveCiteRun({ cwd: root, inputs: [], collection: ["gides"], env: {} });
    await expect(failing).rejects.toBeInstanceOf(CiteError);
    await expect(failing).rejects.toThrow(
      'no collection named "gides" in manni.config.yaml. Configured: pages, guides.',
    );
  });

  it("--collection composes with neither positional paths nor --no-config", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": TWO_COLLECTIONS,
    });
    await expect(
      resolveCiteRun({ cwd: root, inputs: ["a.md"], collection: ["pages"], env: {} }),
    ).rejects.toThrow("--collection selects a configured collection; it cannot be combined with paths.");
    await expect(
      resolveCiteRun({ cwd: root, inputs: [], collection: ["pages"], noConfig: true, env: {} }),
    ).rejects.toThrow("--collection needs a config file to select from.");
    // Stdin is one more input, not a path, so it rides beside the flag.
    const run = await resolveCiteRun({ cwd: root, inputs: ["-"], collection: ["pages"], env: {} });
    expect(run.inputs).toEqual(["-"]);
    expect(run.collections.map((c) => c.name)).toEqual(["pages"]);
  });

  it("positional inputs resolve from cwd even when a config governs", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": TWO_COLLECTIONS,
      "docs/.keep": "",
    });
    const cwd = join(root, "docs");
    const run = await resolveCiteRun({ cwd, inputs: ["a.md"], env: {} });
    expect(run.inputs).toEqual(["a.md"]);
    expect(run.base).toBe(cwd);
    expect(run.fromCollections).toBe(false);
    // Still selected: a typed file is a member of whatever contains it.
    expect(run.collections.map((c) => c.name)).toEqual(["pages", "guides"]);
    expect(run.configDir).toBe(root);
  });

  it("--no-config skips discovery and loads nothing, collections included", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": TWO_COLLECTIONS,
    });
    const seen: unknown[] = [];
    const run = await resolveCiteRun({
      cwd: root,
      inputs: [],
      noConfig: true,
      env: {},
      onConfigLoaded: (info) => seen.push(info),
    });
    expect(run.config).toBeNull();
    expect(run.inputs).toEqual([]);
    expect(run.collections).toEqual([]);
    expect(run.base).toBe(root);
    expect(run.configDir).toBeUndefined();
    expect(run.configPath).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("an explicit --root is cwd-relative and beats the config", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  root: cfg-root\n",
      "docs/.keep": "",
    });
    const cwd = join(root, "docs");
    const run = await resolveCiteRun({ cwd, inputs: [], root: "../code", env: {} });
    expect(run.root).toBe(resolve(cwd, "../code"));
  });

  it("a configured root is config-dir-relative", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  root: ../code\n",
      "docs/.keep": "",
    });
    const cwd = join(root, "docs");
    const run = await resolveCiteRun({ cwd, inputs: [], env: {} });
    expect(run.root).toBe(resolve(root, "../code"));
  });

  it("falls back to the git root, without a notice", () => {
    repo = makeTempRepo({ files: { "docs/page.md": "# t\n" } });
    const cwd = join(repo, "docs");
    const notices: string[] = [];
    return resolveCiteRun({
      cwd,
      inputs: [],
      env: {},
      onNotice: (m) => notices.push(m),
    }).then((run) => {
      expect(run.root).toBe(repo);
      expect(run.config).toBeNull();
      expect(notices).toEqual([]);
    });
  });

  it("falls back to cwd with a notice when there is no git root", async () => {
    const root = await tree({ "docs/.keep": "" });
    // Only meaningful when nothing above the temp directory is a repository.
    expect(gitAncestors(root)).toEqual([]);
    const cwd = join(root, "docs");
    const notices: string[] = [];
    const run = await resolveCiteRun({
      cwd,
      inputs: [],
      env: {},
      onNotice: (m) => notices.push(m),
    });
    expect(run.root).toBe(cwd);
    expect(notices).toEqual([`No git root found; resolving src: paths from ${cwd}`]);
  });

  it("takes the encryption key from the environment over the config, else none", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": `encryptionKey: ${CONFIG_KEY}\ncite:\n  git: false\n`,
    });
    const fromEnv = await resolveCiteRun({
      cwd: root,
      inputs: [],
      env: { MANNI_ENCRYPTION_KEY: ENV_KEY },
    });
    expect(fromEnv.key).toBe(ENV_KEY);
    expect(fromEnv.keySource).toBe("env");

    const fromConfig = await resolveCiteRun({ cwd: root, inputs: [], env: {} });
    expect(fromConfig.key).toBe(CONFIG_KEY);
    expect(fromConfig.keySource).toBe("config");

    // An empty variable is what an absent CI secret expands to: unset, not refused.
    const emptyEnv = await resolveCiteRun({ cwd: root, inputs: [], env: { MANNI_ENCRYPTION_KEY: "" } });
    expect(emptyEnv.key).toBe(CONFIG_KEY);
    expect(emptyEnv.keySource).toBe("config");

    const none = await resolveCiteRun({
      cwd: root,
      inputs: [],
      noConfig: true,
      env: {},
    });
    expect(none.key).toBeUndefined();
    expect(none.keySource).toBe("none");
  });

  it("reads the fixture's top-level key, the family's and not a cite one", async () => {
    const run = await resolveCiteRun({ cwd: here, configPath: FIXTURE, inputs: [], env: {} });
    expect(run.key).toBe("cite-fixture-key-0123456789abcdef");
    expect(run.keySource).toBe("config");
    expect(run.config).not.toHaveProperty("encryptionKey");
  });

  it("a family file carrying only encryptionKey: is cite's config, and stops the walk", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  git: true\n",
      "docs/manni.config.yaml": `encryptionKey: ${CONFIG_KEY}\n`,
    });
    const run = await resolveCiteRun({ cwd: join(root, "docs"), inputs: [], env: {} });
    expect(run.configPath).toBe(join(root, "docs", "manni.config.yaml"));
    expect(run.config).toEqual({});
    expect(run.key).toBe(CONFIG_KEY);
  });

  it("refuses a malformed key in the environment, never echoing it", async () => {
    const root = await tree({ ".git/HEAD": "ref: refs/heads/main\n" });
    const run = resolveCiteRun({ cwd: root, inputs: [], env: { MANNI_ENCRYPTION_KEY: "short-secret" } });
    await expect(run).rejects.toBeInstanceOf(CiteError);
    await expect(run).rejects.toThrow(/^MANNI_ENCRYPTION_KEY must be at least 32 hex or base64url characters\.$/);
  });
});
