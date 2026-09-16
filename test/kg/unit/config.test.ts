import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../../../src/kg/core/config.js";
import { DockgError } from "../../../src/kg/types.js";

describe("parseConfig", () => {
  it("applies defaults for a minimal config", () => {
    const c = parseConfig("version: 1\n", "/tmp/dockg.config.yaml");
    expect(c.baseIri).toBe("urn:dockg:");
    expect(c.inputs).toEqual(["**/*.md"]);
    expect(c.exclude).toEqual(["**/node_modules/**"]);
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
    // empty = use the schema bundled with dockg (schemas/frontmatter-0.5.json)
    expect(c.validate.schemas).toEqual([]);
    // empty = use the shapes bundled with dockg (shapes/dockg-0.2.ttl)
    expect(c.check.shapes).toEqual([]);
    expect(c.fill.validateGraph).toBe(true);
    // Opinionated defaults (ADR 01009/01010): hermetic provenance ships on;
    // "auto" runs git where it can and degrades with a warning where it can't.
    expect(c.provenance).toEqual({ git: "auto", qualified: true });
    expect(c.fill.writeProvenance).toBe(true);
    expect(c.fill.provider).toBe("anthropic");
    expect(c.fill.temperature).toBe(0);
    expect(c.fill.maxCostUsd).toBe(5);
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
    expect(c.fill.minConfidence).toBe(0.7);
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

  it("parses embed overrides and accepts any model id", () => {
    // `model` is an open string, not an enum: the documented table is the
    // tested set, not the permitted set, so a newer model needs no release.
    const c = parseConfig(
      "version: 1\nembed:\n  model: some/brand-new-model\n  dtype: fp32\n  out: v\n  cacheDir: .c\n  byLanguage:\n    de:\n      model: some/german-model\n",
      "/tmp/dockg.config.yaml",
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
        "version: 1\nembed:\n  byLanguage:\n    German:\n      model: x\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(/byLanguage/);
  });

  it("rejects an unknown key inside a byLanguage entry", () => {
    expect(
      () =>
        parseConfig(
          "version: 1\nembed:\n  byLanguage:\n    de:\n      bogus: 1\n",
          "/tmp/dockg.config.yaml",
        ),
      // The path, which is what Ajv names here — and the part that locates the
      // mistake: `de` is a legal key, `bogus` inside it is not.
    ).toThrow(/\/embed\/byLanguage\/de/);
  });

  it("rejects unknown embed keys", () => {
    expect(() =>
      parseConfig(
        "version: 1\nembed:\n  bogus: true\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("parses export.iirds overrides", () => {
    const c = parseConfig(
      "version: 1\nexport:\n  iirds:\n    title: My Docs\n    creator: Acme\n    version: '1.2'\n",
      "/tmp/dockg.config.yaml",
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
        "version: 1\nexport:\n  iirds:\n    version: '2.0'\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
    expect(() =>
      parseConfig(
        "version: 1\nexport:\n  iirds:\n    bogus: true\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("normalizes baseIri with a trailing slash", () => {
    const c = parseConfig(
      "version: 1\nbaseIri: https://example.com/kg\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.baseIri).toBe("https://example.com/kg/");
  });

  // The hard break to docmeta:kg renamed the config vocabulary too (ADR
  // 01023). Failing loudly on the old spellings is the whole point, so pin it
  // here rather than trusting the enum to stay narrow.
  it("rejects a stale camelCase fill.fields value", () => {
    expect(() =>
      parseConfig(
        "version: 1\nfill:\n  fields: [prefLabel]\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
    expect(() =>
      parseConfig(
        "version: 1\nfill:\n  fields: [softwareSubject]\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("rejects a stale camelCase coverageThreshold key", () => {
    expect(() =>
      parseConfig(
        "version: 1\nstats:\n  coverageThreshold:\n    prefLabel: 80\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseConfig("version: 1\nbogus: true\n", "/tmp/dockg.config.yaml"),
    ).toThrow(DockgError);
  });

  it("rejects a wrong version", () => {
    expect(() => parseConfig("version: 2\n", "/tmp/dockg.config.yaml")).toThrow(
      DockgError,
    );
  });

  it("rejects invalid YAML", () => {
    expect(() =>
      parseConfig("version: [1\n", "/tmp/dockg.config.yaml"),
    ).toThrow(DockgError);
  });

  it("parses check.shapes and fill.validateGraph overrides", () => {
    const c = parseConfig(
      "version: 1\ncheck:\n  shapes: [my-shapes.ttl]\nfill:\n  validateGraph: false\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.check.shapes).toEqual(["my-shapes.ttl"]);
    expect(c.fill.validateGraph).toBe(false);
  });

  it("rejects unknown check keys", () => {
    expect(() =>
      parseConfig(
        "version: 1\ncheck:\n  bogus: true\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("rejects an unknown fill provider", () => {
    expect(() =>
      parseConfig(
        "version: 1\nfill:\n  provider: gemini\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("accepts the local llama-cpp provider", () => {
    const c = parseConfig(
      "version: 1\nfill:\n  provider: llama-cpp\n  model: granite-4.1-3b-q2\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.fill.provider).toBe("llama-cpp");
    expect(c.fill.model).toBe("granite-4.1-3b-q2");
  });

  it("defaults fill.sections to off", () => {
    // Opt-in by design (ADR 01032): more output per document, and section
    // metadata carries the same review obligation as anything else a model
    // writes. ADR 01009's default-on rule covers hermetic features; this is
    // neither hermetic nor free.
    const c = parseConfig("version: 1\n", "/tmp/dockg.config.yaml");
    expect(c.fill.sections).toBe(false);
  });

  it("accepts fill.sections: true", () => {
    const c = parseConfig(
      "version: 1\nfill:\n  sections: true\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.fill.sections).toBe(true);
  });

  it("rejects a non-boolean fill.sections", () => {
    // additionalProperties is false everywhere and every knob is typed, so a
    // truthy-looking string must fail loudly rather than silently enable it.
    expect(() =>
      parseConfig(
        "version: 1\nfill:\n  sections: yes-please\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("parses route mappings with defaults and normalization", () => {
    const c = parseConfig(
      "version: 1\nroutes:\n  - basePath: /docs/\n    root: docs/pages/\n",
      "/tmp/dockg.config.yaml",
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
      "version: 1\nroutes:\n  - root: docs/de\n    basePath: /de\n    language: de-AT\n  - root: docs\n",
      "/tmp/dockg.config.yaml",
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
          `version: 1\nroutes:\n  - root: docs\n    language: ${language}\n`,
          "/tmp/dockg.config.yaml",
        ),
      ).toThrow(/routes/);
    },
  );

  it.each(["de", "en", "de-DE", "pt-BR", "zh-Hans", "zh-Hans-CN", "und"])(
    "accepts the route language %s",
    (language) => {
      const c = parseConfig(
        `version: 1\nroutes:\n  - root: docs\n    language: ${language}\n`,
        "/tmp/dockg.config.yaml",
      );
      expect(c.routes[0]?.language).toBe(language);
    },
  );

  it("defaults routes to an empty list and requires root per mapping", () => {
    expect(parseConfig("version: 1\n", "/tmp/c.yaml").routes).toEqual([]);
    expect(() =>
      parseConfig("version: 1\nroutes:\n  - basePath: /docs\n", "/tmp/c.yaml"),
    ).toThrow(DockgError);
  });

  it("parses fill.writeProvenance overrides", () => {
    const c = parseConfig(
      "version: 1\nfill:\n  writeProvenance: false\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.fill.writeProvenance).toBe(false);
  });

  it("parses provenance flags and rejects the retired gitTime key", () => {
    const c = parseConfig(
      "version: 1\nprovenance:\n  git: true\n  qualified: true\n",
      "/tmp/dockg.config.yaml",
    );
    expect(c.provenance).toEqual({ git: true, qualified: true });
    expect(() =>
      parseConfig(
        "version: 1\nprovenance:\n  gitTime: true\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("defaults stats.coverageThreshold to an empty (ungated) map", () => {
    const c = parseConfig("version: 1\n", "/tmp/dockg.config.yaml");
    expect(c.stats.coverageThreshold).toEqual({});
  });

  it("expands a uniform coverage threshold across every measured field", () => {
    const c = parseConfig(
      "version: 1\nstats:\n  coverageThreshold: 80\n",
      "/tmp/dockg.config.yaml",
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
      "version: 1\nstats:\n  coverageThreshold:\n    title: 100\n    description: 50\n",
      "/tmp/dockg.config.yaml",
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
      expect(() =>
        parseConfig(`version: 1\n${bad}`, "/tmp/dockg.config.yaml"),
      ).toThrow(DockgError);
    }
  });

  it("parses all three provenance.git modes and rejects other strings", () => {
    for (const mode of ["auto", true, false] as const) {
      const c = parseConfig(
        `version: 1\nprovenance:\n  git: ${JSON.stringify(mode)}\n`,
        "/tmp/dockg.config.yaml",
      );
      expect(c.provenance.git).toBe(mode);
    }
    expect(() =>
      parseConfig(
        "version: 1\nprovenance:\n  git: maybe\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });

  it("rejects an unknown derive source", () => {
    expect(() =>
      parseConfig(
        "version: 1\nbuild:\n  derive: [frontmatter, telepathy]\n",
        "/tmp/dockg.config.yaml",
      ),
    ).toThrow(DockgError);
  });
});

describe("loadConfig", () => {
  it("falls back to defaults when no config file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-config-"));
    const c = loadConfig(undefined, dir);
    expect(c.baseIri).toBe("urn:dockg:");
  });

  it("loads the kg: section of manni.config.yaml from cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-config-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      "meta:\n  paths: [docs]\nkg:\n  version: 1\n  out: graph.ttl\n",
    );
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("graph.ttl");
  });

  it("treats an empty kg: section as the defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-config-"));
    writeFileSync(join(dir, "manni.config.yaml"), "meta:\n  paths: [docs]\nkg:\n");
    expect(loadConfig(undefined, dir).baseIri).toBe("urn:dockg:");
  });

  it("still reads the pre-family dockg.config.yaml whole", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-config-"));
    writeFileSync(join(dir, "dockg.config.yaml"), "version: 1\nout: graph.ttl\n");
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("graph.ttl");
  });

  it("reads an explicit path with or without the kg: wrapper", () => {
    const dir = mkdtempSync(join(tmpdir(), "dockg-config-"));
    writeFileSync(join(dir, "wrapped.yaml"), "kg:\n  version: 1\n  out: a.ttl\n");
    writeFileSync(join(dir, "bare.yaml"), "version: 1\nout: b.ttl\n");
    expect(loadConfig("wrapped.yaml", dir).out).toBe("a.ttl");
    expect(loadConfig("bare.yaml", dir).out).toBe("b.ttl");
  });

  it("throws for an explicit missing path", () => {
    expect(() => loadConfig("Z:/nope/dockg.config.yaml")).toThrow(DockgError);
  });
});
