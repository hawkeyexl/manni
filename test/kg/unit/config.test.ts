import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../../../src/kg/core/config.js";
import { KgError } from "../../../src/kg/types.js";

describe("parseConfig", () => {
  it("applies defaults for a minimal config", () => {
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.baseIri).toBe("urn:manni:kg:");
    // No document set of its own: `inputs` and `exclude` are the family's
    // `collections:` now (proposal 0041, 0051 §1), and a section on its own
    // declares none.
    expect(c.collections).toEqual([]);
    expect(c.out).toBe("kg/graph.ttl");
    expect(c.build.derive).toEqual([
      "frontmatter",
      "sections",
      "links",
      "tags",
      "images",
      "code",
      "provenance",
    ]);
    // empty = use the page vocabulary bundled with manni
    expect(c.schemas).toEqual([]);
    // empty = use the shapes bundled with manni (shapes/kg/shapes-1.0.0.ttl)
    expect(c.check.shapes).toEqual([]);
    expect(c.fill.validateGraph).toBe(true);
    // Opinionated defaults (ADR 01009/01010), minus the switch 0051 §6
    // removed: git history is detected, so `qualified` is all that is left to
    // configure.
    expect(c.provenance).toEqual({ qualified: true });
    expect(c.fill.writeProvenance).toBe(true);
    // No provider is named by default: `auto` detects one, and a default that
    // names a vendor fails for everyone without that vendor's key (0051 §3).
    expect(c.provider).toBeNull();
    expect(c.model).toBeNull();
    expect(c.providers).toEqual({});
    expect(c.fill.temperature).toBe(0);
    // Turns, not dollars. Unset is unbounded (0051 §3, docevals ADR 01019).
    expect(c.fill.maxTurns).toBeNull();
    expect(c.fill.cacheDir).toBe(".manni/kg/cache");
    // Fill proposes every field now; confidence gates what is written (ADR 01015).
    expect(c.fill.fields).toEqual([
      "label",
      "alt-labels",
      "broader",
      "narrower",
      "related-concepts",
      "concepts",
      "type",
      "applies-to",
      "about-product-lifecycle",
      "about-product-aspect",
      "not-applicable-to",
      "not-about-product-aspect",
    ]);
    expect(c.fill.confidenceThreshold).toBe(0.7);
    // Local embeddings default to granite, configurable (ADR 01020).
    expect(c.embed.model).toContain("granite-embedding-small-english-r2");
    expect(c.embed.dtype).toBe("q8");
    // A directory since the per-locale fan-out (ADR 01038): one sidecar per
    // language lands in it, named by its tag.
    expect(c.embed.out).toBe("kg");
    expect(c.embed.byLanguage).toEqual({});
    expect(c.embed.cacheDir).toBe(".manni/kg/embed-cache");
    // iiRDS export defaults: version 1.3, no title/creator (ADR 01017).
    expect(c.export.iirds).toEqual({
      title: undefined,
      creator: undefined,
      version: "1.3",
    });
  });

  it("reads schemas at the section's top level", () => {
    const c = parseConfig(
      'schemas: ["./house.schema.json"]\n',
      "/tmp/manni.config.yaml",
    );
    expect(c.schemas).toEqual(["./house.schema.json"]);
  });

  it("refuses the old validate: wrapper by name", () => {
    // The key was named for `kg validate`, which 0051 §8 removed. Nothing was
    // published under it, so the old spelling is an unknown key rather than a
    // migration (0048 §4) — and the message names it, as every other removed
    // kg key's does.
    const parse = (): unknown =>
      parseConfig(
        'validate:\n  schemas: ["./house.schema.json"]\n',
        "/tmp/manni.config.yaml",
      );
    expect(parse).toThrow(KgError);
    expect(parse).toThrow('/kg: unknown key "validate"');
  });

  it("parses embed overrides and accepts any model id", () => {
    // `model` is an open string, not an enum: the documented table is the
    // tested set, not the permitted set, so a newer model needs no release.
    const c = parseConfig(
      "embed:\n  model: some/brand-new-model\n  dtype: fp32\n  out: v\n  cacheDir: .c\n  byLanguage:\n    de:\n      model: some/german-model\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.embed).toEqual({
      model: "some/brand-new-model",
      dtype: "fp32",
      out: "v",
      cacheDir: ".c",
      byLanguage: { de: { model: "some/german-model" } },
    });
  });

  it("rejects a byLanguage key that is not a language tag", () => {
    // patternProperties plus additionalProperties: false — a language-keyed map
    // still fails loudly on a key nobody meant, like every other config object.
    expect(() =>
      parseConfig(
        "embed:\n  byLanguage:\n    German:\n      model: x\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(/byLanguage/);
  });

  it("rejects an unknown key inside a byLanguage entry", () => {
    expect(
      () =>
        parseConfig(
          "embed:\n  byLanguage:\n    de:\n      bogus: 1\n",
          "/tmp/manni.config.yaml",
        ),
      // The path, which is what Ajv names here — and the part that locates the
      // mistake: `de` is a legal key, `bogus` inside it is not.
    ).toThrow(/\/embed\/byLanguage\/de/);
  });

  it("rejects unknown embed keys", () => {
    expect(() =>
      parseConfig(
        "embed:\n  bogus: true\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
  });

  it("parses export.iirds overrides", () => {
    const c = parseConfig(
      "export:\n  iirds:\n    title: My Docs\n    creator: Acme\n    version: '1.2'\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.export.iirds).toEqual({
      title: "My Docs",
      creator: "Acme",
      version: "1.2",
    });
  });

  it("rejects an unknown export.iirds version and unknown keys", () => {
    expect(() =>
      parseConfig(
        "export:\n  iirds:\n    version: '2.0'\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
    expect(() =>
      parseConfig(
        "export:\n  iirds:\n    bogus: true\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
  });

  it("normalizes baseIri with a trailing slash", () => {
    const c = parseConfig(
      "baseIri: https://example.com/kg\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.baseIri).toBe("https://example.com/kg/");
  });

  // The hard break to docmeta:kg renamed the config vocabulary too (ADR
  // 01023). Failing loudly on the old spellings is the whole point, so pin it
  // here rather than trusting the enum to stay narrow.
  it("rejects a stale camelCase fill.fields value", () => {
    expect(() =>
      parseConfig(
        "fill:\n  fields: [prefLabel]\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
    expect(() =>
      parseConfig(
        "fill:\n  fields: [softwareSubject]\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
  });

  it("rejects a stale camelCase coverageThreshold key", () => {
    expect(() =>
      parseConfig(
        "stats:\n  coverageThreshold:\n    prefLabel: 80\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseConfig("bogus: true\n", "/tmp/manni.config.yaml"),
    ).toThrow(KgError);
  });

  it("rejects a wrong version", () => {
    expect(() => parseConfig("version: 2\n", "/tmp/manni.config.yaml")).toThrow(
      KgError,
    );
  });

  it("rejects invalid YAML", () => {
    expect(() =>
      parseConfig("version: [1\n", "/tmp/manni.config.yaml"),
    ).toThrow(KgError);
  });

  it("parses check.shapes and fill.validateGraph overrides", () => {
    const c = parseConfig(
      "check:\n  shapes: [my-shapes.ttl]\nfill:\n  validateGraph: false\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.check.shapes).toEqual(["my-shapes.ttl"]);
    expect(c.fill.validateGraph).toBe(false);
  });

  it("rejects unknown check keys", () => {
    expect(() =>
      parseConfig(
        "check:\n  bogus: true\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
  });

  it("rejects an unknown kg.provider, with the family's message", () => {
    expect(() =>
      parseConfig("provider: gemini\n", "/tmp/manni.config.yaml"),
    ).toThrow(KgError);
    expect(() =>
      parseConfig("provider: gemini\n", "/tmp/manni.config.yaml"),
    ).toThrow(
      'Unknown provider "gemini". Available: anthropic, openai, claude-cli, llama-cpp, auto.',
    );
  });

  it("accepts the local llama-cpp provider at the section level", () => {
    const c = parseConfig(
      "provider: llama-cpp\nmodel: granite-4.1-3b-q2\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.provider).toBe("llama-cpp");
    expect(c.model).toBe("granite-4.1-3b-q2");
  });

  it("reads the family providers: map beside its own section", () => {
    const c = parseConfig(
      "providers:\n  provider: openai\n  openai:\n    baseUrl: http://localhost:11434/v1\nkg:\n  out: g.ttl\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.providers.provider).toBe("openai");
    expect(c.providers.openai?.baseUrl).toBe("http://localhost:11434/v1");
  });

  // Connection settings are declared once, for every tool, in the family's
  // top-level `providers:` map (0051 §3). The keys that used to carry them
  // under `kg.fill` are unknown keys now, and the message names each one
  // rather than saying the object "must NOT have additional properties".
  it.each([
    ["provider", "provider: openai"],
    ["model", "model: some-model"],
    ["apiKeyEnv", "apiKeyEnv: MY_KEY"],
    ["baseUrl", "baseUrl: http://localhost:11434/v1"],
    ["command", "command: my-claude"],
    ["maxCostUsd", "maxCostUsd: 5"],
    ["pricing", "pricing:\n    inputPerMTok: 1\n    outputPerMTok: 2"],
    ["minConfidence", "minConfidence: 0.5"],
  ])("refuses the removed fill.%s by name", (key, yaml) => {
    const parse = (): unknown =>
      parseConfig(`fill:\n  ${yaml}\n`, "/tmp/manni.config.yaml");
    expect(parse).toThrow(KgError);
    expect(parse).toThrow(`/kg/fill: unknown key "${key}"`);
  });

  it("accepts fill.maxTurns and fill.confidenceThreshold", () => {
    const c = parseConfig(
      "fill:\n  maxTurns: 3\n  confidenceThreshold: 0.5\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.fill.maxTurns).toBe(3);
    expect(c.fill.confidenceThreshold).toBe(0.5);
  });

  it("rejects a fill.maxTurns below one", () => {
    expect(() =>
      parseConfig("fill:\n  maxTurns: 0\n", "/tmp/manni.config.yaml"),
    ).toThrow(KgError);
  });

  it("defaults fill.sections to off", () => {
    // Opt-in by design (ADR 01032): more output per document, and section
    // metadata carries the same review obligation as anything else a model
    // writes. ADR 01009's default-on rule covers hermetic features; this is
    // neither hermetic nor free.
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.fill.sections).toBe(false);
  });

  it("accepts fill.sections: true", () => {
    const c = parseConfig(
      "fill:\n  sections: true\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.fill.sections).toBe(true);
  });

  it("rejects a non-boolean fill.sections", () => {
    // additionalProperties is false everywhere and every knob is typed, so a
    // truthy-looking string must fail loudly rather than silently enable it.
    expect(() =>
      parseConfig(
        "fill:\n  sections: yes-please\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
  });

  it("parses route mappings with defaults and normalization", () => {
    const c = parseConfig(
      "routes:\n  - basePath: /docs/\n    root: docs/pages/\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.routes).toEqual([
      {
        basePath: "/docs",
        root: "docs/pages",
        extensions: [".md", ".mdx"],
        indexFiles: ["index", "README"],
      },
    ]);
  });

  it("parses a route language and leaves the key absent when unset", () => {
    // ADR 01037: a route may label every document under its root. Absent, the
    // key is not present at all, so `routeLanguage` on a DocModel means
    // something rather than being an undefined nobody set.
    const c = parseConfig(
      "routes:\n  - root: docs/de\n    basePath: /de\n    language: de-AT\n  - root: docs\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.routes[0]?.language).toBe("de-AT");
    expect(c.routes[1]).not.toHaveProperty("language");
  });

  it.each(["English", "de_DE", "d", "de-"])(
    "rejects the route language %s at the config layer",
    (language) => {
      // The BCP-47 pattern is enforced in three places (config schema, shapes,
      // LANGUAGE_TAG). This is the config one: a bad tag must fail at load,
      // long before it reaches the graph or becomes a filename.
      expect(() =>
        parseConfig(
          `routes:\n  - root: docs\n    language: ${language}\n`,
          "/tmp/manni.config.yaml",
        ),
      ).toThrow(/routes/);
    },
  );

  it.each(["de", "en", "de-DE", "pt-BR", "zh-Hans", "zh-Hans-CN", "und"])(
    "accepts the route language %s",
    (language) => {
      const c = parseConfig(
        `routes:\n  - root: docs\n    language: ${language}\n`,
        "/tmp/manni.config.yaml",
      );
      expect(c.routes[0]?.language).toBe(language);
    },
  );

  it("defaults routes to an empty list and requires root per mapping", () => {
    expect(parseConfig("", "/tmp/c.yaml").routes).toEqual([]);
    expect(() =>
      parseConfig("routes:\n  - basePath: /docs\n", "/tmp/c.yaml"),
    ).toThrow(KgError);
  });

  it("parses fill.writeProvenance overrides", () => {
    const c = parseConfig(
      "fill:\n  writeProvenance: false\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.fill.writeProvenance).toBe(false);
  });

  it("parses provenance.qualified and rejects the retired git and gitTime keys", () => {
    const c = parseConfig(
      "provenance:\n  qualified: false\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.provenance).toEqual({ qualified: false });
    // `git` was tri-state until 0051 §6 detected it instead. Nothing was
    // published under it, so it is an unknown key rather than a migration.
    for (const key of ["git", "gitTime"]) {
      expect(() =>
        parseConfig(
          `provenance:\n  ${key}: true\n`,
          "/tmp/manni.config.yaml",
        ),
      ).toThrow(KgError);
    }
  });

  it("defaults stats.coverageThreshold to an empty (ungated) map", () => {
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.stats.coverageThreshold).toEqual({});
  });

  it("expands a uniform coverage threshold across every measured field", () => {
    const c = parseConfig(
      "stats:\n  coverageThreshold: 80\n",
      "/tmp/manni.config.yaml",
    );
    // Every measured field gated at the same value — including the iiRDS
    // typing added in Phases 2-4 (ADR 01029). Growing the fixed list means a
    // uniform shorthand starts gating the new fields, which is the ratchet.
    expect(c.stats.coverageThreshold.title).toBe(80);
    expect(Object.keys(c.stats.coverageThreshold).sort()).toEqual([
      "about-product-aspect",
      "about-product-lifecycle",
      "applies-to",
      "created",
      "creator",
      "description",
      "label",
      "language",
      "modified",
      "subject",
      "title",
      "type",
    ]);
  });

  it("parses a per-field coverage threshold map and leaves others ungated", () => {
    const c = parseConfig(
      "stats:\n  coverageThreshold:\n    title: 100\n    description: 50\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.stats.coverageThreshold).toEqual({ title: 100, description: 50 });
  });

  it("rejects out-of-range and unknown coverage threshold fields", () => {
    for (const bad of [
      "stats:\n  coverageThreshold: 101\n",
      "stats:\n  coverageThreshold: -1\n",
      "stats:\n  coverageThreshold:\n    bogus: 50\n",
      "stats:\n  coverageThreshold:\n    title: 101\n",
    ]) {
      expect(() => parseConfig(bad, "/tmp/manni.config.yaml")).toThrow(KgError);
    }
  });

  it("refuses every spelling the tri-state provenance.git took", () => {
    // kg ADR 01010's `"auto" | true | false`, removed by 0051 §6. None of the
    // three is a key any more, so each is refused by Ajv rather than read.
    for (const mode of ["auto", true, false] as const) {
      expect(() =>
        parseConfig(
          `provenance:\n  git: ${JSON.stringify(mode)}\n`,
          "/tmp/manni.config.yaml",
        ),
      ).toThrow(KgError);
    }
  });

  it("rejects an unknown derive source", () => {
    expect(() =>
      parseConfig(
        "build:\n  derive: [frontmatter, telepathy]\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(KgError);
  });
});

describe("loadConfig", () => {
  it("falls back to defaults when no config file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-config-"));
    const c = loadConfig(undefined, dir);
    expect(c.baseIri).toBe("urn:manni:kg:");
  });

  it("loads the kg: section of manni.config.yaml from cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-config-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      "meta:\n  paths: [docs]\nkg:\n  out: graph.ttl\n",
    );
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("graph.ttl");
    expect(c.configSource).toBe("manni.config.yaml");
  });

  it("reads the family collections: beside its own section", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-config-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\nkg:\n  out: graph.ttl\n',
    );
    const c = loadConfig(undefined, dir);
    expect(c.collections.map((x) => x.name)).toEqual(["site"]);
  });

  it("treats an empty kg: section as the defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-config-"));
    writeFileSync(join(dir, "manni.config.yaml"), "meta:\n  paths: [docs]\nkg:\n");
    expect(loadConfig(undefined, dir).baseIri).toBe("urn:manni:kg:");
  });

  it("does not read the pre-family dockg.config.yaml", () => {
    // Nothing was ever published under that name, so it gets no alias and no
    // migration (0051 §2, copying 0048 §4). It is simply not a config file.
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-config-"));
    writeFileSync(join(dir, "dockg.config.yaml"), "out: graph.ttl\n");
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("kg/graph.ttl");
    expect(c.configSource).toBeNull();
  });

  it("reads an explicit path with or without the kg: wrapper", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-kg-config-"));
    writeFileSync(join(dir, "wrapped.yaml"), "kg:\n  out: a.ttl\n");
    writeFileSync(join(dir, "bare.yaml"), "out: b.ttl\n");
    expect(loadConfig("wrapped.yaml", dir).out).toBe("a.ttl");
    expect(loadConfig("bare.yaml", dir).out).toBe("b.ttl");
  });

  it("throws for an explicit missing path", () => {
    expect(() => loadConfig("Z:/nope/dockg.config.yaml")).toThrow(KgError);
  });
});
