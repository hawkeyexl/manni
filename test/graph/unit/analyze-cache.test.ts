import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnalyzeCache } from "../../../src/graph/core/analyze-cache.js";
import { parseBody } from "../../../src/graph/core/analyze.js";

const PAGE = "# Title\n\nSee [config](./config.md) and ![logo](./logo.png).\n\n```ts\nx\n```\n";

function tempDir(): string {
  return join(mkdtempSync(join(tmpdir(), "manni-graph-analyze-cache-")), "cache");
}

/** Parse once through a fresh cache over `dir` and wait for its write. */
async function parseOnce(
  dir: string,
  content: string,
  path: string,
  format: "markdown" | "mdx" = "markdown",
  version?: string,
): Promise<{ cache: AnalyzeCache; body: ReturnType<typeof parseBody> }> {
  const cache = new AnalyzeCache(dir, version);
  const body = cache.parse(content, path, format);
  await cache.flush();
  return { cache, body };
}

describe("AnalyzeCache", () => {
  it("serves an unchanged page from the entry the last run wrote", async () => {
    const dir = tempDir();
    const cold = await parseOnce(dir, PAGE, "docs/a.md");
    expect(cold.cache.misses).toBe(1);
    expect(cold.body).toEqual(parseBody(PAGE, "docs/a.md", "markdown"));

    const warm = await parseOnce(dir, PAGE, "docs/a.md");
    expect(warm.cache.hits).toBe(1);
    expect(warm.cache.misses).toBe(0);
    expect(warm.body).toEqual(cold.body);
  });

  interface Change {
    content?: string;
    path?: string;
    format?: "markdown" | "mdx";
    version?: string;
  }
  it.each<[string, Change]>([
    ["the page's bytes", { content: `${PAGE}\nMore.\n` }],
    ["the page's label", { path: "docs/b.md" }],
    ["the format it parses as", { format: "mdx" }],
    ["the manni version", { version: "0.0.0-other" }],
  ])("misses when %s change", async (_, change) => {
    const dir = tempDir();
    await parseOnce(dir, PAGE, "docs/a.md");
    const { cache } = await parseOnce(
      dir,
      change.content ?? PAGE,
      change.path ?? "docs/a.md",
      change.format ?? "markdown",
      change.version,
    );
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(1);
  });

  it("keeps one entry per label, overwritten when the page changes", async () => {
    const dir = tempDir();
    await parseOnce(dir, PAGE, "docs/a.md");
    await parseOnce(dir, "# Changed\n", "docs/a.md");
    await parseOnce(dir, PAGE, "docs/b.md");
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it.each([
    ["is not JSON", () => "{ not json"],
    ["has the right key and a malformed body", (text: string) => {
      const entry = JSON.parse(text) as { key: string };
      return JSON.stringify({ key: entry.key, body: { sections: "nope" } });
    }],
  ])("ignores an entry that %s, and rewrites it", async (_, corrupt) => {
    const dir = tempDir();
    await parseOnce(dir, PAGE, "docs/a.md");
    const [name] = readdirSync(dir);
    if (name === undefined) throw new Error("no cache entry was written");
    const file = join(dir, name);
    writeFileSync(file, corrupt(readFileSync(file, "utf8")));

    const again = await parseOnce(dir, PAGE, "docs/a.md");
    expect(again.cache.misses).toBe(1);
    expect(again.body).toEqual(parseBody(PAGE, "docs/a.md", "markdown"));
    const healed = await parseOnce(dir, PAGE, "docs/a.md");
    expect(healed.cache.hits).toBe(1);
  });

  it("never fails a run when the cache directory cannot be written", async () => {
    // A file where the directory should be: mkdir and every write fail.
    const blocked = join(tempDir(), "..", "blocker");
    writeFileSync(blocked, "a file, not a directory");
    const { cache, body } = await parseOnce(join(blocked, "cache"), PAGE, "docs/a.md");
    expect(cache.misses).toBe(1);
    expect(body.sections).toHaveLength(1);
  });
});
