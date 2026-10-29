/**
 * `meta derive` minting an id (proposal 0126) moves the values the page's
 * `{id}` manifest owns out of the page, and saves its manifests only after
 * every page is written. A manifest that then fails to save puts the minted
 * page back, so no moved value is lost.
 *
 * The fixture is `test/fixtures/external-metadata-dir/writers`, staged in a
 * repository for derive's CODEOWNERS source, with `fresh.md` holding a
 * `reviewer` of its own. The save is made to fail by a stand-in for the
 * atomic writer that refuses `metadata/fresh.yaml`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDerive } from "../src/meta/commands/derive.js";
import { DocmetaError } from "../src/meta/types.js";
import { commit, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

const refused = vi.hoisted(() => ({ suffix: undefined as string | undefined }));
vi.mock("../src/meta/core/write-file.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/meta/core/write-file.js")>();
  return {
    ...real,
    writeFileAtomic: (path: string, ...rest: Parameters<typeof real.writeFileAtomic> extends [string, ...infer R] ? R : never) =>
      refused.suffix !== undefined && path.endsWith(refused.suffix)
        ? Promise.reject(new Error("no space left on device"))
        : real.writeFileAtomic(path, ...rest),
  };
});

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures", "external-metadata-dir", "writers");
const FRESH = "---\ntitle: Fresh\nreviewer: ada\n---\n\n# Fresh\n";

let repo: string | undefined;
afterEach(() => {
  refused.suffix = undefined;
  removeTempRepo(repo);
  repo = undefined;
});

describe("derive, when a minted page's manifest fails to save", () => {
  it("puts the page back with the values it moved, and fails the run", async () => {
    repo = makeTempRepo({ files: {} });
    cpSync(FIXTURE, repo, { recursive: true });
    writeFileSync(join(repo, "docs/fresh.md"), FRESH);
    commit(repo, "add", { authorDate: "2026-08-20T10:00:00+00:00" });
    refused.suffix = "fresh.yaml";

    const failure = runDerive({ inputs: ["docs/fresh.md"], cwd: repo });
    // DocmetaError is the run's operational error, exit 2.
    await expect(failure).rejects.toBeInstanceOf(DocmetaError);
    await expect(failure).rejects.toThrow("docs/fresh.md was restored.");
    expect(readFileSync(join(repo, "docs/fresh.md"), "utf8")).toBe(FRESH);
    expect(existsSync(join(repo, "metadata", "fresh.yaml"))).toBe(false);
  });
});
