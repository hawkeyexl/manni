import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSearch } from "../../../src/graph/commands/search.js";
import { emitSearchIndex } from "../../../src/graph/core/search-index.js";
import { emitLocalizations } from "../../../src/graph/core/localizations.js";
import { GraphError } from "../../../src/graph/types.js";

const DOC = "https://ex.com/graph/doc/a.md";

/** One `en-US` index and the manifest naming it, in a fresh directory. */
function indexDir(): { dir: string; index: string } {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-search-"));
  const serialized = emitSearchIndex({
    version: 1,
    entries: [
      { id: DOC, type: "graph:Document", title: "Configuration", text: "settings" },
    ],
  });
  const index = join(dir, "search.en-US.json");
  writeFileSync(index, serialized, "utf8");
  const digest = `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
  writeFileSync(
    join(dir, "localizations.json"),
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
  return { dir, index };
}

const search = (dir: string, lang: string) =>
  runSearch({
    noConfig: true,
    index: dir,
    cwd: dir,
    lang,
    query: "configuration",
    mode: "lexical",
  });

describe("runSearch --lang", () => {
  it("finds a localization whatever the tag's case", async () => {
    const { dir } = indexDir();
    const report = await search(dir, "en-us");
    expect(report.results.map((r) => r.iri)).toEqual([DOC]);
  });
});

describe("runSearch index digest", () => {
  it("refuses an index whose bytes no longer match the manifest", async () => {
    const { dir, index } = indexDir();
    writeFileSync(
      index,
      emitSearchIndex({
        version: 1,
        entries: [{ id: DOC, type: "graph:Document", title: "Edited" }],
      }),
      "utf8",
    );
    const go = search(dir, "en-US");
    await expect(go).rejects.toThrow(GraphError);
    await expect(search(dir, "en-US")).rejects.toThrow(
      /^Stale manifest: search\.en-US\.json does not match the digest recorded for "en-US"/,
    );
  });
});
