/**
 * The compare-and-swap's create case (proposal 0058).
 *
 * A per-page manifest does not exist until its page gets its first entry, so
 * a writer holds it as empty text marked absent. At commit, still missing
 * means create it; created by another writer in between means rebase onto
 * that writer's bytes, even when they are empty. A manifest that was present
 * at hold, or held without the mark, keeps today's refusal when it is gone.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  heldManifest,
  rebaseable,
  settle,
  type ManifestCodec,
  type ManifestOp,
} from "../../src/shared/manifest-cas.js";
import { writeFileAtomic } from "../../src/meta/core/write-file.js";

/** One line per entry: `<entry>: <value>`. Enough to replay and to read back. */
type Op = ManifestOp & { value: string };
const codec: ManifestCodec<Op> = {
  apply(text, op) {
    const lines = text.split("\n").filter((l) => l !== "" && !l.startsWith(`${op.entry}:`));
    return [...lines, `${op.entry}: ${op.value}`, ""].join("\n");
  },
  read(text, at) {
    const line = text.split("\n").find((l) => l.startsWith(`${at.entry}:`));
    return line?.slice(at.entry.length + 2);
  },
};

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-cas-"));
  path = join(dir, "docs", "page.citations.yaml");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const io = {
  codec,
  write: (at: string, text: string): Promise<void> => writeFileAtomic(at, text, { createParents: true }),
  read: (at: string): Promise<string> => readFile(at, "utf8"),
  toError: (message: string): Error => new Error(message),
};

/** Hold a manifest, record one edit on it, and hand it back ready to settle. */
function edited(before: string, absent: boolean, entry: string, value: string) {
  const held = heldManifest<Op>(path, "docs/page.citations.yaml", before, absent);
  const op: Op = { entry, key: "citations", join: "path", file: held.file, value };
  rebaseable(held, op, codec);
  held.ops.push(op);
  held.text = codec.apply(held.text, op);
  return held;
}

describe("settle: the create case", () => {
  it("holds a missing file as empty text, marked absent", () => {
    const held = heldManifest<Op>(path, "docs/page.citations.yaml", "", true);
    expect(held.absent).toBe(true);
    expect(heldManifest<Op>(path, "x", "").absent).toBe(false);
  });

  it("creates a file that is still missing at commit, and clears the mark", async () => {
    const held = edited("", true, "docs/page.md", "a");
    await settle(held, io);
    expect(await readFile(path, "utf8")).toBe("docs/page.md: a\n");
    expect(held.absent).toBe(false);
  });

  it("rebases onto a file another writer created in between, even an empty one", async () => {
    const held = edited("", true, "docs/page.md", "a");
    await mkdir(join(dir, "docs"), { recursive: true });
    // Present and empty is not the same state as absent: the other writer's
    // file is rebased onto rather than overwritten by a blind create.
    await writeFile(path, "", "utf8");
    let reads = 0;
    await settle(held, { ...io, read: (at) => { reads++; return readFile(at, "utf8"); } });
    expect(reads).toBe(2);
    expect(await readFile(path, "utf8")).toBe("docs/page.md: a\n");
    expect(held.absent).toBe(false);
  });

  it("keeps the other writer's entry when both created the same new manifest", async () => {
    const first = edited("", true, "docs/page.md", "first");
    const second = edited("", true, "docs/other.md", "second");
    await settle(first, io);
    await settle(second, io);
    const text = await readFile(path, "utf8");
    expect(text).toContain("docs/page.md: first");
    expect(text).toContain("docs/other.md: second");
  });

  it("refuses a missing file that was not held as absent", async () => {
    const held = edited("docs/page.md: old\n", false, "docs/page.md", "a");
    await expect(settle(held, io)).rejects.toThrow(/Manifest docs\/page\.citations\.yaml could not be read: ENOENT/);
  });
});
