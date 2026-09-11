import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  loadConfig,
  parseConfig,
  parseConfigValue,
  resolveRunConfig,
  schemaTrustRoot,
} from "../src/meta/core/config.js";
import {
  DEFAULT_SCHEMAS,
  resolveSchemaSet,
} from "../src/meta/core/resolve-schema.js";
import { DocmetaError } from "../src/meta/types.js";
import { DOC, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("config", () => {
  it("parses a lightweight YAML config", () => {
    const cfg = parseConfig(
      [
        "schemas:",
        "  - google:okf:0.1",
        "overrides:",
        "  - files: 'articles/**/*.md'",
        "    schemas:",
        "      - google:okf:0.1",
        "      - doc-detective:1.0",
      ].join("\n"),
      "docmeta.config.yaml",
    );
    expect(cfg.schemas).toEqual(["google:okf:0.1"]);
    expect(cfg.overrides?.[0]?.files).toBe("articles/**/*.md");
    expect(cfg.overrides?.[0]?.schemas).toContain("doc-detective:1.0");
  });

  it("treats an empty config as all-undefined", () => {
    const cfg = parseConfig("", "docmeta.config.yaml");
    expect(cfg.overrides).toBeUndefined();
    expect(cfg.schemas).toBeUndefined();
  });

  it("rejects a malformed schemas field", () => {
    expect(() => parseConfig("schemas: not-a-list", "x.yaml")).toThrow(
      DocmetaError,
    );
  });

  // The same false-green as a misspelled `intergrity:` inside a `schemas:`
  // entry, one level up: a key the parser does not know was dropped in
  // silence, so `schemaTust:` or `allowEmtpy:` left a config that read as
  // configured and was not.
  it("rejects an unknown top-level key rather than ignoring it", () => {
    expect(() => parseConfig("schemaTust:\n  documentRefs: local\n", "c.yaml")).toThrow(
      /unknown key "schemaTust"/,
    );
    expect(() => parseConfig("allowEmtpy: true\n", "c.yaml")).toThrow(
      /unknown key "allowEmtpy"/,
    );
  });

  it("names the supported top-level keys when it rejects one", () => {
    expect(() => parseConfig("nonsense: 1\n", "c.yaml")).toThrow(
      /Supported keys: .*schemaTrust/,
    );
  });

  it("rejects an unknown key inside schemaCache", () => {
    expect(() => parseConfig("schemaCache:\n  ttlHour: 6\n", "c.yaml")).toThrow(
      /"schemaCache" has unknown key "ttlHour"/,
    );
  });

  it("rejects an unknown key inside fill", () => {
    expect(() => parseConfig("fill:\n  proivder: anthropic\n", "c.yaml")).toThrow(
      /"fill" has unknown key "proivder"/,
    );
  });

  it("rejects an unknown key inside an overrides entry", () => {
    // The section the first pass missed, and the worst case of the three: a
    // misspelling *beside* a correct key was dropped in silence and the run
    // passed, which is the false green this check exists to end.
    expect(() =>
      parseConfig(
        'overrides:\n  - files: "*.md"\n    schemas: [google:okf:0.1]\n    schemass: [x]\n',
        "c.yaml",
      ),
    ).toThrow(/overrides\[0\] has unknown key "schemass"/);
    // And alone, where the old message blamed `schemas` for being absent
    // rather than naming the key that was wrong.
    expect(() =>
      parseConfig(
        'overrides:\n  - files: "*.md"\n    schemass: [google:okf:0.1]\n',
        "c.yaml",
      ),
    ).toThrow(/unknown key "schemass"/);
  });

  it("still accepts every key it documents", () => {
    // The guard is a whitelist, so a key omitted from it would start failing a
    // config that has always been valid. Exercise all of them together.
    const cfg = parseConfig(
      [
        "schemas: ['google:okf:0.1']",
        "overrides:",
        "  - files: 'a/**'",
        "    schemas: ['google:okf:0.1']",
        "baseline: .docmeta-baseline.json",
        "allowEmpty: true",
        "respectGitignore: false",
        "offline: true",
        "schemaCache:",
        "  ttlHours: 6",
        "schemaTrust:",
        "  documentRefs: local",
        "fill:",
        "  provider: anthropic",
      ].join("\n"),
      "c.yaml",
    );
    expect(cfg.baseline).toBe(".docmeta-baseline.json");
    expect(cfg.offline).toBe(true);
    expect(cfg.schemaCache).toEqual({ ttlHours: 6 });
    expect(cfg.schemaTrust).toEqual({ documentRefs: "local" });
    expect(cfg.fill).toEqual({ provider: "anthropic" });
  });

  it("loads the fixture config from disk", async () => {
    const loaded = await loadConfig(join(here, "fixtures", "docmeta.config.yaml"));
    expect(loaded?.config.schemas).toEqual(["google:okf:0.1"]);
  });

  it("errors when an explicit config path is missing", async () => {
    await expect(loadConfig(join(here, "fixtures", "nope.yaml"))).rejects.toBeInstanceOf(
      DocmetaError,
    );
  });

  describe("fill", () => {
    it("parses the fill block", () => {
      const cfg = parseConfig(
        [
          "fill:",
          "  provider: anthropic",
          "  model: claude-sonnet-4-5",
          "  confidenceThreshold: 0.9",
          "  maxTurns: 5",
          "  concurrency: 8",
        ].join("\n"),
        "x.yaml",
      );
      expect(cfg.fill).toEqual({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        confidenceThreshold: 0.9,
        maxTurns: 5,
        concurrency: 8,
      });
    });

    it("leaves fill undefined when absent", () => {
      expect(
        parseConfig("schemas:\n  - google:okf:0.1", "x.yaml").fill,
      ).toBeUndefined();
    });

    it("rejects a confidence threshold outside 0-1", () => {
      expect(() =>
        parseConfig("fill:\n  confidenceThreshold: 1.5", "x.yaml"),
      ).toThrow(DocmetaError);
      expect(() =>
        parseConfig("fill:\n  confidenceThreshold: -0.1", "x.yaml"),
      ).toThrow(DocmetaError);
    });

    it("rejects a non-finite maxTurns", () => {
      // YAML parses 1e999 as Infinity, which a bare range check would accept.
      // Assert on the message, not just the type: with the key name wrong this
      // still throws — for "unknown key" — and would pass without testing the
      // range check at all.
      expect(() => parseConfig("fill:\n  maxTurns: 1e999", "x.yaml")).toThrow(
        /"fill.maxTurns" must be a number/,
      );
    });

    it("rejects a fractional concurrency", () => {
      // Silently truncating a worker count hides the mistake from the user.
      expect(() =>
        parseConfig("fill:\n  concurrency: 2.5", "x.yaml"),
      ).toThrow(/whole number/);
    });

    it("rejects a non-mapping fill block and wrong-typed keys", () => {
      expect(() => parseConfig("fill: nope", "x.yaml")).toThrow(DocmetaError);
      expect(() => parseConfig("fill:\n  provider: 3", "x.yaml")).toThrow(
        DocmetaError,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 0004 — discovery walks up to a project boundary
// ---------------------------------------------------------------------------

/**
 * Every directory at or above `from` that holds a `.git` entry.
 *
 * Used as an explicit precondition in the "no boundary" test: that case is
 * only meaningful when nothing above the temp directory is a repository, and
 * a silent violation would make the test assert the opposite of its name.
 */
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

describe("config discovery reads the family file", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function tree(spec: Record<string, string>): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "docmeta-family-")));
    for (const [rel, content] of Object.entries(spec)) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }
    return tmp;
  }

  it("takes its keys from under meta: in manni.config.yaml", async () => {
    const root = await tree({
      "manni.config.yaml":
        "meta:\n  schemas:\n    - google:okf:0.1\ndocevals:\n  version: 1\n",
    });
    const loaded = await loadConfig(undefined, root);
    expect(loaded?.config.schemas).toEqual(["google:okf:0.1"]);
    expect(loaded?.path).toBe(join(root, "manni.config.yaml"));
    expect(loaded?.section).toBe("meta");
  });

  it("names the section in a validation error", async () => {
    const root = await tree({
      "manni.config.yaml": "meta:\n  schemas: not-a-list\n",
    });
    await expect(loadConfig(undefined, root)).rejects.toThrow(
      /manni\.config\.yaml: "meta\.schemas" must be a list/,
    );
  });

  it("still reads a top-level docmeta.config.yaml as the metadata tool's keys", async () => {
    const root = await tree({
      "docmeta.config.yaml": "schemas:\n  - google:okf:0.1\n",
    });
    const loaded = await loadConfig(undefined, root);
    expect(loaded?.config.schemas).toEqual(["google:okf:0.1"]);
    expect(loaded?.section).toBeUndefined();
  });

  it("a discovered file with a typo is an error, not a fall-through", async () => {
    const root = await tree({
      "docmeta.config.yaml": "schemas: not-a-list\n",
    });
    await expect(loadConfig(undefined, root)).rejects.toBeInstanceOf(DocmetaError);
  });

  it("an explicit path to a wrapped file unwraps it without filename sniffing", async () => {
    const root = await tree({
      "whatever.yml": "meta:\n  schemas: [google:okf:0.1]\n",
    });
    const loaded = await loadConfig("whatever.yml", root);
    expect(loaded?.config.schemas).toEqual(["google:okf:0.1"]);
    expect(loaded?.section).toBe("meta");
  });
});

describe("config discovery walks up (0004)", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  /**
   * Build a throwaway tree. A `.git` **file** cannot be committed inside this
   * repo's own working tree in a form git preserves, so boundary fixtures are
   * built at runtime instead.
   */
  async function tree(spec: Record<string, string>): Promise<string> {
    // realpath: macOS hands back a /var symlink for /private/var, and the walk
    // compares resolved directory strings.
    tmp = await realpath(await mkdtemp(join(tmpdir(), "docmeta-cfg-")));
    for (const [rel, content] of Object.entries(spec)) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }
    return tmp;
  }

  const CONFIG = "schemas:\n  - ./strict.schema.json\n";

  it("finds a config in an ancestor directory", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "docmeta.config.yaml": CONFIG,
      "docs/api/page.md": "---\ntype: guide\n---\n",
    });
    const loaded = await loadConfig(undefined, join(root, "docs", "api"));
    expect(loaded?.config.schemas).toEqual(["./strict.schema.json"]);
    expect(loaded?.dir).toBe(root);
    expect(loaded?.path).toBe(join(root, "docmeta.config.yaml"));
  });

  it("stops at a `.git` directory", async () => {
    const root = await tree({
      "docmeta.config.yaml": CONFIG,
      "inner/.git/HEAD": "ref: refs/heads/main\n",
      "inner/docs/page.md": "---\ntype: guide\n---\n",
    });
    expect(await loadConfig(undefined, join(root, "inner", "docs"))).toBeNull();
  });

  it("stops at a `.git` *file* as well (the worktree case)", async () => {
    // This repo's own worktrees carry `.git` as a regular file holding a
    // `gitdir:` pointer. An isDirectory() boundary check would walk straight
    // past it into the outer checkout.
    const root = await tree({
      "docmeta.config.yaml": CONFIG,
      "inner/.git": "gitdir: /somewhere/else/.git/worktrees/inner\n",
      "inner/docs/page.md": "---\ntype: guide\n---\n",
    });
    expect(await loadConfig(undefined, join(root, "inner", "docs"))).toBeNull();
  });

  it("searches the boundary directory itself, not just below it", async () => {
    const root = await tree({
      ".git": "gitdir: /somewhere/else\n",
      "docmeta.config.yaml": CONFIG,
      "docs/page.md": "---\ntype: guide\n---\n",
    });
    const loaded = await loadConfig(undefined, join(root, "docs"));
    expect(loaded?.dir).toBe(root);
  });

  it("considers only cwd when no ancestor is a repository", async () => {
    const root = await tree({
      "docmeta.config.yaml": CONFIG,
      "docs/page.md": "---\ntype: guide\n---\n",
    });
    // Precondition: a stray repository above the temp directory would make
    // the walk legitimate and invert this assertion.
    expect(gitAncestors(root)).toEqual([]);

    expect(await loadConfig(undefined, join(root, "docs"))).toBeNull();
    // ...while cwd itself is still searched, exactly as before.
    expect((await loadConfig(undefined, root))?.dir).toBe(root);
  });

  it("takes the nearest config: a subdirectory shadows the root", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "docmeta.config.yaml": "schemas:\n  - google:okf:0.1\n",
      "docs/docmeta.config.yaml": "schemas:\n  - diataxis:diataxis:1.0\n",
      "docs/api/page.md": "---\ntype: guide\n---\n",
    });
    const loaded = await loadConfig(undefined, join(root, "docs", "api"));
    // First found wins; ancestor configs are not merged in.
    expect(loaded?.config.schemas).toEqual(["diataxis:diataxis:1.0"]);
    expect(loaded?.dir).toBe(join(root, "docs"));
  });

  it("prefers .yaml over .yml within one directory", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "docmeta.config.yaml": "schemas:\n  - google:okf:0.1\n",
      "docmeta.config.yml": "schemas:\n  - diataxis:diataxis:1.0\n",
      "docs/page.md": "---\ntype: guide\n---\n",
    });
    const loaded = await loadConfig(undefined, join(root, "docs"));
    expect(loaded?.config.schemas).toEqual(["google:okf:0.1"]);
  });

  it("an explicit path still errors when missing, and never walks", async () => {
    const root = await tree({
      ".git/HEAD": "ref: refs/heads/main\n",
      "docmeta.config.yaml": CONFIG,
      "docs/page.md": "---\ntype: guide\n---\n",
    });
    await expect(
      loadConfig(join(root, "docs", "nope.yaml"), join(root, "docs")),
    ).rejects.toThrow(/Config file not found/);
  });

  it("reports the directory of an explicit config path", async () => {
    const loaded = await loadConfig(
      join(here, "fixtures", "docmeta.config.yaml"),
    );
    expect(loaded?.dir).toBe(join(here, "fixtures"));
  });
});

describe("config: respectGitignore", () => {
  it("parses a boolean", () => {
    expect(
      parseConfig("respectGitignore: false\n", "docmeta.config.yaml")
        .respectGitignore,
    ).toBe(false);
    expect(
      parseConfig("respectGitignore: true\n", "docmeta.config.yaml")
        .respectGitignore,
    ).toBe(true);
  });

  it("is undefined when absent, so the default stays in one place", () => {
    expect(
      parseConfig("schemas: ['google:okf:0.1']\n", "docmeta.config.yaml")
        .respectGitignore,
    ).toBeUndefined();
  });

  it("rejects a non-boolean", () => {
    // `respectGitignore: "false"` is a truthy string, so accepting it would
    // turn filtering ON for someone who wrote it off.
    expect(() =>
      parseConfig("respectGitignore: 'false'\n", "docmeta.config.yaml"),
    ).toThrow(DocmetaError);
    expect(() =>
      parseConfig("respectGitignore: 'false'\n", "docmeta.config.yaml"),
    ).toThrow(/"respectGitignore" must be a boolean/);
  });
});

describe("config: offline", () => {
  it("parses a boolean", () => {
    expect(parseConfig("offline: true\n", "docmeta.config.yaml").offline).toBe(
      true,
    );
    expect(parseConfig("offline: false\n", "docmeta.config.yaml").offline).toBe(
      false,
    );
  });

  it("is undefined when absent, so the default stays in one place", () => {
    expect(
      parseConfig("schemas: ['google:okf:0.1']\n", "docmeta.config.yaml")
        .offline,
    ).toBeUndefined();
  });

  it("rejects a non-boolean", () => {
    // `offline: "false"` is a truthy string; accepting it would cut a repo off
    // from the network for someone who wrote the setting off.
    expect(() =>
      parseConfig("offline: 'false'\n", "docmeta.config.yaml"),
    ).toThrow(/"offline" must be a boolean/);
  });
});

describe("config: schemaCache", () => {
  it("parses ttlHours", () => {
    expect(
      parseConfig("schemaCache:\n  ttlHours: 6\n", "docmeta.config.yaml")
        .schemaCache,
    ).toEqual({ ttlHours: 6 });
  });

  it("accepts 0, which disables the cache", () => {
    expect(
      parseConfig("schemaCache:\n  ttlHours: 0\n", "docmeta.config.yaml")
        .schemaCache,
    ).toEqual({ ttlHours: 0 });
  });

  it("accepts a fractional TTL", () => {
    // Unlike `fill.concurrency`, a fraction of an hour is meaningful.
    expect(
      parseConfig("schemaCache:\n  ttlHours: 0.5\n", "docmeta.config.yaml")
        .schemaCache,
    ).toEqual({ ttlHours: 0.5 });
  });

  it("rejects a non-mapping", () => {
    expect(() =>
      parseConfig("schemaCache: 24\n", "docmeta.config.yaml"),
    ).toThrow(/"schemaCache" must be a mapping/);
  });

  it("rejects a non-number", () => {
    expect(() =>
      parseConfig("schemaCache:\n  ttlHours: '24'\n", "docmeta.config.yaml"),
    ).toThrow(DocmetaError);
  });

  it("rejects a negative TTL", () => {
    // Negative would make every entry stale forever — a cache that silently
    // does nothing, which is exactly the failure the key exists to avoid.
    expect(() =>
      parseConfig("schemaCache:\n  ttlHours: -1\n", "docmeta.config.yaml"),
    ).toThrow(/"schemaCache.ttlHours" must be a number/);
  });

  it("rejects a non-finite TTL", () => {
    // YAML's `1e999` parses to Infinity, and a bare range check would accept it.
    expect(() =>
      parseConfig("schemaCache:\n  ttlHours: 1e999\n", "docmeta.config.yaml"),
    ).toThrow(DocmetaError);
  });

  it("is undefined when absent, so the default stays in one place", () => {
    expect(
      parseConfig("schemas: ['google:okf:0.1']\n", "docmeta.config.yaml")
        .schemaCache,
    ).toBeUndefined();
  });
});

describe("schemaCache.ttlHours upper bound", () => {
  // `Number.isFinite(1e308)` is true, so the finiteness check alone lets it
  // through — and `1e308 * 3_600_000` overflows to Infinity, so `elapsed >=
  // Infinity` is never true and every entry is served forever. A cache that
  // silently stops expiring is the opposite of what a TTL is for.
  it("rejects a finite value large enough to overflow the millisecond product", () => {
    expect(() =>
      parseConfig("schemaCache:\n  ttlHours: 1e308\n", "c.yaml"),
    ).toThrow(DocmetaError);
    expect(() =>
      parseConfig("schemaCache:\n  ttlHours: 1e308\n", "c.yaml"),
    ).toThrow(/between 0 and/);
  });

  it("accepts a year and rejects just past it", () => {
    expect(
      parseConfig("schemaCache:\n  ttlHours: 8760\n", "c.yaml").schemaCache
        ?.ttlHours,
    ).toBe(8760);
    expect(() =>
      parseConfig("schemaCache:\n  ttlHours: 8761\n", "c.yaml"),
    ).toThrow(DocmetaError);
  });
});

// ---------------------------------------------------------------------------
// 0008 — `schemas:` entries widen to `string | { ref, source?, integrity? }`
// ---------------------------------------------------------------------------

const PIN = `sha256-${"a".repeat(64)}`;

describe("schemas: the object form (0008)", () => {
  it("still accepts a plain list of strings", () => {
    const cfg = parseConfig("schemas:\n  - google:okf:0.1\n", "c.yaml");
    expect(cfg.schemas).toEqual(["google:okf:0.1"]);
  });

  it("accepts a mapping with ref, source, and integrity", () => {
    const cfg = parseConfig(
      [
        "schemas:",
        "  - ref: ./schema/house.json",
        "    source: https://schemas.example.com/house/2.1.json",
        `    integrity: "${PIN}"`,
      ].join("\n"),
      "c.yaml",
    );
    expect(cfg.schemas).toEqual([
      {
        ref: "./schema/house.json",
        source: "https://schemas.example.com/house/2.1.json",
        integrity: PIN,
      },
    ]);
  });

  it("accepts strings and mappings side by side", () => {
    const cfg = parseConfig(
      [
        "schemas:",
        "  - google:okf:0.1",
        "  - ref: ./schema/house.json",
      ].join("\n"),
      "c.yaml",
    );
    expect(cfg.schemas).toEqual([
      "google:okf:0.1",
      { ref: "./schema/house.json" },
    ]);
  });

  it("rejects a mapping with no ref", () => {
    expect(() =>
      parseConfig("schemas:\n  - source: https://e.com/s.json\n", "c.yaml"),
    ).toThrow(/schemas\[0\]\.ref/);
  });

  it("rejects an empty ref", () => {
    expect(() => parseConfig('schemas:\n  - ref: "  "\n', "c.yaml")).toThrow(
      DocmetaError,
    );
  });

  // A typo'd key that is silently ignored is the worst outcome available here:
  // `intergrity:` would leave the schema unpinned while the config reads as if
  // it were pinned.
  it("rejects an unknown key rather than ignoring it", () => {
    expect(() =>
      parseConfig(
        `schemas:\n  - ref: ./s.json\n    intergrity: "${PIN}"\n`,
        "c.yaml",
      ),
    ).toThrow(/intergrity/);
  });

  it("rejects an integrity that is not sha256-<64 hex>", () => {
    for (const bad of ["nonsense", "sha256-zz", "sha512-" + "a".repeat(128)]) {
      expect(() =>
        parseConfig(`schemas:\n  - ref: ./s.json\n    integrity: "${bad}"\n`, "c.yaml"),
      ).toThrow(/integrity/);
    }
  });

  // An integrity pin is verified against bytes on disk. Accepting one on a
  // built-in id or a URL would record a pin nothing can check — a config that
  // reads as pinned and is not.
  it("rejects integrity on a reference that is not a local file", () => {
    expect(() =>
      parseConfig(
        `schemas:\n  - ref: https://e.com/s.json\n    integrity: "${PIN}"\n`,
        "c.yaml",
      ),
    ).toThrow(/integrity/);
    expect(() =>
      parseConfig(
        `schemas:\n  - ref: google:okf:0.1\n    integrity: "${PIN}"\n`,
        "c.yaml",
      ),
    ).toThrow(/integrity/);
  });

  it("rejects a non-string source", () => {
    expect(() =>
      parseConfig("schemas:\n  - ref: ./s.json\n    source: 42\n", "c.yaml"),
    ).toThrow(/source/);
  });

  it("rejects a list entry that is neither a string nor a mapping", () => {
    expect(() => parseConfig("schemas:\n  - [a, b]\n", "c.yaml")).toThrow(
      DocmetaError,
    );
    expect(() => parseConfig("schemas:\n  - 42\n", "c.yaml")).toThrow(
      DocmetaError,
    );
  });

  // `asStringList` is shared with `elements` and `overrides[].schemas`.
  // Widening it in place would have widened those too.
  it("does not widen elements or overrides[].schemas", () => {
    expect(() => parseConfig("elements:\n  - ref: ./x.md\n", "c.yaml")).toThrow(
      DocmetaError,
    );
    expect(() =>
      parseConfig(
        "overrides:\n  - files: '**/*.md'\n    schemas:\n      - ref: ./s.json\n",
        "c.yaml",
      ),
    ).toThrow(DocmetaError);
  });
});

// ---------------------------------------------------------------------------
// 0015 — `schemaTrust:`, the trust boundary for document-supplied refs
// ---------------------------------------------------------------------------

describe("config: schemaTrust", () => {
  it("parses documentRefs and hosts", () => {
    expect(
      parseConfig(
        "schemaTrust:\n  documentRefs: local\n",
        "docmeta.config.yaml",
      ).schemaTrust,
    ).toEqual({ documentRefs: "local" });
    expect(
      parseConfig(
        "schemaTrust:\n  documentRefs: any\n  hosts:\n    - schemas.example.com\n",
        "docmeta.config.yaml",
      ).schemaTrust,
    ).toEqual({ documentRefs: "any", hosts: ["schemas.example.com"] });
  });

  it("accepts every documented mode", () => {
    for (const mode of ["any", "local", "none"]) {
      expect(
        parseConfig(`schemaTrust:\n  documentRefs: ${mode}\n`, "c.yaml")
          .schemaTrust?.documentRefs,
      ).toBe(mode);
    }
  });

  it("is undefined when absent, so the default stays in one place", () => {
    expect(
      parseConfig("schemas: ['google:okf:0.1']\n", "docmeta.config.yaml")
        .schemaTrust,
    ).toBeUndefined();
  });

  it("rejects a non-mapping", () => {
    expect(() => parseConfig("schemaTrust: local\n", "c.yaml")).toThrow(
      /"schemaTrust" must be a mapping/,
    );
  });

  // The failure worth catching: a misspelled nested key would otherwise be
  // dropped in silence, leaving a config that reads as guarded and is not.
  it("rejects an unknown key inside the mapping", () => {
    expect(() =>
      parseConfig("schemaTrust:\n  documentRef: local\n", "c.yaml"),
    ).toThrow(/unknown key "documentRef"/);
    expect(() =>
      parseConfig("schemaTrust:\n  documentRef: local\n", "c.yaml"),
    ).toThrow(/documentRefs, hosts/);
  });

  it("rejects a documentRefs value outside the three modes", () => {
    expect(() =>
      parseConfig("schemaTrust:\n  documentRefs: strict\n", "c.yaml"),
    ).toThrow(/"schemaTrust.documentRefs" must be one of/);
    expect(() =>
      parseConfig("schemaTrust:\n  documentRefs: true\n", "c.yaml"),
    ).toThrow(DocmetaError);
  });

  it("rejects hosts that is not a list of non-empty strings", () => {
    expect(() =>
      parseConfig("schemaTrust:\n  hosts: schemas.example.com\n", "c.yaml"),
    ).toThrow(/"schemaTrust.hosts" must be a list/);
    expect(() =>
      parseConfig("schemaTrust:\n  hosts:\n    - 42\n", "c.yaml"),
    ).toThrow(/"schemaTrust.hosts" must be a list/);
    expect(() =>
      parseConfig("schemaTrust:\n  hosts:\n    - '  '\n", "c.yaml"),
    ).toThrow(DocmetaError);
  });

  it("carries a remedy in the message, not just a rule", () => {
    expect(() =>
      parseConfig("schemaTrust:\n  documentRefs: strict\n", "c.yaml"),
    ).toThrow(/documentRefs: any/);
  });
});

describe("schemaTrustRoot", () => {
  let dir: string | undefined;
  afterEach(() => {
    removeTempRepo(dir);
    dir = undefined;
  });

  it("reports the git root, from anywhere inside it", () => {
    dir = makeTempRepo({ files: { "packages/docs/a.md": DOC } });
    expect(schemaTrustRoot(dir)).toEqual({ dir, source: "git" });
    // The monorepo case: a package deep inside still gets the repository, so a
    // document referencing `../shared/x.json` stays inside the boundary.
    expect(schemaTrustRoot(join(dir, "packages", "docs"))).toEqual({
      dir,
      source: "git",
    });
  });

  it("falls back to the config directory when there is no repository", () => {
    dir = makeTempRepo({ files: { "pkg/a.md": DOC }, init: false });
    const configDir = join(dir, "pkg");
    expect(schemaTrustRoot(dir, configDir)).toEqual({
      dir: configDir,
      source: "config",
    });
  });

  it("falls back to cwd when there is neither a repository nor a config", () => {
    dir = makeTempRepo({ files: { "a.md": DOC }, init: false });
    // `source` distinguishes this from the config fallback above. A boolean
    // could not, and the refusal message told someone with no config file that
    // "the config's own directory is the boundary" — a file that is not there.
    expect(schemaTrustRoot(dir)).toEqual({ dir, source: "cwd" });
  });
});

/**
 * docmeta validating its own docs, guarded.
 *
 * These read the **real** root `docmeta.config.yaml` rather than a fixture, on
 * purpose: the thing under test is that the project dogfoods its own discovery
 * path, and a fixture copy would keep passing after the real file rotted.
 */
describe("the repository's own manni.config.yaml", () => {
  const repoRoot = resolve(here, "..");

  it("is what discovery finds from the repo root, and names a schema that is there", async () => {
    const loaded = await loadConfig(undefined, repoRoot);
    expect(loaded?.path).toBe(join(repoRoot, "manni.config.yaml"));
    expect(loaded?.dir).toBe(repoRoot);
    // The document set is a top-level collection, read by every tool (0041),
    // rather than a `meta:` key only the metadata tool could see.
    expect(loaded?.collections).toEqual([
      {
        name: "site",
        paths: ["docs/src/content/docs/**/*.{md,mdx}"],
        exclude: [],
        externalMetadata: [],
        // Where the site is published, so `manni a11y check` needs no `urls:`
        // of its own (0041 rule 12). The local preview, not the deployed site.
        url: "http://127.0.0.1:4321/manni/",
      },
    ]);

    const ref = loaded?.config.overrides?.[0]?.schemas[0];
    expect(ref).toBe("./docs/doc-frontmatter.schema.json");
    // Resolved the way a config-supplied file ref is: against the config's own
    // directory. The `?? ` guard is not decoration — `resolve(repoRoot, "")` is
    // `repoRoot`, which exists, so a missing ref would otherwise pass.
    expect(existsSync(resolve(repoRoot, ref ?? "<missing>"))).toBe(true);
  });

  it("scopes the docs schema to the docs and leaves everything else on the defaults", async () => {
    // The reason the schema hangs off `overrides:` instead of top-level
    // `schemas:`. A root config is discovered by every manni run beneath it,
    // this suite's included, and `schemas:` is the default set for *every*
    // validated file — so spelling it there would judge the fixtures under
    // `test/` against the docs frontmatter contract.
    const config = (await loadConfig(undefined, repoRoot))?.config;
    expect(config?.schemas).toBeUndefined();

    expect(
      resolveSchemaSet({
        filePath: "docs/src/content/docs/index.mdx",
        config,
        // The override names the `site` collection rather than globs of its
        // own, so membership is what it matches on — the command cores compute
        // this per file with `memberOf`.
        memberOf: ["site"],
      }),
      // Two, and both are load-bearing. The local schema is the house rule
      // (title + description, neither of which Starlight itself requires); the
      // built-in is the platform contract the site actually runs on, which
      // checks everything the house schema leaves unconstrained —
      // `sidebar.order`, `template`, a `badge` object's `text`.
    ).toEqual([
      "./docs/doc-frontmatter.schema.json",
      "astro:starlight:0.41",
    ]);
    // A file outside the collection is a member of nothing, so the override
    // cannot reach it and DEFAULT_SCHEMAS stands.
    expect(
      resolveSchemaSet({ filePath: "test/fixtures/valid.md", config }),
    ).toEqual([...DEFAULT_SCHEMAS]);
  });
});

describe("overrides[].files accepts a list of globs", () => {
  const withFiles = (files: string) =>
    ["overrides:", `  - files: ${files}`, "    schemas: [google:okf:0.1]", ""].join(
      "\n",
    );

  it("parses a list and keeps it as written", () => {
    const cfg = parseConfig(
      withFiles('[".claude/skills/*/SKILL.md", ".claude/agents/*.md"]'),
      "docmeta.config.yaml",
    );
    expect(cfg.overrides?.[0]?.files).toEqual([
      ".claude/skills/*/SKILL.md",
      ".claude/agents/*.md",
    ]);
  });

  it("still parses the single-string form unchanged", () => {
    const cfg = parseConfig(withFiles('"docs/**/*.md"'), "docmeta.config.yaml");
    expect(cfg.overrides?.[0]?.files).toBe("docs/**/*.md");
  });

  // The same false-green the `schemas`/`elements` no-effect refusal exists to
  // end: a rule that reads as configured and matches nothing.
  it("refuses an empty list", () => {
    expect(() => parseConfig(withFiles("[]"), "c.yaml")).toThrow(
      /overrides\[0\]\.files is an empty list/,
    );
  });

  it("refuses a blank glob in either shape", () => {
    expect(() => parseConfig(withFiles('""'), "c.yaml")).toThrow(
      /overrides\[0\]\.files/,
    );
    expect(() => parseConfig(withFiles('["docs/**", "  "]'), "c.yaml")).toThrow(
      /overrides\[0\]\.files\[1\]/,
    );
  });

  it("refuses a non-string element, naming the index", () => {
    expect(() => parseConfig(withFiles('["docs/**", 3]'), "c.yaml")).toThrow(
      /overrides\[0\]\.files\[1\]/,
    );
  });

  // The path a user actually takes: YAML in, schema set out. Both halves of
  // the feature have to line up — a parser that accepts the list and a
  // resolver that matches on every entry — and each unit test above covers
  // only one of them.
  it("resolves through a parsed list-form override", () => {
    const cfg = parseConfig(
      [
        "schemas: [google:okf:0.1]",
        "overrides:",
        "  - files:",
        '      - ".claude/skills/*/SKILL.md"',
        '      - ".claude/agents/*.md"',
        "    schemas: [agentskills:skill:1.0]",
        "",
      ].join("\n"),
      "docmeta.config.yaml",
    );
    for (const p of [".claude/skills/demo/SKILL.md", ".claude/agents/rev.md"]) {
      expect(resolveSchemaSet({ filePath: p, config: cfg })).toEqual([
        "agentskills:skill:1.0",
      ]);
    }
    expect(resolveSchemaSet({ filePath: "docs/guide.md", config: cfg })).toEqual([
      "google:okf:0.1",
    ]);
  });

  it("names both accepted shapes when the value is neither", () => {
    expect(() => parseConfig(withFiles("3"), "c.yaml")).toThrow(
      /must be a glob string or a list of glob strings/,
    );
  });
});

/**
 * The four keys proposal 0041 moved out of `meta:`.
 *
 * Refused rather than aliased, and the message names the new location: an alias
 * is a permanent second surface for the one concept `collections:` exists to
 * declare exactly once. Each is asserted in **both** spellings of a config —
 * wrapped under `meta:` in a family file, and unwrapped in a legacy
 * `docmeta.config.yaml` — because a user of the old per-tool file is precisely
 * the person who needs to be told where the key went, and because the section
 * wrapper rewrites `"paths"` into `"meta.paths"` for every *other* message.
 * These four name `meta` in their own prose, so that rewrite would make each
 * one contradict itself.
 */
describe("config: moved keys are refused (0041)", () => {
  /** The same document, once wrapped under `meta:` and once bare. */
  const bothForms = (lines: string[]): (() => unknown)[] => [
    () =>
      parseConfigValue(
        parseYaml(lines.join("\n")),
        "manni.config.yaml",
        "meta",
      ),
    () => parseConfig(lines.join("\n"), "docmeta.config.yaml"),
  ];

  it('refuses "paths", naming the top-level collections: list', () => {
    for (const parse of bothForms(["paths:", "  - 'docs/**/*.md'"])) {
      expect(parse).toThrow(DocmetaError);
      expect(parse).toThrow(
        '"paths" is no longer a meta key. Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections',
      );
    }
  });

  it('refuses "exclude" with the same message', () => {
    for (const parse of bothForms(["exclude:", "  - '**/drafts/**'"])) {
      expect(parse).toThrow(
        '"exclude" is no longer a meta key. Document sets are declared once for every tool, under a top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections',
      );
    }
  });

  it('refuses "sidecars", naming externalMetadata on a collection', () => {
    for (const parse of bothForms([
      "sidecars:",
      "  - file: ./docs-meta.yaml",
      "    keys: [source]",
    ])) {
      expect(parse).toThrow(
        '"sidecars" is no longer a meta key. It is externalMetadata on a collection, under the top-level collections: list. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#external-metadata',
      );
    }
  });

  it('refuses overrides[].name, naming the offending entry', () => {
    for (const parse of bothForms([
      "overrides:",
      "  - files: 'a/**'",
      "    schemas: [google:okf:0.1]",
      "  - name: authors",
      "    files: 'authors/**'",
      "    schemas: [google:okf:0.1]",
    ])) {
      expect(parse).toThrow(
        'overrides[1] no longer carries "name". Define a collection with that name and point the override at it with collection:.',
      );
    }
  });

  // The moved-key check runs before the unknown-key check, so the message is
  // the migration note rather than `has unknown key "paths"` — which would be
  // true and useless, since the user did not misspell anything.
  it("beats the unknown-key refusal, which would blame a typo", () => {
    expect(() => parseConfig("paths: ['a.md']\n", "c.yaml")).toThrow(
      /no longer a meta key/,
    );
    expect(() => parseConfig("paths: ['a.md']\n", "c.yaml")).not.toThrow(
      /unknown key/,
    );
  });

  // The prefix is the file, as in every other config message, and the sentence
  // that follows says `meta` itself. `withSection` must not touch it.
  it("keeps the message intact under a discovered family file", () => {
    expect(() =>
      parseConfigValue({ paths: ["a.md"] }, "manni.config.yaml", "meta"),
    ).toThrow(/^manni\.config\.yaml: "paths" is no longer a meta key\./);
  });
});

/**
 * `overrides[].collection` (0041 rule 8), which replaces 0027's
 * `overrides[].name` with its inverse: a collection is the thing that has a
 * name, and an override points at one. An entry carries exactly one of `files:`
 * or `collection:`, because both would need a rule for how they combine and
 * neither is a rule that governs nothing.
 */
describe("overrides[].collection (0041)", () => {
  /** One `overrides:` entry, its lines indented under the key. */
  const override = (lines: string[]): string =>
    ["overrides:", ...lines.map((l) => `  ${l}`), ""].join("\n");

  it("parses a collection override", () => {
    const cfg = parseConfig(
      override(["- collection: guides", "  schemas: [google:okf:0.1]"]),
      "manni.config.yaml",
    );
    expect(cfg.overrides?.[0]?.collection).toBe("guides");
    expect(cfg.overrides?.[0]?.files).toBeUndefined();
  });

  it("refuses an entry carrying neither files nor collection", () => {
    expect(() =>
      parseConfig(override(["- schemas: [google:okf:0.1]"]), "c.yaml"),
    ).toThrow('overrides[0] must carry exactly one of "files" or "collection".');
  });

  it("refuses an entry carrying both", () => {
    expect(() =>
      parseConfig(
        override([
          "- collection: guides",
          '  files: "guides/**"',
          "  schemas: [google:okf:0.1]",
        ]),
        "c.yaml",
      ),
    ).toThrow('overrides[0] must carry exactly one of "files" or "collection".');
  });

  it("refuses a collection that is not a non-empty string", () => {
    for (const value of ["3", '""', '"   "', "[guides]"]) {
      expect(() =>
        parseConfig(
          override([`- collection: ${value}`, "  schemas: [google:okf:0.1]"]),
          "c.yaml",
        ),
      ).toThrow(
        "overrides[0].collection must be a non-empty string naming a collection.",
      );
    }
  });

  // Still refused, and still by index: the override governs nothing whether it
  // names globs or a collection.
  it("still refuses an override that sets neither schemas nor elements", () => {
    expect(() =>
      parseConfig(override(["- collection: guides"]), "c.yaml"),
    ).toThrow(/overrides\[0\] sets neither "schemas" nor "elements"/);
  });
});

/**
 * Whether a `collection:` names a *declared* collection can only be answered
 * once both halves of the family file are parsed — `collections:` is a
 * top-level key the section parser never sees — so the refusal comes from
 * `loadConfig`. It still names `overrides[i].collection` as its path, so it
 * reads like every other config error.
 */
describe("overrides[].collection must name a declared collection (0041)", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function repo(config: string): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "docmeta-coll-ovr-")));
    await writeFile(join(tmp, "manni.config.yaml"), config, "utf8");
    return tmp;
  }

  it("accepts a name the list defines, and resolves through it", async () => {
    const root = await repo(
      [
        "collections:",
        "  - name: guides",
        '    paths: ["docs/guides/**/*.md"]',
        "meta:",
        "  overrides:",
        "    - collection: guides",
        "      schemas: [google:okf:0.1]",
        "",
      ].join("\n"),
    );
    const loaded = await loadConfig(undefined, root);
    expect(loaded?.collections.map((c) => c.name)).toEqual(["guides"]);
    // Membership is what a `collection:` override matches on, so resolution
    // needs the member list the command cores compute per file.
    expect(
      resolveSchemaSet({
        filePath: "docs/guides/auth.md",
        config: loaded?.config,
        memberOf: ["guides"],
      }),
    ).toEqual(["google:okf:0.1"]);
    // A file in no collection cannot reach it, however its path reads.
    expect(
      resolveSchemaSet({
        filePath: "docs/guides/auth.md",
        config: loaded?.config,
      }),
    ).toEqual([...DEFAULT_SCHEMAS]);
  });

  it("refuses an undefined name and lists the ones that are defined", async () => {
    const root = await repo(
      [
        "collections:",
        "  - name: guides",
        '    paths: ["docs/guides/**/*.md"]',
        "  - name: blog",
        '    paths: ["blog/**/*.md"]',
        "meta:",
        "  overrides:",
        "    - collection: gides",
        "      schemas: [google:okf:0.1]",
        "",
      ].join("\n"),
    );
    await expect(loadConfig(undefined, root)).rejects.toThrow(
      'manni.config.yaml: overrides[0].collection names "gides", which collections: does not define. Defined: guides, blog.',
    );
  });

  // A config with an override pointing at a collection and no `collections:`
  // at all is the mid-migration shape, so the tail has to say "(none)" rather
  // than trail off after "Defined:".
  it("says (none) when the file declares no collections", async () => {
    const root = await repo(
      [
        "meta:",
        "  overrides:",
        "    - collection: guides",
        "      schemas: [google:okf:0.1]",
        "",
      ].join("\n"),
    );
    await expect(loadConfig(undefined, root)).rejects.toThrow(
      'manni.config.yaml: overrides[0].collection names "guides", which collections: does not define. Defined: (none).',
    );
  });
});

/**
 * `resolveRunConfig` with no positional paths: the run is every collection, in
 * declaration order, measured from the config file's directory. That is today's
 * `paths:` fallback with a list where there was one entry (0041 rule 2).
 */
describe("resolveRunConfig: collections (0041)", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  const TWO = [
    "collections:",
    "  - name: guides",
    '    paths: ["docs/guides/**/*.md"]',
    "  - name: blog",
    '    paths: ["blog/**/*.md", "blog/**/*.mdx"]',
    "meta:",
    "  schemas: [google:okf:0.1]",
    "",
  ].join("\n");

  async function repo(config = TWO): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "docmeta-run-coll-")));
    await writeFile(join(tmp, "manni.config.yaml"), config, "utf8");
    return tmp;
  }

  it("reads every collection, in declaration order, from the config's dir", async () => {
    const root = await repo();
    const run = await resolveRunConfig({ cwd: root, inputs: [] });
    expect(run.inputs).toEqual([
      "docs/guides/**/*.md",
      "blog/**/*.md",
      "blog/**/*.mdx",
    ]);
    expect(run.base).toBe(root);
    expect(run.collections.map((c) => c.name)).toEqual(["guides", "blog"]);
    expect(run.fromCollections).toBe(true);
  });

  it("narrows to the named collections, still in declaration order", async () => {
    const root = await repo();
    const run = await resolveRunConfig({
      cwd: root,
      inputs: [],
      // Named out of order on purpose: the run order is the config's, not the
      // command line's, so two invocations of one CI job cannot differ.
      collections: ["blog", "guides"],
    });
    expect(run.collections.map((c) => c.name)).toEqual(["guides", "blog"]);
    expect(run.inputs[0]).toBe("docs/guides/**/*.md");
  });

  it("refuses a name no collection carries, listing the ones configured", async () => {
    const root = await repo();
    await expect(
      resolveRunConfig({ cwd: root, inputs: [], collections: ["gides"] }),
    ).rejects.toThrow(
      'no collection named "gides" in manni.config.yaml. Configured: guides, blog.',
    );
  });

  it("lets positional paths win, and says so with fromCollections", async () => {
    const root = await repo();
    const run = await resolveRunConfig({
      cwd: root,
      inputs: ["README.md"],
    });
    expect(run.inputs).toEqual(["README.md"]);
    expect(run.fromCollections).toBe(false);
    // Still selected: a file the operator typed is a member of whatever
    // collections contain it, so its manifests have to be loadable (rule 4).
    expect(run.collections.map((c) => c.name)).toEqual(["guides", "blog"]);
  });

  it("refuses --collection beside a path", async () => {
    const root = await repo();
    await expect(
      resolveRunConfig({
        cwd: root,
        inputs: ["docs/x.md"],
        collections: ["guides"],
      }),
    ).rejects.toThrow(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  });

  it("refuses --collection with no config to select from", async () => {
    const root = await repo();
    await expect(
      resolveRunConfig({
        cwd: root,
        inputs: [],
        noConfig: true,
        collections: ["guides"],
      }),
    ).rejects.toThrow("--collection needs a config file to select from.");
  });

  // Stdin is not a path, so it says nothing about which collections the run
  // covers: it is the one input allowed beside the flag, and the collections
  // are still selected so their manifests are available to the merge.
  it("allows stdin beside --collection", async () => {
    const root = await repo();
    const run = await resolveRunConfig({
      cwd: root,
      inputs: ["-"],
      collections: ["guides"],
    });
    expect(run.inputs).toEqual(["-"]);
    expect(run.collections.map((c) => c.name)).toEqual(["guides"]);
    expect(run.fromCollections).toBe(false);
  });

  // 0014, one level up from an empty glob: a config that declares no documents
  // hands the command an empty input list, and the command's own "No files to
  // …" refusal is what the user sees.
  it("hands back no inputs when the file declares no collections", async () => {
    const root = await repo("meta:\n  schemas: [google:okf:0.1]\n");
    const run = await resolveRunConfig({ cwd: root, inputs: [] });
    expect(run.inputs).toEqual([]);
    expect(run.collections).toEqual([]);
  });
});
