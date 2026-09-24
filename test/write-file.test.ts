/**
 * The only tests in the suite that touch the filesystem, so they work inside a
 * fresh mkdtemp directory rather than against the shared read-only fixtures.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile, stat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../src/meta/core/write-file.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "docmeta-fill-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeFileAtomic", () => {
  it("replaces the file's contents", async () => {
    const file = join(dir, "page.md");
    await writeFile(file, "old\n", "utf8");
    await writeFileAtomic(file, "new\n");
    expect(await readFile(file, "utf8")).toBe("new\n");
  });

  it("creates a file that does not exist yet", async () => {
    const file = join(dir, "fresh.md");
    await writeFileAtomic(file, "hello\n");
    expect(await readFile(file, "utf8")).toBe("hello\n");
  });

  it("creates the directories a new file sits in, when asked", async () => {
    // A mirrored per-page manifest (proposal 0058), `./meta/{page}.citations.yaml`,
    // is the first write whose directory may not exist yet.
    const file = join(dir, "meta", "docs", "guide", "page.citations.yaml");
    await writeFileAtomic(file, "docs/guide/page.md: {}\n", { createParents: true });
    expect(await readFile(file, "utf8")).toBe("docs/guide/page.md: {}\n");
    expect(await readdir(join(dir, "meta", "docs", "guide"))).toEqual(["page.citations.yaml"]);
  });

  it("leaves a missing directory a failure otherwise", async () => {
    await expect(writeFileAtomic(join(dir, "absent", "page.md"), "x\n")).rejects.toThrow(/ENOENT/);
  });

  it("leaves no temp files behind", async () => {
    const file = join(dir, "page.md");
    await writeFile(file, "old\n", "utf8");
    await writeFileAtomic(file, "new\n");
    expect(await readdir(dir)).toEqual(["page.md"]);
  });

  it("writes bytes verbatim, including CRLF and a BOM", async () => {
    const file = join(dir, "page.md");
    const content = "﻿---\r\ntype: concept\r\n---\r\n";
    await writeFileAtomic(file, content);
    expect(await readFile(file, "utf8")).toBe(content);
  });

  it.skipIf(process.platform === "win32")(
    "preserves the original file mode",
    async () => {
      const file = join(dir, "page.md");
      await writeFile(file, "old\n", "utf8");
      await chmod(file, 0o640);
      await writeFileAtomic(file, "new\n");
      expect((await stat(file)).mode & 0o777).toBe(0o640);
    },
  );
});
