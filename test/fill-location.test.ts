/**
 * `manni meta fill` and field location (proposal 0047): a field a local
 * manifest owns is written into the manifest, a URL manifest refuses the
 * file (M6), and a field its schema prefers in external metadata with no
 * manifest asks to create one before the first model request (P1), or else
 * lands on the page with one warning per collection (W1) or per homeless set
 * (W2). The provider is a `MockProvider`, so nothing leaves the machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { MockProvider, type InferenceProvider } from "@hawkeyexl/inference";
import { runFill } from "../src/meta/commands/fill.js";
import { renderFill } from "../src/meta/reporters/fill.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { resetWarnings } from "../src/shared/warn.js";
import { generateEncryptionKey, isEncryptedValue } from "../src/shared/encryption.js";
import { startSchemaServer } from "./helpers/schema-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures", "location");
const MODEL = "claude-sonnet-4-5";

const dirs: string[] = [];
let stderr: string[] = [];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function copy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-${name}-`));
  dirs.push(dir);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const pageData = (dir: string, rel: string): Record<string, unknown> =>
  markdownExtractor.extract(read(dir, rel), rel).data;
const warnings = (): string[] => stderr.filter((l) => l.includes("external metadata"));

/** One proposal of `owner` per call, recording each call in `log`. */
function owners(values: string[], log: string[] = []): InferenceProvider {
  const mock = new MockProvider(
    values.map((v) => ({ json: { owner: { value: v, confidence: 0.9, reasoning: "stated" } } })),
    MODEL,
  );
  return {
    provider: () => mock.provider(),
    modelName: () => mock.modelName(),
    completeJSON: (req) => {
      log.push("model");
      return mock.completeJSON(req);
    },
  };
}

const base = { cache: false as const, concurrency: 1 };

describe("fill: a field a local manifest owns", () => {
  it("writes the proposal into the manifest entry, not the page", async () => {
    const dir = copy("fill-owned");
    const run = await runFill({ ...base, cwd: dir, inputs: ["docs/install.md"], inferenceProvider: owners(["platform"]) });
    const result = run.results[0];
    expect(result?.error).toBeUndefined();
    expect(result?.changed).toBe(true);
    expect(result?.fields).toEqual([
      expect.objectContaining({ field: "/owner", value: "platform", written: true, destination: "site-meta.yaml" }),
    ]);
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/faq.md": { owner: "support" },
      "docs/install.md": { owner: "platform" },
    });
    expect(pageData(dir, "docs/install.md")).not.toHaveProperty("owner");
    expect(renderFill("pretty", run, { color: false })).toContain("    /owner  platform  0.90  → site-meta.yaml");
  });

  it("writes nothing under --dry-run, and still names the manifest", async () => {
    const dir = copy("fill-owned");
    const before = read(dir, "site-meta.yaml");
    const run = await runFill({
      ...base,
      cwd: dir,
      inputs: ["docs/install.md"],
      dryRun: true,
      inferenceProvider: owners(["platform"]),
    });
    expect(run.results[0]?.fields[0]).toMatchObject({ written: true, destination: "site-meta.yaml" });
    expect(read(dir, "site-meta.yaml")).toBe(before);
  });

  it("writes meta-provenance into the manifest when the manifest owns it", async () => {
    const dir = copy("fill-owned");
    writeFileSync(
      join(dir, "manni.config.yaml"),
      read(dir, "manni.config.yaml").replace("keys: [owner]", "keys: [owner, meta-provenance]"),
    );
    const run = await runFill({ ...base, cwd: dir, inputs: ["docs/install.md"], inferenceProvider: owners(["platform"]) });
    expect(run.results[0]?.metaProvenance).toEqual({
      written: true,
      destination: "site-meta.yaml",
      entry: { "generated-by": MODEL, fields: ["/owner"], confidence: { "/owner": 0.9 } },
    });
    expect(parseYaml(read(dir, "site-meta.yaml"))).toMatchObject({
      "docs/install.md": {
        owner: "platform",
        "meta-provenance": [{ "generated-by": MODEL, fields: ["/owner"] }],
      },
    });
    expect(read(dir, "docs/install.md")).not.toContain("meta-provenance");
  });

  it("writes a value its schema marks x-manni-encrypt into the manifest as ciphertext", async () => {
    const dir = copy("fill-owned");
    writeFileSync(
      join(dir, "steward.schema.json"),
      read(dir, "steward.schema.json").replace(
        '"owner": { "type": "string" }',
        '"owner": { "type": "string", "x-manni-encrypt": true }',
      ),
    );
    const run = await runFill({
      ...base,
      cwd: dir,
      inputs: ["docs/install.md"],
      env: { MANNI_ENCRYPTION_KEY: generateEncryptionKey() },
      inferenceProvider: owners(["platform"]),
    });
    expect(run.results[0]?.fields[0]).toMatchObject({
      value: "(encrypted)",
      encrypted: true,
      destination: "site-meta.yaml",
    });
    const held = (parseYaml(read(dir, "site-meta.yaml")) as Record<string, { owner?: unknown }>)["docs/install.md"];
    expect(isEncryptedValue(held?.owner)).toBe(true);
    expect(read(dir, "site-meta.yaml")).not.toContain("platform");
  });

  it("refuses the file when the owning manifest is a URL (M6)", async () => {
    const server = await startSchemaServer({
      "/owners.yaml": { body: "docs/faq.md:\n  owner: support\n", contentType: "text/yaml" },
    });
    try {
      const dir = copy("fill-owned");
      writeFileSync(
        join(dir, "manni.config.yaml"),
        read(dir, "manni.config.yaml").replace("./site-meta.yaml", `${server.url}/owners.yaml`),
      );
      const log: string[] = [];
      const run = await runFill({
        ...base,
        cwd: dir,
        inputs: ["docs/install.md"],
        inferenceProvider: owners(["platform"], log),
      });
      expect(run.results[0]?.error).toBe(
        `"owner" is owned by manifest ${server.url}/owners.yaml, which is fetched and cannot be written; set it in that repository.`,
      );
      expect(run.summary.errors).toBe(1);
      expect(log).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe("fill: a manifest of a collection --collection leaves out", () => {
  /** Two collections over the same pages; only b has the manifest. */
  const twoCollections = (dir: string, keys: string): void => {
    writeFileSync(
      join(dir, "manni.config.yaml"),
      [
        "collections:",
        "  - name: a",
        '    paths: ["docs/**/*.md"]',
        "  - name: b",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        "      - file: ./site-meta.yaml",
        `        keys: [${keys}]`,
        "meta:",
        "  schemas: [./steward.schema.json]",
        "",
      ].join("\n"),
    );
  };

  it("reads b's manifest, so a curated value is present and never overwritten", async () => {
    const dir = copy("fill-owned");
    twoCollections(dir, "owner");
    const log: string[] = [];
    const run = await runFill({
      ...base,
      cwd: dir,
      inputs: [],
      collections: ["a"],
      inferenceProvider: owners(["platform", "hijack"], log),
    });
    expect(run.summary.errors).toBe(0);
    expect(log).toEqual(["model"]);
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/faq.md": { owner: "support" },
      "docs/install.md": { owner: "platform" },
    });
  });

  it("merges meta-provenance with the list b's manifest already holds", async () => {
    const dir = copy("fill-owned");
    twoCollections(dir, "owner, meta-provenance");
    writeFileSync(
      join(dir, "site-meta.yaml"),
      'docs/faq.md:\n  meta-provenance:\n    - generated-by: earlier-model\n      fields: ["/title"]\n',
    );
    const run = await runFill({
      ...base,
      cwd: dir,
      inputs: [],
      collections: ["a"],
      inferenceProvider: owners(["platform", "support"]),
    });
    expect(run.summary.errors).toBe(0);
    const entry = (parseYaml(read(dir, "site-meta.yaml")) as Record<string, Record<string, unknown>>)["docs/faq.md"];
    expect(entry?.owner).toBe("platform");
    expect(entry?.["meta-provenance"]).toEqual([
      { "generated-by": "earlier-model", fields: ["/title"] },
      expect.objectContaining({ "generated-by": MODEL, fields: ["/owner"] }),
    ]);
  });
});

describe("fill: a run that aborts after pages were written", () => {
  it("still saves the manifest edits of the pages it finished", async () => {
    const dir = copy("fill-owned");
    writeFileSync(
      join(dir, "secret.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["owner", "secret"],
        properties: { owner: { type: "string" }, secret: { type: "string", "x-manni-encrypt": true } },
      }),
    );
    writeFileSync(join(dir, "docs/zz.md"), "---\ntitle: Z\n$schema: ./secret.schema.json\n---\n# Z\n");
    await expect(
      runFill({ ...base, cwd: dir, inputs: [], env: {}, inferenceProvider: owners(["platform"]) }),
    ).rejects.toThrow(/encrypt/i);
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/faq.md": { owner: "support" },
      "docs/install.md": { owner: "platform" },
    });
  });
});

describe("fill: schema notices", () => {
  it("says each once, even when an accepted relocation prepares the pages again", async () => {
    const dir = copy("fill-external");
    writeFileSync(
      join(dir, "manni.config.yaml"),
      read(dir, "manni.config.yaml").replace(/^meta:\n/m, "meta:\n  schemaTrust:\n    documentRefs: none\n"),
    );
    writeFileSync(
      join(dir, "docs/faq.md"),
      read(dir, "docs/faq.md").replace("---\n", "---\n$schema: ./other.schema.json\n"),
    );
    const notices: string[] = [];
    await runFill({
      ...base,
      cwd: dir,
      inputs: ["docs"],
      onNotice: (m) => notices.push(m),
      confirm: () => Promise.resolve(true),
      inferenceProvider: owners(["platform", "support"]),
    });
    expect(notices.filter((m) => m.includes("is ignored"))).toEqual([
      expect.stringContaining("docs/faq.md:"),
    ]);
  });
});

describe("fill: a field its schema prefers in external metadata, with no manifest", () => {
  const W1 =
    "manni: wrote owner to 2 pages in collection site; the schema prefers external metadata, and no manifest owns it. Run manni meta relocate to move it.\n";

  it("off a terminal: writes the page, and warns once (W1)", async () => {
    const dir = copy("fill-external");
    await runFill({ ...base, cwd: dir, inputs: ["docs"], inferenceProvider: owners(["platform", "support"]) });
    expect(pageData(dir, "docs/install.md")).toMatchObject({ owner: "support" });
    expect(pageData(dir, "docs/faq.md")).toMatchObject({ owner: "platform" });
    expect(warnings()).toEqual([W1]);
  });

  it("under --dry-run: would write, and never asks", async () => {
    const dir = copy("fill-external");
    const confirm = vi.fn(() => Promise.resolve(true));
    await runFill({
      ...base,
      cwd: dir,
      inputs: ["docs"],
      dryRun: true,
      confirm,
      inferenceProvider: owners(["platform", "support"]),
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(warnings()).toEqual([W1.replace("wrote", "would write")]);
  });

  it("on a terminal, yes: asks before the first model request, then writes the manifest (P1)", async () => {
    const dir = copy("fill-external");
    const log: string[] = [];
    const notices: string[] = [];
    const run = await runFill({
      ...base,
      cwd: dir,
      inputs: ["docs"],
      onNotice: (m) => notices.push(m),
      confirm: (q) => {
        log.push(`ask: ${q}`);
        return Promise.resolve(true);
      },
      inferenceProvider: owners(["platform", "support"], log),
    });
    expect(log).toEqual(["ask: Create site.metadata.yaml and add it to manni.config.yaml? ", "model", "model"]);
    expect(notices).toContain(
      "collection site has no manifest for owner, which the schema prefers in external metadata.",
    );
    expect(run.summary.errors).toBe(0);
    expect(parseYaml(read(dir, "site.metadata.yaml"))).toEqual({
      "docs/faq.md": { owner: "platform" },
      "docs/install.md": { owner: "support" },
    });
    expect(pageData(dir, "docs/faq.md")).not.toHaveProperty("owner");
    expect(run.results.map((r) => r.fields[0]?.destination)).toEqual(["site.metadata.yaml", "site.metadata.yaml"]);
    expect(warnings()).toEqual([]);
  });

  it("on a terminal, no: writes the page, and warns (W1)", async () => {
    const dir = copy("fill-external");
    await runFill({
      ...base,
      cwd: dir,
      inputs: ["docs"],
      confirm: () => Promise.resolve(false),
      inferenceProvider: owners(["platform", "support"]),
    });
    expect(existsSync(join(dir, "site.metadata.yaml"))).toBe(false);
    expect(pageData(dir, "docs/faq.md")).toMatchObject({ owner: "platform" });
    expect(warnings()).toEqual([W1]);
  });

  it("a page in none of several collections: never asks, and warns (W2)", async () => {
    const dir = copy("fill-homeless");
    const confirm = vi.fn(() => Promise.resolve(true));
    await runFill({ ...base, cwd: dir, inputs: ["notes/stray.md"], confirm, inferenceProvider: owners(["platform"]) });
    expect(confirm).not.toHaveBeenCalled();
    expect(warnings()).toEqual([
      "manni: wrote owner to 1 page that is in none of the 2 collections; the schema prefers external metadata, and only a collection has a manifest.\n",
    ]);
  });

  it("under --no-config: warns that nothing can hold a manifest (W2)", async () => {
    const dir = copy("fill-homeless");
    await runFill({
      ...base,
      cwd: dir,
      inputs: ["notes/stray.md"],
      noConfig: true,
      cliSchemas: [join(dir, "steward.schema.json")],
      inferenceProvider: owners(["platform"]),
    });
    expect(warnings()).toEqual([
      "manni: wrote owner to 1 page; the schema prefers external metadata, and --no-config leaves it no manifest.\n",
    ]);
  });

  it("stdin never asks", async () => {
    const dir = copy("fill-external");
    const confirm = vi.fn(() => Promise.resolve(true));
    const run = await runFill({
      ...base,
      cwd: dir,
      inputs: ["-"],
      as: "markdown",
      stdinContent: "---\ntitle: Piped\n---\n\n# Piped\n",
      includeContent: true,
      confirm,
      inferenceProvider: owners(["platform"]),
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(run.results[0]?.content).toContain("owner: platform");
  });
});
