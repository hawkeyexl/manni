/**
 * meta's hold on a manifest it is about to write (`fill`, `derive`), for a
 * per-page manifest that does not exist yet (proposal 0058). A missing
 * per-page file is a page with nothing kept there, so it is held as empty
 * text marked absent and created at the settle. A missing concrete manifest
 * is still the run's problem, as it always was.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  holdManifestFile,
  recordManifestOp,
  settleManifest,
  applyManifestOp,
  type MetaManifestOp,
} from "../src/meta/core/manifest-writes.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-meta-hold-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("holdManifestFile", () => {
  it("holds a missing per-page manifest as empty text, and creates it on settle", async () => {
    const path = join(dir, "docs", "a.citations.yaml");
    const held = await holdManifestFile(path, "docs/a.citations.yaml", true);
    expect(held.before).toBe("");
    expect(held.absent).toBe(true);

    const op: MetaManifestOp = {
      kind: "splice",
      entry: "docs/a.md",
      key: "owner",
      join: "path",
      file: held.file,
      value: "platform",
    };
    recordManifestOp(held, op);
    held.text = applyManifestOp(held.text, op);
    expect(await settleManifest(held)).toBe(true);
    expect(await readFile(path, "utf8")).toBe("docs/a.md:\n  owner: platform\n");
  });

  it("refuses a missing concrete manifest, as before", async () => {
    const path = join(dir, "site.metadata.yaml");
    await expect(holdManifestFile(path, "site.metadata.yaml")).rejects.toThrow(
      /^Manifest site\.metadata\.yaml could not be read: ENOENT/,
    );
  });
});
