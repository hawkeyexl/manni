/**
 * The browser-safety contract as a regression test (ADR 01018).
 *
 * `dockg/runtime` must be loadable in a browser: no Node built-ins, no CommonJS
 * interop, no CLI shebang, no npm dependencies. tsup bundles the runtime's
 * whole module graph into dist/runtime.js, so scanning that one file catches a
 * `node:` import sneaking in through *any* transitive import.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bundle = join(root, "dist", "kg", "runtime.js");
const source = (): string => readFileSync(bundle, "utf8");

describe("dockg/runtime package surface", () => {
  /**
   * Both tsup configs write to dist, and tsup builds an array config
   * concurrently — a config with `clean` deletes every .d.ts in the shared
   * outDir when its declaration rollup starts, which silently raced away
   * runtime.d.ts. Assert every path package.json's exports map names.
   */
  it("emits every file the ./runtime export names", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string>> };
    const entry = pkg.exports["./kg/runtime"];
    expect(entry).toBeDefined();
    for (const target of Object.values(entry!)) {
      expect(existsSync(join(root, target)), `missing ${target}`).toBe(true);
    }
  });

  it("declares the documented API in its .d.ts", () => {
    const types = readFileSync(join(root, "dist", "kg", "runtime.d.ts"), "utf8");
    for (const name of ["GraphIndex", "traverse", "assemble", "QueryTrace"]) {
      expect(types).toContain(name);
    }
  });
});

describe("dockg/runtime bundle purity", () => {
  it("imports no node: built-in", () => {
    const hits = [...source().matchAll(/["'`]node:[a-z_/]+["'`]/g)].map(
      (m) => m[0],
    );
    expect(hits).toEqual([]);
  });

  it("names no bare Node built-in in an import or require", () => {
    const text = source();
    for (const mod of [
      "fs",
      "path",
      "os",
      "crypto",
      "zlib",
      "child_process",
      "url",
      "stream",
    ]) {
      expect(text).not.toMatch(
        new RegExp(`(from|import|require)\\s*\\(?\\s*["'\`]${mod}["'\`]`),
      );
    }
  });

  it("carries no CommonJS require and no CLI shebang", () => {
    const text = source();
    expect(text).not.toMatch(/\brequire\s*\(/);
    expect(text.startsWith("#!")).toBe(false);
  });

  /**
   * The runtime was dependency-free until Phase 8 (ADR 01019) traded that for
   * MiniSearch's tokenizer and fuzzy matching. The contract narrows rather than
   * disappears: exactly one dependency may reach the bundle, and it is bundled
   * in so `dist/runtime.js` stays a single-file browser drop-in.
   */
  const ALLOWED_DEPS = new Set(["minisearch"]);

  it("bundles no npm dependency outside the allow-list", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
    };
    const text = source();
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (ALLOWED_DEPS.has(dep)) continue;
      expect(text).not.toMatch(
        new RegExp(`from\\s*["'\`]${dep.replace(/[/@-]/g, "\\$&")}`),
      );
    }
  });

  it("bundles the allow-listed dependency rather than importing it", () => {
    // A bare `from "minisearch"` would mean the browser has to resolve it.
    expect(source()).not.toMatch(/from\s*["'`]minisearch["'`]/);
  });

  it("keeps the embedder and its model stack out of the runtime", () => {
    // @huggingface/transformers hard-depends on both ONNX runtimes plus native
    // sharp. It lives behind `dockg/embed` precisely so the runtime never grows
    // a model stack (ADR 01020).
    const text = source();
    expect(text).not.toMatch(/@huggingface\/transformers/);
    expect(text).not.toMatch(/onnxruntime/);
  });

  it("emits no shared chunk the browser would have to fetch separately", () => {
    // `dist/runtime.js` must stay a single-file drop-in: a relative chunk import
    // resolves under a bundler and breaks with a plain script tag.
    const text = source();
    expect(text).not.toMatch(/from\s*["'`]\.\/chunk-/);
    // No bare specifiers at all — every import would be a browser resolution.
    const bareImports = [
      ...text.matchAll(/^import\s.*from\s*["'`]([^.][^"'`]*)/gm),
    ];
    expect(bareImports.map((m) => m[1])).toEqual([]);
  });
});

describe("dockg/embed package surface", () => {
  const embedBundle = join(root, "dist", "kg", "embed.js");

  it("emits every file the ./embed export names", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      exports: Record<string, Record<string, string>>;
    };
    const entry = pkg.exports["./kg/embed"];
    expect(entry).toBeDefined();
    for (const target of Object.values(entry!)) {
      expect(existsSync(join(root, target)), `missing ${target}`).toBe(true);
    }
  });

  it("declares the optional peer rather than depending on it", () => {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    expect(pkg.dependencies?.["@huggingface/transformers"]).toBeUndefined();
    expect(pkg.peerDependencies?.["@huggingface/transformers"]).toBeDefined();
    expect(
      pkg.peerDependenciesMeta?.["@huggingface/transformers"]?.optional,
    ).toBe(true);
    // Not a devDependency either: it drags in both ONNX runtimes plus native
    // sharp (~476 MB), which every contributor would then install to work on
    // anything. The `embed-real` CI job installs it for its own run. This is
    // easy to reintroduce by accident — `npm uninstall` of the peer strips the
    // `peerDependencies` entry while leaving `peerDependenciesMeta`, so the two
    // assertions above are checked together with this one.
    expect(pkg.devDependencies?.["@huggingface/transformers"]).toBeUndefined();
  });

  it("leaves the peer as a bare dynamic import, not inlined", () => {
    // Inlining it would defeat the whole point of an optional peer.
    const text = readFileSync(embedBundle, "utf8");
    expect(text).toMatch(
      /import\(\s*["'`]@huggingface\/transformers["'`]\s*\)/,
    );
    expect(text).not.toMatch(/onnxruntime/);
  });

  it("exposes the mock embedder for hermetic use downstream", async () => {
    const api = (await import(
      embedBundle
    )) as typeof import("../../../src/kg/embed/index.js");
    const mock = api.createMockEmbedder({ dims: 4 });
    const a = await mock.embed("hello");
    const b = await mock.embed("hello");
    expect([...a]).toEqual([...b]);
    expect(a).toHaveLength(4);
  });

  it("exports the documented runtime API", async () => {
    const api = (await import(bundle)) as Record<string, unknown>;
    for (const name of [
      "GraphIndex",
      "traverse",
      "impact",
      "reverseReferences",
      "scopeExclusion",
      "createFetchResolver",
      "assemble",
      "createTrace",
      "reachedNodes",
      "rdfjsQuads",
      "matchQuads",
    ]) {
      expect(typeof api[name]).not.toBe("undefined");
    }
  });

  it("references no Node-only global", () => {
    // The browser has no process/Buffer/__dirname/__filename. A static scan is
    // the honest gate here: importing the bundle in this Node process would
    // *not* catch a reference, because those globals exist here.
    //
    // Matched as *uses* (member access or typeof), not as bare words: bundled
    // dependency doc-comments legitimately contain the English word "process"
    // ("used to process each tokenized term"), and stripping comments first
    // would be worse — the bundle is full of `https://` IRIs that a naive
    // line-comment stripper would mangle.
    //
    // The member-access patterns exclude a leading `.` so `foo.process` (a
    // property named "process") does not trip them — which means the
    // `globalThis.`-qualified forms need their own patterns, or
    // `globalThis.process.env` would slip through the gate entirely.
    const text = source();
    const uses: Array<[string, RegExp]> = [
      ["process", /(^|[^\w.$"'`])process\s*(\.|\[)/m],
      ["process", /typeof\s+process\b/],
      ["globalThis.process", /globalThis\s*(\.\s*process\b|\[\s*["'`]process)/],
      ["Buffer", /(^|[^\w.$"'`])Buffer\s*(\.|\(|\[)/m],
      ["Buffer", /typeof\s+Buffer\b/],
      ["globalThis.Buffer", /globalThis\s*(\.\s*Buffer\b|\[\s*["'`]Buffer)/],
      ["__dirname", /\b__dirname\b/],
      ["__filename", /\b__filename\b/],
    ];
    for (const [name, pattern] of uses) {
      expect(
        pattern.test(text),
        `bundle references the Node-only global ${name}`,
      ).toBe(false);
    }
  });

  it("executes a traversal when imported", async () => {
    const { GraphIndex, traverse } = (await import(
      bundle
    )) as typeof import("../../../src/kg/runtime/index.js");
    const graph = GraphIndex.fromJsonLd({
      "@context": { dcterms: "http://purl.org/dc/terms/" },
      "@graph": [
        { "@id": "urn:a", "dcterms:references": { "@id": "urn:b" } },
        { "@id": "urn:b", "dcterms:title": "B" },
      ],
    });
    const result = traverse(graph, { seeds: ["urn:a"], depth: 1 });
    expect(result.nodes.map((n) => n.iri)).toEqual(["urn:a", "urn:b"]);
    expect(result.trace.hops).toHaveLength(1);
  });
});
