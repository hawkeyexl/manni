import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseConfig } from "../../../src/graph/core/config.js";
import { GraphError } from "../../../src/graph/types.js";

describe("parseConfig", () => {
  it("applies defaults for a minimal config", () => {
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.baseIri).toBe("urn:manni:graph:");
    // No document set of its own: `inputs` and `exclude` are the family's
    // `collections:` now (proposal 0041, 0051 §1), and a section on its own
    // declares none.
    expect(c.collections).toEqual([]);
    expect(c.out).toBe("graph/graph.ttl");
    expect(c.build.derive).toEqual([
      "frontmatter",
      "sections",
      "links",
      "tags",
      "images",
      "code",
      "provenance",
      "terms",
    ]);
    // empty = use the shapes bundled with manni (shapes/graph/shapes-1.4.0.ttl)
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
    expect(c.fill.cacheDir).toBe(".manni/graph/cache");
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
      // Proposal 0087: questions join the default, beside the graph block.
      "sample-questions",
    ]);
    expect(c.fill.confidenceThreshold).toBe(0.7);
    expect(c.fill.chunkChars).toBe(12000);
    expect(c.fill.offline).toBe(false);
    expect(c.fill.questions).toEqual({ perPage: 3 });
    // Local embeddings default to granite, configurable (ADR 01020).
    expect(c.embed.model).toContain("granite-embedding-small-english-r2");
    expect(c.embed.dtype).toBe("q8");
    // A directory since the per-locale fan-out (ADR 01038): one sidecar per
    // language lands in it, named by its tag. Unset means the index directory.
    expect(c.embed.out).toBeUndefined();
    expect(c.embed.byLanguage).toEqual({});
    expect(c.embed.cacheDir).toBe(".manni/graph/embed-cache");
    // iiRDS export defaults: version 1.3, no title/creator (ADR 01017).
    expect(c.export.iirds).toEqual({
      title: undefined,
      creator: undefined,
      version: "1.3",
    });
  });

  it("refuses a schemas key: the schema set is meta's (proposal 0074)", () => {
    // graph build reads x-manni-graph-output from the set `manni meta validate`
    // resolves for each page, so graph keeps no schema set of its own. The key
    // is unknown, refused by the config schema like any other.
    const parse = (): unknown =>
      parseConfig('schemas: ["./house.schema.json"]\n', "/tmp/manni.config.yaml");
    expect(parse).toThrow(GraphError);
    expect(parse).toThrow(
      'Invalid config in /tmp/manni.config.yaml:\n  /graph: unknown key "schemas"',
    );
  });

  it("refuses the old validate: wrapper by name", () => {
    // The key was named for `graph validate`, which 0051 §8 removed. Nothing was
    // published under it, so the old spelling is an unknown key rather than a
    // migration (0048 §4) — and the message names it, as every other removed
    // graph key's does.
    const parse = (): unknown =>
      parseConfig(
        'validate:\n  schemas: ["./house.schema.json"]\n',
        "/tmp/manni.config.yaml",
      );
    expect(parse).toThrow(GraphError);
    expect(parse).toThrow('/graph: unknown key "validate"');
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
    ).toThrow(GraphError);
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
    ).toThrow(GraphError);
    expect(() =>
      parseConfig(
        "export:\n  iirds:\n    bogus: true\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(GraphError);
  });

  // Proposal 0090: the chunk artifact's evals report, and the retrieval
  // defaults the manifest hands every host.
  it("defaults export.chunks and retrieve", () => {
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.export.chunks).toEqual({ evals: null });
    expect(c.retrieve).toEqual({ seeds: 3, depth: 1, maxChars: 12000, withhold: [] });
  });

  it("parses export.chunks.evals, relative to the config, and every retrieve key", () => {
    const c = parseConfig(
      "export:\n  chunks:\n    evals: .manni/evals.json\nretrieve:\n  seeds: 5\n  depth: 0\n  maxChars: 20000\n  withhold: [drifted, failing]\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.export.chunks.evals).toBe(".manni/evals.json");
    expect(c.retrieve).toEqual({ seeds: 5, depth: 0, maxChars: 20000, withhold: ["drifted", "failing"] });
    expect(parseConfig("export:\n  chunks:\n    evals: null\n", "/tmp/manni.config.yaml").export.chunks.evals).toBeNull();
  });

  // Proposal 0090, PR 4: llms.txt, the cited gate, and which optional steps
  // `graph publish` finds set up.
  it("defaults export.llms to absent, citedThreshold to no gate, and no optional step declared", () => {
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.export.llms).toBeNull();
    expect(c.check.questions.citedThreshold).toBeNull();
    expect(c.declared).toEqual({ embed: false, iirds: false });
  });

  it("parses export.llms, citedThreshold, and the embed and iirds sections as declared", () => {
    const c = parseConfig(
      "export:\n  iirds: {}\n  llms:\n    title: manni\n    summary: One CLI.\n    origin: https://hawkeyexl.github.io\nembed: {}\ncheck:\n  questions:\n    citedThreshold: 90\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.export.llms).toEqual({ title: "manni", summary: "One CLI.", origin: "https://hawkeyexl.github.io" });
    expect(c.check.questions.citedThreshold).toBe(90);
    expect(c.declared).toEqual({ embed: true, iirds: true });
    expect(parseConfig("export:\n  llms: {}\n", "/tmp/manni.config.yaml").export.llms).toEqual({});
  });

  it.each([
    "export:\n  llms:\n    title: ''\n",
    "export:\n  llms:\n    origin: not a url\n",
    "export:\n  llms:\n    bogus: 1\n",
    "check:\n  questions:\n    citedThreshold: 101\n",
    "check:\n  questions:\n    citedThreshold: high\n",
  ])("rejects %j", (text) => {
    expect(() => parseConfig(text, "/tmp/manni.config.yaml")).toThrow(GraphError);
  });

  it.each([
    "export:\n  chunks:\n    evals: 3\n",
    "export:\n  chunks:\n    bogus: true\n",
    "retrieve:\n  seeds: 0\n",
    "retrieve:\n  depth: -1\n",
    "retrieve:\n  maxChars: 0\n",
    "retrieve:\n  withhold: [stale]\n",
    "retrieve:\n  withhold: drifted\n",
    "retrieve:\n  bogus: 1\n",
  ])("rejects %j", (text) => {
    expect(() => parseConfig(text, "/tmp/manni.config.yaml")).toThrow(GraphError);
  });

  // What one answer graph serve sends over MCP may take.
  it("defaults serve.maxChars to 40000 and parses it", () => {
    expect(parseConfig("", "/tmp/manni.config.yaml").serve).toEqual({ maxChars: 40000 });
    expect(parseConfig("serve:\n  maxChars: 5000\n", "/tmp/manni.config.yaml").serve).toEqual({ maxChars: 5000 });
  });

  it.each(["serve:\n  maxChars: 0\n", "serve:\n  maxChars: x\n", "serve:\n  maxChars: 1.5\n", "serve:\n  bogus: 1\n"])(
    "rejects %j",
    (text) => {
      expect(() => parseConfig(text, "/tmp/manni.config.yaml")).toThrow(GraphError);
    },
  );

  // Author-facing content is on by default (proposal 0110), and `false`
  // leaves it out of every build.
  it("defaults authoring to true and parses false", () => {
    expect(parseConfig("", "/tmp/manni.config.yaml").authoring).toBe(true);
    expect(parseConfig("authoring: false\n", "/tmp/manni.config.yaml").authoring).toBe(false);
  });

  it.each(["authoring: no-thanks\n", "authoring: 0\n", "authoring: null\n"])("rejects %j", (text) => {
    expect(() => parseConfig(text, "/tmp/manni.config.yaml")).toThrow(GraphError);
  });

  it("normalizes baseIri with a trailing slash", () => {
    const c = parseConfig(
      "baseIri: https://example.com/graph\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.baseIri).toBe("https://example.com/graph/");
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
    ).toThrow(GraphError);
    expect(() =>
      parseConfig(
        "fill:\n  fields: [softwareSubject]\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(GraphError);
  });

  it("rejects a stale camelCase coverageThreshold key", () => {
    expect(() =>
      parseConfig(
        "stats:\n  coverageThreshold:\n    prefLabel: 80\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(GraphError);
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseConfig("bogus: true\n", "/tmp/manni.config.yaml"),
    ).toThrow(GraphError);
  });

  it("rejects a wrong version", () => {
    expect(() => parseConfig("version: 2\n", "/tmp/manni.config.yaml")).toThrow(
      GraphError,
    );
  });

  it("rejects invalid YAML", () => {
    expect(() =>
      parseConfig("version: [1\n", "/tmp/manni.config.yaml"),
    ).toThrow(GraphError);
  });

  it("parses check.shapes and fill.validateGraph overrides", () => {
    const c = parseConfig(
      "check:\n  shapes: [my-shapes.ttl]\nfill:\n  validateGraph: false\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.check.shapes).toEqual(["my-shapes.ttl"]);
    expect(c.fill.validateGraph).toBe(false);
  });

  it("defaults check.questions to the top 5, at warning", () => {
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.check.questions).toEqual({ top: 5, severity: "warning", foundThreshold: null, citedThreshold: null });
  });

  it("parses check.questions overrides", () => {
    const c = parseConfig(
      "check:\n  questions:\n    top: 1\n    severity: off\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.check.questions).toEqual({ top: 1, severity: "off", foundThreshold: null, citedThreshold: null });
  });

  it("rejects a check.questions top below 1, a bad severity and an unknown key", () => {
    for (const body of [
      "top: 0",
      "top: 2.5",
      "severity: fatal",
      "bogus: true",
    ]) {
      expect(
        () =>
          parseConfig(
            `check:\n  questions:\n    ${body}\n`,
            "/tmp/manni.config.yaml",
          ),
        body,
      ).toThrow(GraphError);
    }
  });

  it("defaults questionFiles to none and foundThreshold to no gate", () => {
    const c = parseConfig("", "/tmp/manni.config.yaml");
    expect(c.questionFiles).toEqual([]);
    expect(c.check.questions.foundThreshold).toBeNull();
  });

  it("parses questionFiles and foundThreshold", () => {
    const c = parseConfig(
      "questionFiles: [docs/questions.yaml]\ncheck:\n  questions:\n    foundThreshold: 95\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.questionFiles).toEqual(["docs/questions.yaml"]);
    expect(c.check.questions.foundThreshold).toBe(95);
    const off = parseConfig(
      "check:\n  questions:\n    foundThreshold: null\n",
      "/tmp/manni.config.yaml",
    );
    expect(off.check.questions.foundThreshold).toBeNull();
  });

  it("rejects a bad questionFiles and a foundThreshold outside 0-100", () => {
    for (const body of [
      "questionFiles: docs/questions.yaml\n",
      "questionFiles: ['']\n",
      "check:\n  questions:\n    foundThreshold: 101\n",
      "check:\n  questions:\n    foundThreshold: -1\n",
      "check:\n  questions:\n    foundThreshold: high\n",
    ]) {
      expect(() => parseConfig(body, "/tmp/manni.config.yaml"), body).toThrow(GraphError);
    }
  });

  it("accepts sample-questions in the per-field coverage map", () => {
    const c = parseConfig(
      "stats:\n  coverageThreshold:\n    sample-questions: 60\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.stats.coverageThreshold).toEqual({ "sample-questions": 60 });
  });

  it("rejects unknown check keys", () => {
    expect(() =>
      parseConfig(
        "check:\n  bogus: true\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(GraphError);
  });

  it("rejects an unknown graph.provider, with the family's message", () => {
    expect(() =>
      parseConfig("provider: gemini\n", "/tmp/manni.config.yaml"),
    ).toThrow(GraphError);
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
      "providers:\n  provider: openai\n  openai:\n    baseUrl: http://localhost:11434/v1\ngraph:\n  out: g.ttl\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.providers.provider).toBe("openai");
    expect(c.providers.openai?.baseUrl).toBe("http://localhost:11434/v1");
  });

  // Connection settings are declared once, for every tool, in the family's
  // top-level `providers:` map (0051 §3). The keys that used to carry them
  // under `graph.fill` are unknown keys now, and the message names each one
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
    expect(parse).toThrow(GraphError);
    expect(parse).toThrow(`/graph/fill: unknown key "${key}"`);
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
    ).toThrow(GraphError);
  });

  it("parses fill.chunkChars, fill.offline and fill.questions.perPage", () => {
    const c = parseConfig(
      "fill:\n  chunkChars: 6000\n  offline: true\n  questions:\n    perPage: 5\n  fields: [sample-questions]\n",
      "/tmp/manni.config.yaml",
    );
    expect(c.fill.chunkChars).toBe(6000);
    expect(c.fill.offline).toBe(true);
    expect(c.fill.questions).toEqual({ perPage: 5 });
    expect(c.fill.fields).toEqual(["sample-questions"]);
  });

  it("rejects a bad fill.chunkChars, fill.offline or fill.questions", () => {
    for (const body of [
      "fill:\n  chunkChars: 0\n",
      "fill:\n  chunkChars: 1.5\n",
      "fill:\n  offline: yes please\n",
      "fill:\n  questions:\n    perPage: 0\n",
      "fill:\n  questions:\n    perpage: 3\n",
    ]) {
      expect(() => parseConfig(body, "/tmp/manni.config.yaml"), body).toThrow(GraphError);
    }
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
    ).toThrow(GraphError);
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
        // Proposal 0077 §3: every format graph reads, Markdown first.
        extensions: [
          ".md",
          ".mdx",
          ".markdown",
          ".html",
          ".htm",
          ".adoc",
          ".asciidoc",
          ".rst",
          ".dita",
          ".ditamap",
          ".flsnp",
          ".fltoc",
          ".flbrs",
        ],
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
    ).toThrow(GraphError);
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
      ).toThrow(GraphError);
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
      expect(() => parseConfig(bad, "/tmp/manni.config.yaml")).toThrow(GraphError);
    }
  });

  it("refuses every spelling the tri-state provenance.git took", () => {
    // graph ADR 01010's `"auto" | true | false`, removed by 0051 §6. None of the
    // three is a key any more, so each is refused by Ajv rather than read.
    for (const mode of ["auto", true, false] as const) {
      expect(() =>
        parseConfig(
          `provenance:\n  git: ${JSON.stringify(mode)}\n`,
          "/tmp/manni.config.yaml",
        ),
      ).toThrow(GraphError);
    }
  });

  it("accepts terms as a derive source, and a list without it stays without it", () => {
    const derive = (list: string) =>
      parseConfig(`build:\n  derive: [${list}]\n`, "/tmp/manni.config.yaml").build.derive;
    expect(derive("frontmatter, terms")).toEqual(["frontmatter", "terms"]);
    expect(derive("frontmatter, tags")).toEqual(["frontmatter", "tags"]);
  });

  it("rejects an unknown derive source", () => {
    expect(() =>
      parseConfig(
        "build:\n  derive: [frontmatter, telepathy]\n",
        "/tmp/manni.config.yaml",
      ),
    ).toThrow(GraphError);
  });
});

describe("loadConfig", () => {
  it("falls back to defaults when no config file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-config-"));
    const c = loadConfig(undefined, dir);
    expect(c.baseIri).toBe("urn:manni:graph:");
  });

  it("loads the graph: section of manni.config.yaml from cwd", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-config-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      "meta:\n  paths: [docs]\ngraph:\n  out: graph.ttl\n",
    );
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("graph.ttl");
    expect(c.configSource).toBe("manni.config.yaml");
  });

  it("reads the family collections: beside its own section", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-config-"));
    writeFileSync(
      join(dir, "manni.config.yaml"),
      'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\ngraph:\n  out: graph.ttl\n',
    );
    const c = loadConfig(undefined, dir);
    expect(c.collections.map((x) => x.name)).toEqual(["site"]);
  });

  it("treats an empty graph: section as the defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-config-"));
    writeFileSync(join(dir, "manni.config.yaml"), "meta:\n  paths: [docs]\ngraph:\n");
    expect(loadConfig(undefined, dir).baseIri).toBe("urn:manni:graph:");
  });

  it("does not read the pre-family dockg.config.yaml", () => {
    // Nothing was ever published under that name, so it gets no alias and no
    // migration (0051 §2, copying 0048 §4). It is simply not a config file.
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-config-"));
    writeFileSync(join(dir, "dockg.config.yaml"), "out: graph.ttl\n");
    const c = loadConfig(undefined, dir);
    expect(c.out).toBe("graph/graph.ttl");
    expect(c.configSource).toBeNull();
  });

  it("reads an explicit path with or without the graph: wrapper", () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-graph-config-"));
    writeFileSync(join(dir, "wrapped.yaml"), "graph:\n  out: a.ttl\n");
    writeFileSync(join(dir, "bare.yaml"), "out: b.ttl\n");
    expect(loadConfig("wrapped.yaml", dir).out).toBe("a.ttl");
    expect(loadConfig("bare.yaml", dir).out).toBe("b.ttl");
  });

  it("throws for an explicit missing path", () => {
    expect(() => loadConfig("Z:/nope/dockg.config.yaml")).toThrow(GraphError);
  });
});
