import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  SALT_ENV,
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
        "paths: ['pages/**/*.md']",
        "exclude: ['**/drafts/**']",
        "allowEmpty: true",
        "respectGitignore: false",
        "root: ../src",
        "baseline: .cite-baseline.json",
        "git: false",
        "sources: false",
        "salt: s3cret",
        "obfuscate: true",
        "severity:",
        "  moved: error",
        "  changed: warning",
        "  current: off",
      ].join("\n"),
    );
    expect(cfg).toEqual({
      paths: ["pages/**/*.md"],
      exclude: ["**/drafts/**"],
      allowEmpty: true,
      respectGitignore: false,
      root: "../src",
      baseline: ".cite-baseline.json",
      git: false,
      sources: false,
      salt: "s3cret",
      obfuscate: true,
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
      /^Unknown key "allowEmtpy" under cite: in c\.yaml\. Supported keys: paths, exclude, allowEmpty, respectGitignore, root, baseline, git, sources, salt, obfuscate, severity\.$/,
    );
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
    expect(() => parse("paths: pages\n")).toThrow(
      /cite\.paths in c\.yaml must be a list of strings/,
    );
    expect(() => parse("exclude: [1]\n")).toThrow(
      /cite\.exclude in c\.yaml must be a list of strings/,
    );
    for (const key of ["allowEmpty", "respectGitignore", "git", "sources", "obfuscate"]) {
      expect(() => parse(`${key}: yes please\n`)).toThrow(
        new RegExp(`cite\\.${key} in c\\.yaml must be a boolean`),
      );
    }
    for (const key of ["root", "baseline", "salt"]) {
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
    // A salt of the wrong type is still a salt: name the key, not the value.
    for (const yaml of [`salt: [${secret}]\n`, `salt: {k: ${secret}}\n`]) {
      const message = messageOf(yaml);
      expect(message).toMatch(/cite\.salt in c\.yaml must be a string/);
      expect(message).not.toContain(secret);
    }
    // The same rule for every other key.
    expect(messageOf(`paths: ${secret}\n`)).not.toContain(secret);
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
    expect(loaded?.config).toEqual({
      paths: ["pages/**/*.md", "guides/*.mdx"],
      exclude: ["**/drafts/**"],
      allowEmpty: true,
      respectGitignore: false,
      root: "../src",
      baseline: ".cite-baseline.json",
      git: false,
      sources: false,
      salt: "fixture-salt",
      obfuscate: true,
      severity: { moved: "error", changed: "warning", current: "off" },
    });
  });

  it("takes its keys from under cite: and leaves meta: alone", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  paths: [docs]\ncite:\n  git: false\n",
    });
    const loaded = await loadCiteConfig(undefined, root);
    expect(loaded?.config).toEqual({ git: false });
    expect(loaded?.path).toBe(join(root, "manni.config.yaml"));
    expect(loaded?.dir).toBe(root);
  });

  it("a family file with only meta: is not cite's config", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  paths: [pages]\n",
      "docs/manni.config.yaml": "meta:\n  paths: [docs]\n",
    });
    // Discovery keeps looking past the sibling tool's file...
    const loaded = await loadCiteConfig(undefined, join(root, "docs"));
    expect(loaded?.path).toBe(join(root, "manni.config.yaml"));
    expect(loaded?.config.paths).toEqual(["pages"]);
  });

  it("returns null when only a sibling tool is configured", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "meta:\n  paths: [docs]\n",
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
    const root = await tree({ "cite.yaml": "obfuscate: true\n" });
    const loaded = await loadCiteConfig("cite.yaml", root);
    expect(loaded?.config).toEqual({ obfuscate: true });
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

  it("falls back to config paths, resolved from the config directory", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  paths: [pages]\n",
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
    expect(run.inputs).toEqual(["pages"]);
    expect(run.base).toBe(root);
    expect(run.configDir).toBe(root);
    expect(run.configPath).toBe(join(root, "manni.config.yaml"));
    expect(run.config?.paths).toEqual(["pages"]);
    expect(seen).toEqual([{ path: join(root, "manni.config.yaml"), dir: root }]);
  });

  it("positional inputs resolve from cwd even when a config governs", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  paths: [pages]\n",
      "docs/.keep": "",
    });
    const cwd = join(root, "docs");
    const run = await resolveCiteRun({ cwd, inputs: ["a.md"], env: {} });
    expect(run.inputs).toEqual(["a.md"]);
    expect(run.base).toBe(cwd);
    expect(run.configDir).toBe(root);
  });

  it("--no-config skips discovery and loads nothing", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  paths: [pages]\n",
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

  it("takes the salt from the environment over the config, else empty", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "manni.config.yaml": "cite:\n  salt: from-config\n",
    });
    const fromEnv = await resolveCiteRun({
      cwd: root,
      inputs: [],
      env: { [SALT_ENV]: "from-env" },
    });
    expect(fromEnv.salt).toBe("from-env");

    const fromConfig = await resolveCiteRun({ cwd: root, inputs: [], env: {} });
    expect(fromConfig.salt).toBe("from-config");

    const none = await resolveCiteRun({
      cwd: root,
      inputs: [],
      noConfig: true,
      env: {},
    });
    expect(none.salt).toBe("");
  });
});
