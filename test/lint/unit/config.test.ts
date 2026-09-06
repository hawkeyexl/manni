/**
 * Config loading, pinned end to end against real files.
 *
 * Every discovery case writes an actual tree under `mkdtemp` rather than
 * mocking `fs`: the behaviors that matter here - a walk that stops at the
 * repository root, an `ENOENT` that means "absent" while an `EISDIR` means
 * "broken" - are properties of the filesystem, and a mocked `fs` would only
 * pin this test's idea of one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_FILENAMES,
  SECTION_KEY,
  loadConfig,
  parseConfig,
} from "../../../src/lint/core/config.js";
import configSchema from "../../../schemas/lint/config.json" with { type: "json" };
import { MooseLintError } from "../../../src/lint/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/config",
);

let dir: string;

/** Write a file under the temp repo, creating its parent directories. */
async function write(rel: string, text: string): Promise<void> {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-lint-config-"));
  // The walk stops at the repository root, so every temp tree needs one -
  // without it the walk would climb out of the fixture and into the real
  // filesystem, which is the failure the boundary exists to prevent.
  await write(".git", "gitdir: elsewhere\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Capture what the family loader says on stderr. Warnings are said once per
 * process, so each test that asserts on one starts from a clean slate.
 */
function captureStderr(): { text: () => string; restore: () => void } {
  resetWarnings();
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    });
  return {
    text: () => chunks.join(""),
    restore: () => {
      spy.mockRestore();
    },
  };
}

/** The message of the MooseLintError `run` throws. Fails if it throws nothing. */
async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(MooseLintError);
    return (err as Error).message;
  }
  throw new Error("expected a MooseLintError, but nothing was thrown");
}

describe("parseConfig", () => {
  it("reads the lint section", () => {
    const config = parseConfig(
      [
        "lint:",
        '  paths: ["docs/**/*.md"]',
        '  exclude: ["**/drafts/**"]',
        '  templates: ["./templates.yaml"]',
        "  template: tgdp:how-to:1.6",
        "  types:",
        "    api-operation: ./templates.yaml#api-operation",
        "  overrides:",
        '    - files: "docs/api/**"',
        "      template: tgdp:reference:1.6",
      ].join("\n"),
      "manni.config.yaml",
    );

    expect(config).toEqual({
      paths: ["docs/**/*.md"],
      exclude: ["**/drafts/**"],
      templates: ["./templates.yaml"],
      template: "tgdp:how-to:1.6",
      types: { "api-operation": "./templates.yaml#api-operation" },
      overrides: [{ files: "docs/api/**", template: "tgdp:reference:1.6" }],
    });
  });

  // The point of the shared file: a sibling's keys are neither read nor
  // validated, so adding a tool to the family needs no change here.
  it("ignores sibling tools' sections, including ones spelling our own keys", () => {
    const config = parseConfig(
      [
        "docevals:",
        "  provider:",
        "    default: anthropic",
        "docmeta:",
        '  paths: ["should-not-be-read/**"]',
        "  overrides:",
        '    - files: "**"',
        "      schemas: [okf]",
        "lint:",
        '  paths: ["docs/**/*.md"]',
      ].join("\n"),
      "manni.config.yaml",
    );

    expect(config).toEqual({ paths: ["docs/**/*.md"] });
  });

  // Keeps one shared file usable by a project that has not adopted this tool.
  it("returns defaults for a file carrying only other tools' sections", () => {
    const config = parseConfig("docevals:\n  provider:\n    default: openai\n", "x");
    expect(config).toEqual({});
  });

  it("returns defaults for an empty file", () => {
    expect(parseConfig("", "x")).toEqual({});
    expect(parseConfig("# just a comment\n", "x")).toEqual({});
  });

  it("returns defaults for a lint key with nothing under it", () => {
    expect(parseConfig("lint:\n", "x")).toEqual({});
  });

  it("rejects a non-mapping root", async () => {
    const message = await messageOf(async () =>
      parseConfig("- lint\n- docevals\n", "manni.config.yaml"),
    );
    expect(message).toContain("manni.config.yaml");
    expect(message).toContain("top level must be a mapping");
  });

  it("rejects unparseable YAML", async () => {
    const message = await messageOf(async () =>
      parseConfig("lint:\n  paths: [unclosed\n", "manni.config.yaml"),
    );
    expect(message).toContain("manni.config.yaml: invalid YAML:");
  });

  it("names the path of an invalid value inside the section", async () => {
    const message = await messageOf(async () =>
      parseConfig(
        ["lint:", "  overrides:", '    - files: "docs/**"', "      template: 7"].join(
          "\n",
        ),
        "manni.config.yaml",
      ),
    );
    expect(message).toContain(`invalid "${SECTION_KEY}" section`);
    expect(message).toContain("lint/overrides/0/template");
    expect(message).toContain("must be string");
  });

  // additionalProperties: false at every level is what turns a typo into a
  // loud failure rather than a key that quietly does nothing.
  it("rejects an unknown key inside the section, and names it", async () => {
    const message = await messageOf(async () =>
      parseConfig('lint:\n  path: ["docs"]\n', "manni.config.yaml"),
    );
    expect(message).toContain("must NOT have additional properties");
    expect(message).toContain('"path"');
  });

  it("rejects an unknown key nested inside an override", async () => {
    const message = await messageOf(async () =>
      parseConfig(
        ["lint:", "  overrides:", '    - files: "docs/**"', "      schemas: [okf]"].join(
          "\n",
        ),
        "manni.config.yaml",
      ),
    );
    expect(message).toContain("lint/overrides/0");
    expect(message).toContain('"schemas"');
  });

  describe("the un-nested config", () => {
    it("names the stray keys and the key they belong under", async () => {
      const message = await messageOf(async () =>
        parseConfig(
          [
            'paths: ["docs/**/*.md"]',
            "overrides:",
            '  - files: "docs/api/**"',
            "    template: tgdp:reference:1.6",
          ].join("\n"),
          "manni.config.yaml",
        ),
      );
      expect(message).toContain('"paths:"');
      expect(message).toContain('"overrides:"');
      expect(message).toContain('no "lint:" key');
      expect(message).toContain("Indent the file's contents one level");
    });

    // The stray list is derived from the schema's own properties, so it cannot
    // fall behind the real key set. Assert that for every key there is.
    it("catches every key the schema declares", async () => {
      const keys = Object.keys(configSchema.properties);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const message = await messageOf(async () =>
          parseConfig(`${key}: {}\n`, "manni.config.yaml"),
        );
        expect(message, `root "${key}:" should be reported`).toContain(`"${key}:"`);
      }
    });

    it("does not fire on a sibling tool's key", () => {
      expect(parseConfig("schemas: [okf]\n", "x")).toEqual({});
    });

    // The message used to name `manni.config.yaml` whatever file was actually
    // read, so someone running `-c my-custom.yaml` was told about a file they
    // had not mentioned and went looking for the wrong one.
    it("names the file it read, not the conventional one", async () => {
      const message = await messageOf(async () =>
        parseConfig('paths: ["docs/**/*.md"]\n', "my-custom.yaml"),
      );
      expect(message).toContain("my-custom.yaml");
      expect(message).not.toContain("manni.config.yaml");
    });
  });

  describe("the miscased wrapper", () => {
    // The stray-key check cannot see this one: its keys are nested, not at the
    // top level, so nothing this tool owns appears at the root.
    it("rejects a top-level key matching lint only case-insensitively", async () => {
      const message = await messageOf(async () =>
        parseConfig('Lint:\n  paths: ["docs/**/*.md"]\n', "manni.config.yaml"),
      );
      expect(message).toContain('"Lint:"');
      expect(message).toContain("case-sensitive");
      expect(message).toContain('Rename "Lint:" to "lint:"');
    });

    it("rejects an all-caps wrapper too", async () => {
      const message = await messageOf(async () =>
        parseConfig("LINT:\n  template: tgdp:how-to:1.6\n", "x"),
      );
      expect(message).toContain('"LINT:"');
    });

    // Accepted, and documented in the ADR: without a registry of tool names, a
    // wrapper misspelled any other way is another tool's section.
    it("cannot see a wrapper misspelled any other way", () => {
      expect(parseConfig('lnt:\n  paths: ["docs"]\n', "x")).toEqual({});
    });
  });
});

describe("loadConfig", () => {
  it("reads the section out of a real shared file, ignoring siblings", async () => {
    const found = await loadConfig(join(FIXTURES, "manni.config.yaml"));
    expect(found).not.toBeNull();
    expect(found?.config).toEqual({
      paths: ["docs/**/*.md"],
      exclude: ["**/drafts/**"],
      templates: ["./templates.yaml"],
      template: "tgdp:how-to:1.6",
      types: { "api-operation": "./templates.yaml#api-operation" },
      overrides: [{ files: "docs/api/**", template: "tgdp:reference:1.6" }],
    });
  });

  it("returns null when no config is anywhere up the tree", async () => {
    await mkdir(join(dir, "docs"), { recursive: true });
    expect(await loadConfig(undefined, join(dir, "docs"))).toBeNull();
  });

  // A family file without a `lint:` key is a sibling tool's config, not an
  // empty one of ours: discovery passes it over and keeps looking.
  it("passes over a family file carrying only other tools' sections", async () => {
    await write("manni.config.yaml", "docevals:\n  provider:\n    default: openai\n");
    expect(await loadConfig(undefined, dir)).toBeNull();
  });

  it("reaches past a sibling's file to a farther one that has our key", async () => {
    await write("manni.config.yaml", "lint:\n  template: tgdp:how-to:1.6\n");
    await write("docs/manni.config.yaml", "docevals:\n  provider:\n    default: openai\n");

    const found = await loadConfig(undefined, join(dir, "docs"));
    expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
    expect(found?.path).toBe(join(dir, "manni.config.yaml"));
  });

  it("still reads the pre-rename family file, with a warning", async () => {
    await write("moose.config.yaml", "lint:\n  template: tgdp:how-to:1.6\n");
    const stderr = captureStderr();
    try {
      const found = await loadConfig(undefined, dir);
      expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
      expect(found?.path).toBe(join(dir, "moose.config.yaml"));
      expect(stderr.text()).toContain("moose.config.yaml");
      expect(stderr.text()).toContain("manni.config.yaml");
    } finally {
      stderr.restore();
    }
  });

  it("accepts the .yml spelling", async () => {
    expect(CONFIG_FILENAMES).toContain("manni.config.yml");
    await write("manni.config.yml", 'lint:\n  template: tgdp:how-to:1.6\n');
    const found = await loadConfig(undefined, dir);
    expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
  });

  describe("discovery", () => {
    // People run the CLI from wherever they are. Looking only in cwd resolved
    // every one of those runs to defaults, with the config one directory up.
    it("walks up from a subdirectory to the repository root", async () => {
      await write("manni.config.yaml", 'lint:\n  paths: ["docs/**/*.md"]\n');
      await mkdir(join(dir, "docs", "api"), { recursive: true });

      const found = await loadConfig(undefined, join(dir, "docs", "api"));
      expect(found?.config).toEqual({ paths: ["docs/**/*.md"] });
      expect(found?.path).toBe(join(dir, "manni.config.yaml"));
    });

    it("prefers the nearest config to a farther one", async () => {
      await write("manni.config.yaml", "lint:\n  template: far\n");
      await write("docs/manni.config.yaml", "lint:\n  template: near\n");

      const found = await loadConfig(undefined, join(dir, "docs"));
      expect(found?.config).toEqual({ template: "near" });
    });

    // Reaching past the project finds a config belonging to something else,
    // which is worse than finding none.
    it("stops at the repository root rather than adopting a config above it", async () => {
      // `dir` holds the `.git` marker; the config sits outside it.
      const outside = await mkdtemp(join(tmpdir(), "manni-lint-outer-"));
      try {
        await writeFile(
          join(outside, "manni.config.yaml"),
          "lint:\n  template: not-ours\n",
          "utf8",
        );
        const inner = join(outside, "repo", "docs");
        await mkdir(inner, { recursive: true });
        await writeFile(join(outside, "repo", ".git"), "gitdir: elsewhere\n", "utf8");

        expect(await loadConfig(undefined, inner)).toBeNull();
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  describe("the pre-family config file", () => {
    // `doc-structure-lint.config.yaml` predates the family file; its whole
    // document is the `lint:` section. It is still read, so an upgrade does
    // not silently run on defaults, and the warning says where to move it.
    it("is read whole, with a warning naming the family file and the key", async () => {
      await write("doc-structure-lint.config.yaml", 'paths: ["docs/**/*.md"]\n');
      const stderr = captureStderr();
      try {
        const found = await loadConfig(undefined, dir);
        expect(found?.config).toEqual({ paths: ["docs/**/*.md"] });
        expect(found?.path).toBe(join(dir, "doc-structure-lint.config.yaml"));

        expect(stderr.text()).toContain("doc-structure-lint.config.yaml");
        expect(stderr.text()).toContain("manni.config.yaml");
        expect(stderr.text()).toContain(`\`${SECTION_KEY}:\``);
      } finally {
        stderr.restore();
      }
    });

    it("is read under the .yml spelling too", async () => {
      await write("doc-structure-lint.config.yml", "template: tgdp:how-to:1.6\n");
      const stderr = captureStderr();
      try {
        const found = await loadConfig(undefined, dir);
        expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
        expect(stderr.text()).toContain("doc-structure-lint.config.yml");
      } finally {
        stderr.restore();
      }
    });

    // A stale config two directories up is exactly as misleading as one in cwd.
    it("is found from a subdirectory of the repo", async () => {
      await write("doc-structure-lint.config.yaml", "template: tgdp:how-to:1.6\n");
      await mkdir(join(dir, "docs", "api"), { recursive: true });
      const stderr = captureStderr();
      try {
        const found = await loadConfig(undefined, join(dir, "docs", "api"));
        expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
      } finally {
        stderr.restore();
      }
    });

    it("yields to a family file beside it, silently", async () => {
      await write("doc-structure-lint.config.yaml", "template: old\n");
      await write("manni.config.yaml", "lint:\n  template: tgdp:how-to:1.6\n");
      const stderr = captureStderr();
      try {
        const found = await loadConfig(undefined, dir);
        expect(found?.config).toEqual({ template: "tgdp:how-to:1.6" });
        expect(stderr.text()).toBe("");
      } finally {
        stderr.restore();
      }
    });

    it("is validated like any other section", async () => {
      await write("doc-structure-lint.config.yaml", 'path: ["docs"]\n');
      const stderr = captureStderr();
      try {
        const message = await messageOf(() => loadConfig(undefined, dir));
        expect(message).toContain("doc-structure-lint.config.yaml");
        expect(message).toContain('"path"');
      } finally {
        stderr.restore();
      }
    });

    // --config gets no filename sniffing and no warning: a file passed by hand
    // may be called anything, and its whole document is the section when it
    // carries no `lint:` key.
    it("is read without a warning behind an explicit --config", async () => {
      await write("doc-structure-lint.config.yaml", 'paths: ["docs/**"]\n');
      const stderr = captureStderr();
      try {
        const found = await loadConfig(join(dir, "doc-structure-lint.config.yaml"));
        expect(found?.config).toEqual({ paths: ["docs/**"] });
        expect(stderr.text()).toBe("");
      } finally {
        stderr.restore();
      }
    });
  });

  describe("an unreadable manni.config.yaml", () => {
    // A directory by that name: the portable stand-in for a file that exists
    // but will not open. The family loader treats a candidate it cannot read
    // as absent, so discovery moves on rather than blaming it.
    it("is passed over by discovery", async () => {
      await mkdir(join(dir, "manni.config.yaml"), { recursive: true });
      expect(await loadConfig(undefined, dir)).toBeNull();
    });

    it("is reported as not found for an explicit --config", async () => {
      await mkdir(join(dir, "custom.yaml"), { recursive: true });
      const message = await messageOf(() => loadConfig(join(dir, "custom.yaml")));
      expect(message).toContain("Config file not found");
    });
  });

  describe("--config", () => {
    it("errors on a missing path", async () => {
      const missing = join(dir, "nope.yaml");
      const message = await messageOf(() => loadConfig(missing));
      expect(message).toBe(`Config file not found: "${missing}".`);
    });

    it("resolves a relative path against cwd", async () => {
      await write("config/custom.yaml", "lint:\n  template: tgdp:reference:1.6\n");
      const found = await loadConfig("config/custom.yaml", dir);
      expect(found?.config).toEqual({ template: "tgdp:reference:1.6" });
      expect(found?.path).toBe(join(dir, "config", "custom.yaml"));
    });

    it("takes the whole document as the section when there is no lint key", async () => {
      await write("custom.yaml", 'paths: ["docs/**/*.md"]\n');
      const found = await loadConfig("custom.yaml", dir);
      expect(found?.config).toEqual({ paths: ["docs/**/*.md"] });
    });

    // The one shape check that survives un-wrapping: nothing in the section's
    // own schema would otherwise name a `Lint:` typed by hand.
    it("still catches a miscased wrapper on a whole-document file", async () => {
      await write("custom.yaml", "Lint:\n  template: tgdp:how-to:1.6\n");
      const message = await messageOf(() => loadConfig("custom.yaml", dir));
      expect(message).toContain('Rename "Lint:" to "lint:"');
    });

    // Discovery is skipped entirely, so a config sitting in cwd is not read.
    it("skips discovery", async () => {
      await write("manni.config.yaml", "lint:\n  template: discovered\n");
      await write("elsewhere/custom.yaml", "lint:\n  template: explicit\n");

      const found = await loadConfig(join(dir, "elsewhere", "custom.yaml"), dir);
      expect(found?.config).toEqual({ template: "explicit" });
    });
  });
});
