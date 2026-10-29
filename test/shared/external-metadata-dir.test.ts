/**
 * The metadata directory (proposal 0126): one `<id>.yaml` manifest per page,
 * read by every collection that declares no `externalMetadata:` of its own.
 *
 * Where it is, whether it is read, and the entry a collection reads it
 * through. Reading the manifests themselves is the metadata tool's business.
 *
 * On-disk samples are under `test/fixtures/external-metadata-dir/`: the root
 * has no `metadata/`, `manifest/` has one holding a manifest, and `unrelated/`
 * has one holding only a YAML file that is not one.
 */
import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  externalMetadataOrigin,
  neverOwned,
  parseCollections,
  type CollectionConfig,
} from "../../src/shared/collections.js";
import {
  EXTERNAL_METADATA_DIR_DEFAULT,
  EXTERNAL_METADATA_DIR_ENV,
  EXTERNAL_METADATA_DIR_KEY,
  applyMetadataDirectory,
  metadataDirState,
  missingDirMessage,
  parseExternalMetadataDir,
  resolveExternalMetadataDir,
  withMetadataDirectory,
} from "../../src/shared/external-metadata-dir.js";
import { parseConfig as parseDocevalsConfig } from "../../src/docevals/core/config.js";
import { parseConfig as parseGraphConfig } from "../../src/graph/core/config.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "..", "fixtures", "external-metadata-dir");
const SOURCE = "manni.config.yaml";
const toError = (message: string): Error => new Error(message);
/** An environment with nothing set, so the developer's own never leaks in. */
const NO_ENV: NodeJS.ProcessEnv = {};

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  throw new Error("expected the call to throw, but it returned");
}

/** One collection of each kind: no key, an empty list, and its own manifest. */
function threeCollections(): CollectionConfig[] {
  return parseCollections(
    [
      { name: "guides", paths: ["guides"] },
      { name: "legal", paths: ["legal"], externalMetadata: [] },
      { name: "api", paths: ["api"], externalMetadata: [{ file: "api.yaml", keys: ["owner"] }] },
    ],
    SOURCE,
    toError,
  );
}

describe("the names (0126)", () => {
  it("are the env variable, the key and the default", () => {
    expect(EXTERNAL_METADATA_DIR_ENV).toBe("MANNI_EXTERNAL_METADATA_DIR");
    expect(EXTERNAL_METADATA_DIR_KEY).toBe("externalMetadataDir");
    expect(EXTERNAL_METADATA_DIR_DEFAULT).toBe("metadata");
  });
});

describe("parseExternalMetadataDir (0126)", () => {
  it("is undefined when the key is absent", () => {
    expect(parseExternalMetadataDir({}, SOURCE, toError)).toBeUndefined();
  });

  it("takes a relative or an absolute path as written", () => {
    expect(parseExternalMetadataDir({ externalMetadataDir: "../docs-meta" }, SOURCE, toError)).toBe("../docs-meta");
    expect(parseExternalMetadataDir({ externalMetadataDir: "/srv/meta" }, SOURCE, toError)).toBe("/srv/meta");
  });

  it.each([
    ["empty", ""],
    ["blank", "  "],
    ["null", null],
    ["a number", 5],
    ["a list", ["metadata"]],
  ])("refuses a value that is %s", (_label, value) => {
    expect(messageOf(() => parseExternalMetadataDir({ externalMetadataDir: value }, SOURCE, toError))).toBe(
      "manni.config.yaml: externalMetadataDir must be a non-empty string naming a directory, relative to the config file.",
    );
  });

  it.each(["https://example.com/meta", "HTTP://example.com/meta"])("refuses a URL, %s", (value) => {
    expect(messageOf(() => parseExternalMetadataDir({ externalMetadataDir: value }, SOURCE, toError))).toBe(
      "manni.config.yaml: externalMetadataDir is a URL. It names a directory this run reads and writes; check the repository out and name its path.",
    );
  });
});

describe("resolveExternalMetadataDir (0126)", () => {
  const configDir = resolve("/repo");

  it("defaults to metadata beside the config file", () => {
    expect(resolveExternalMetadataDir({ env: NO_ENV, configDir })).toEqual({
      abs: resolve(configDir, "metadata"),
      spelled: "metadata",
      source: "default",
      pattern: "metadata/{id}.yaml",
    });
  });

  it("takes the key over the default, resolved from the config directory", () => {
    expect(resolveExternalMetadataDir({ env: NO_ENV, configDir, configured: "./meta/" })).toEqual({
      abs: resolve(configDir, "meta"),
      spelled: "./meta/",
      source: "config",
      pattern: "meta/{id}.yaml",
    });
  });

  it("takes the environment over the key, resolved from the config directory too", () => {
    const env = { [EXTERNAL_METADATA_DIR_ENV]: "../docs-meta" };
    const dir = resolveExternalMetadataDir({ env, configDir, configured: "meta" });
    expect(dir).toMatchObject({ abs: resolve(configDir, "../docs-meta"), spelled: "../docs-meta", source: "env" });
  });

  // An absent CI secret expands to "", as with MANNI_ENCRYPTION_KEY.
  it("counts an empty environment value as unset", () => {
    const env = { [EXTERNAL_METADATA_DIR_ENV]: "" };
    expect(resolveExternalMetadataDir({ env, configDir, configured: "meta" }).source).toBe("config");
    expect(resolveExternalMetadataDir({ env, configDir }).source).toBe("default");
  });

  it("keeps an absolute directory absolute, and names a directory outside by its absolute path", () => {
    const abs = resolve("/srv/docs-meta");
    const dir = resolveExternalMetadataDir({ env: NO_ENV, configDir, configured: abs });
    expect(dir.abs).toBe(abs);
    expect(dir.pattern).toBe(`${abs.replace(/\\/g, "/")}/{id}.yaml`);
    const above = resolveExternalMetadataDir({ env: NO_ENV, configDir, configured: "../docs-meta" });
    expect(above.pattern).toBe(`${resolve(configDir, "../docs-meta").replace(/\\/g, "/")}/{id}.yaml`);
  });
});

describe("metadataDirState (0126)", () => {
  const at = (configDir: string, configured?: string): ReturnType<typeof resolveExternalMetadataDir> =>
    resolveExternalMetadataDir({ env: NO_ENV, configDir, ...(configured === undefined ? {} : { configured }) });

  it("reads a directory the key names, whatever it holds", () => {
    expect(metadataDirState(at(resolve(fixtures, "unrelated"), "metadata"))).toBe("read");
  });

  it("calls a directory the key names missing when it is not there", () => {
    expect(metadataDirState(at(fixtures, "nope"))).toBe("missing");
  });

  it("calls a directory the environment names missing when it is not there", () => {
    const dir = resolveExternalMetadataDir({ env: { [EXTERNAL_METADATA_DIR_ENV]: "nope" }, configDir: fixtures });
    expect(metadataDirState(dir)).toBe("missing");
  });

  it("leaves the default absent when there is no metadata directory", () => {
    expect(metadataDirState(at(fixtures))).toBe("absent");
  });

  // A repository's own metadata/ for something else is not taken over.
  it("leaves the default absent when its YAML is not a manifest", () => {
    expect(metadataDirState(at(resolve(fixtures, "unrelated")))).toBe("absent");
  });

  it("reads the default once it holds a manifest keyed by its own stem", () => {
    expect(metadataDirState(at(resolve(fixtures, "manifest")))).toBe("read");
  });
});

describe("missingDirMessage (0126)", () => {
  it("names the key, or the environment variable, that named the directory", () => {
    const configDir = resolve("/repo");
    expect(missingDirMessage(resolveExternalMetadataDir({ env: NO_ENV, configDir, configured: "../docs-meta" }))).toBe(
      "externalMetadataDir: ../docs-meta does not exist. Create it, or check out the repository it names.",
    );
    const env = { [EXTERNAL_METADATA_DIR_ENV]: "../docs-meta" };
    expect(missingDirMessage(resolveExternalMetadataDir({ env, configDir }))).toBe(
      "MANNI_EXTERNAL_METADATA_DIR: ../docs-meta does not exist. Create it, or check out the repository it names.",
    );
  });
});

describe("withMetadataDirectory (0126)", () => {
  const dir = resolveExternalMetadataDir({ env: NO_ENV, configDir: resolve("/repo") });

  it("gives every collection with no externalMetadata: key one keyless, implicit entry", () => {
    const [guides, legal, api] = withMetadataDirectory(threeCollections(), dir, "read", SOURCE);
    expect(guides?.externalMetadata).toEqual([{ file: "metadata/{id}.yaml", implicit: true }]);
    expect(guides?.declaresExternalMetadata).toBe(false);
    // `[]` opts out, and a declared entry manages its own manifests.
    expect(legal?.externalMetadata).toEqual([]);
    expect(api?.externalMetadata).toEqual([{ file: "api.yaml", keys: ["owner"] }]);
  });

  it("injects for a missing directory too, which the loader refuses", () => {
    const [guides] = withMetadataDirectory(threeCollections(), dir, "missing", SOURCE);
    expect(guides?.externalMetadata).toEqual([
      { file: "metadata/{id}.yaml", implicit: true, missing: missingDirMessage(dir) },
    ]);
  });

  it("changes nothing while the default is absent", () => {
    const collections = threeCollections();
    expect(withMetadataDirectory(collections, dir, "absent", SOURCE)).toEqual(collections);
  });

  it("registers the entry as the parser registers a declared keyless one", () => {
    const [guides] = withMetadataDirectory(threeCollections(), dir, "read", SOURCE);
    const entry = guides?.externalMetadata[0];
    if (guides === undefined || entry === undefined) throw new Error("expected an injected entry");
    expect(externalMetadataOrigin(entry)).toEqual({ source: SOURCE, where: "collections[0].externalMetadata[0]" });
    expect([...neverOwned(guides, entry)].sort()).toEqual(["$schema", "id"]);
  });
});

describe("applyMetadataDirectory (0126)", () => {
  const configDir = resolve(fixtures, "manifest");

  it("resolves, decides and injects in one call", () => {
    const [guides] = applyMetadataDirectory(threeCollections(), {}, { source: SOURCE, configDir, toError, env: NO_ENV });
    expect(guides?.externalMetadata).toEqual([{ file: "metadata/{id}.yaml", implicit: true }]);
  });

  it("refuses a malformed key", () => {
    expect(
      messageOf(() =>
        applyMetadataDirectory(threeCollections(), { externalMetadataDir: "" }, { source: SOURCE, configDir, toError, env: NO_ENV }),
      ),
    ).toBe(
      "manni.config.yaml: externalMetadataDir must be a non-empty string naming a directory, relative to the config file.",
    );
  });

  it("injects a directory the key names even before it exists, carrying its refusal", () => {
    const [guides] = applyMetadataDirectory(
      threeCollections(),
      { externalMetadataDir: "meta" },
      { source: SOURCE, configDir, toError, env: NO_ENV },
    );
    expect(guides?.externalMetadata).toEqual([
      {
        file: "meta/{id}.yaml",
        implicit: true,
        missing: "externalMetadataDir: meta does not exist. Create it, or check out the repository it names.",
      },
    ]);
  });
});

// Every place that parses a family file's `collections:` from text applies
// the same default, so a collection reads the same manifests whichever tool
// loads it. The shared loader's half is in `test/config-file.test.ts`.
describe("each text parse site reads the metadata directory (0126)", () => {
  const configPath = resolve(fixtures, "manifest", SOURCE);
  const text = "collections:\n  - name: guides\n    paths: [guides]\n  - name: legal\n    paths: [legal]\n    externalMetadata: []\n";
  const implicit = [{ file: "metadata/{id}.yaml", implicit: true }];

  it("docevals", () => {
    const config = parseDocevalsConfig(text, configPath);
    expect(config.collections.map((c) => c.externalMetadata)).toEqual([implicit, []]);
  });

  it("graph", () => {
    // graph reads the family keys only beside its own section.
    const config = parseGraphConfig(`${text}graph: {}\n`, configPath);
    expect(config.collections.map((c) => c.externalMetadata)).toEqual([implicit, []]);
  });
});
