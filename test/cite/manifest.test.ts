/**
 * Two commands writing one manifest at the same time.
 *
 * `cite add` reads the manifest, splices an entry in memory, and writes the
 * whole file back seconds later. Two of those interleaved used to mean the
 * second write replaced the first, and a lost claim-lines entry leaves no
 * trace on the page for `cite check` to find. These tests pin the
 * compare-and-swap that makes the second write see the first.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManifestSet } from "../../src/cite/core/manifest.js";
import type { CitationManifest } from "../../src/cite/core/sidecar.js";
import { CiteError } from "../../src/cite/errors.js";

const MANIFEST = ["docs/a.md:", "  title: A", "docs/b.md:", "  title: B", ""].join("\n");

let dir: string;
let path: string;
let owner: CitationManifest;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cite-manifest-"));
  path = join(dir, "site.metadata.yaml");
  await writeFile(path, MANIFEST, "utf8");
  owner = { collection: "docs", path, file: "site.metadata.yaml", join: "path" };
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const citation = (id: string): Record<string, unknown> => ({ id, source: { file: "src.ts" } });

describe("ManifestSet.commit", () => {
  it("keeps the entry another command wrote while this one was running", async () => {
    const first = new ManifestSet();
    const second = new ManifestSet();
    // Both read the manifest as it stands, before either has written.
    await first.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    await second.write(owner, "docs/b.md", [citation("bbbbbb")], 0);

    await first.commit();
    await second.commit();

    const text = await readFile(path, "utf8");
    expect(text).toContain("aaaaaa");
    expect(text).toContain("bbbbbb");
  });

  it("reports the line the entry landed on after a rebase", async () => {
    const first = new ManifestSet();
    const second = new ManifestSet();
    await first.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    const at = await second.write(owner, "docs/b.md", [citation("bbbbbb")], 0);

    await first.commit();
    const [landed] = await second.commit();

    const text = await readFile(path, "utf8");
    const lines = text.split("\n");
    // The pre-rebase line is stale once the other entry grew the file above it.
    expect(lines[at.line - 1]).not.toContain("bbbbbb");
    // `lineOf` reads the settled text, so it names where the entry really is.
    const settled = second.lineOf(owner, "docs/b.md", 0);
    expect(settled).not.toBe(at.line);
    expect(lines[(settled ?? 0) - 1]).toContain("bbbbbb");
    expect(landed?.text).toBe(text);
  });

  it("refuses when the same entry changed under the command", async () => {
    const first = new ManifestSet();
    const second = new ManifestSet();
    await first.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    await second.write(owner, "docs/a.md", [citation("bbbbbb")], 0);

    await first.commit();
    await expect(second.commit()).rejects.toThrow(CiteError);
    // The first command's entry is still there, and nothing of the second is.
    const text = await readFile(path, "utf8");
    expect(text).toContain("aaaaaa");
    expect(text).not.toContain("bbbbbb");
  });

  it("names the file and says nothing was written", async () => {
    const first = new ManifestSet();
    const second = new ManifestSet();
    await first.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    await second.write(owner, "docs/a.md", [citation("bbbbbb")], 0);
    await first.commit();
    await expect(second.commit()).rejects.toThrow(
      "site.metadata.yaml changed under the command while it was being written. Nothing was written to it. Re-run the command.",
    );
  });

  it("refuses an unreplayable conflict without spending the attempts", async () => {
    const first = new ManifestSet();
    const second = new ManifestSet();
    await first.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    await second.write(owner, "docs/a.md", [citation("bbbbbb")], 0);
    await first.commit();

    let reads = 0;
    const read = async (at: string): Promise<string> => {
      reads += 1;
      return readFile(at, "utf8");
    };
    await expect(second.commit({ read })).rejects.toThrow(CiteError);
    // The verdict is about a base fixed before the run started, so the refusal
    // comes off the first fresh read rather than off the whole budget.
    expect(reads).toBe(1);
  });

  it("spends a retry on a conflict it can replay", async () => {
    const first = new ManifestSet();
    const second = new ManifestSet();
    await first.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    await second.write(owner, "docs/b.md", [citation("bbbbbb")], 0);
    await first.commit();

    let reads = 0;
    const read = async (at: string): Promise<string> => {
      reads += 1;
      return readFile(at, "utf8");
    };
    await second.commit({ read });
    // One read to find the other entry and replay onto it, one to compare the
    // replayed bytes against the file they are about to replace.
    expect(reads).toBe(2);
    const text = await readFile(path, "utf8");
    expect(text).toContain("aaaaaa");
    expect(text).toContain("bbbbbb");
  });

  it("hands a failed write to onError, and throws what it raises", async () => {
    const set = new ManifestSet();
    await set.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    const seen: string[] = [];
    await expect(
      set.commit({
        write: () => Promise.reject(new Error("no space left on device")),
        onError: (change, error) => {
          seen.push(change.file);
          throw new CiteError(`rolled back after ${(error as Error).message}`);
        },
      }),
    ).rejects.toThrow("rolled back after no space left on device");
    // The callback is `update`'s route to putting the pages back, so it sees
    // the manifest that failed, and what it raises is what the caller gets.
    expect(seen).toEqual(["site.metadata.yaml"]);
    expect(await readFile(path, "utf8")).toBe(MANIFEST);
  });

  it("writes straight through when nothing else touched the manifest", async () => {
    const set = new ManifestSet();
    await set.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    const landed = await set.commit();
    expect(landed).toHaveLength(1);
    expect(await readFile(path, "utf8")).toContain("aaaaaa");
  });

  it("keeps a removal that another command's unrelated entry raced", async () => {
    const seed = new ManifestSet();
    await seed.write(owner, "docs/a.md", [citation("aaaaaa")], 0);
    await seed.commit();

    const first = new ManifestSet();
    const second = new ManifestSet();
    await first.write(owner, "docs/b.md", [citation("bbbbbb")], 0);
    await second.remove(owner, "docs/a.md");

    await first.commit();
    await second.commit();

    const text = await readFile(path, "utf8");
    expect(text).not.toContain("aaaaaa");
    expect(text).toContain("bbbbbb");
  });
});
