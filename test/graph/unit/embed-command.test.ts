import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import {
  manifestRelativePath,
  runEmbed,
} from "../../../src/graph/commands/embed.js";
import { emitSearchIndex } from "../../../src/graph/core/search-index.js";
import {
  emitLocalizations,
  parseLocalizations,
} from "../../../src/graph/core/localizations.js";
import { GraphError } from "../../../src/graph/types.js";

/**
 * A project with one `en-US` index and its manifest under `graph/`, and a
 * config whose `graph:` section is the given YAML.
 */
function project(graphSection: string): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-embed-unit-"));
  writeFileSync(join(dir, "manni.config.yaml"), `graph:\n${graphSection}`, "utf8");
  const graphDir = join(dir, "graph");
  mkdirSync(graphDir);
  const serialized = emitSearchIndex({
    version: 1,
    entries: [
      {
        id: "https://ex.com/graph/doc/a.md",
        type: "graph:Document",
        title: "Configuration",
      },
    ],
  });
  writeFileSync(join(graphDir, "search.en-US.json"), serialized, "utf8");
  const digest = `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
  writeFileSync(
    join(graphDir, "localizations.json"),
    emitLocalizations({
      version: 1,
      languages: [
        {
          language: "en-US",
          documents: 1,
          search: { path: "search.en-US.json", entries: 1, digest },
        },
      ],
    }),
    "utf8",
  );
  return dir;
}

describe("runEmbed graph.embed.out", () => {
  it("writes the sidecars where the config's embed.out names", async () => {
    const dir = project("  embed:\n    model: mock\n    out: vectors\n");
    const report = await runEmbed({ cwd: dir, noCache: true });
    expect(report.languages[0]?.outPath).toBe(
      join(dir, "vectors", "vectors.en-US.bin"),
    );
    expect(existsSync(join(dir, "vectors", "vectors.en-US.bin"))).toBe(true);
    const manifest = parseLocalizations(
      readFileSync(join(dir, "graph", "localizations.json"), "utf8"),
    );
    expect(manifest?.languages[0]?.vectors?.path).toBe("../vectors/vectors.en-US.bin");
  });

  it("lets -o override embed.out", async () => {
    const dir = project("  embed:\n    model: mock\n    out: vectors\n");
    const report = await runEmbed({ cwd: dir, noCache: true, out: "elsewhere" });
    expect(report.languages[0]?.outPath).toBe(
      join(dir, "elsewhere", "vectors.en-US.bin"),
    );
  });

  it("writes beside the index when neither names a directory", async () => {
    const dir = project("  embed:\n    model: mock\n");
    const report = await runEmbed({ cwd: dir, noCache: true });
    expect(report.languages[0]?.outPath).toBe(
      join(dir, "graph", "vectors.en-US.bin"),
    );
  });
});

describe("runEmbed embed.byLanguage", () => {
  it("finds a language's model whatever case the key is written in", async () => {
    const dir = project(
      "  embed:\n    model: not/a-real-model\n    byLanguage:\n      en-us:\n        model: mock\n",
    );
    const report = await runEmbed({ cwd: dir, noCache: true });
    expect(report.languages[0]?.model).toBe("mock");
  });
});

describe("manifestRelativePath", () => {
  it("records a sidecar relative to the manifest, with forward slashes", () => {
    expect(
      manifestRelativePath("C:\\site\\graph", "C:\\site\\vecs\\vectors.de.bin", win32),
    ).toBe("../vecs/vectors.de.bin");
    expect(
      manifestRelativePath("/site/graph", "/site/graph/vectors.de.bin", posix),
    ).toBe("vectors.de.bin");
  });

  it("refuses a sidecar on another drive, which no relative path reaches", () => {
    const go = () =>
      manifestRelativePath("C:\\site\\graph", "D:\\vecs\\vectors.de.bin", win32);
    expect(go).toThrow(GraphError);
    expect(go).toThrow(
      "Cannot record vectors at D:\\vecs\\vectors.de.bin: the localization manifest needs a path relative to C:\\site\\graph. Write the sidecars on the index's drive.",
    );
  });
});
