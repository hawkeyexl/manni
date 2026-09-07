import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintCitation } from "../../src/cite/core/mint.js";
import { obfuscatePath } from "../../src/cite/core/sources.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { CiteError } from "../../src/cite/errors.js";
import type { GitClient } from "../../src/cite/types.js";

const require = createRequire(import.meta.url);
const ladder = require("../../docs/proposals/0035/ladders/drift-examples.cjs") as {
  SOURCE: string;
  mint(text: string, l1?: number, l2?: number, salt?: string): string | undefined;
};

const here = dirname(fileURLToPath(import.meta.url));
/** The fixture root: `src/limits.ts` under it is the ladder's SOURCE. */
const ROOT = join(here, "..", "fixtures", "cite");

const SALT = "SALT-LADDER";
const HEAD = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";
const PIN_WHOLE = "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023";
const TOKEN = obfuscatePath("src/limits.ts", SALT);

function fakeGit(opts: { available?: boolean; head?: string | null; files?: string[] } = {}): GitClient {
  const unreachable = () => Promise.reject(new Error("not expected here"));
  return {
    available: () => Promise.resolve(opts.available ?? true),
    head: () => Promise.resolve(opts.head === undefined ? HEAD : opts.head),
    lsFiles: () => Promise.resolve(opts.files ?? ["src/limits.ts", "src/a.txt"]),
    showFile: unreachable,
    subjectsSince: unreachable,
    diffSince: unreachable,
  };
}

describe("mintCitation", () => {
  it("pins one line, records HEAD, and orders the fields id, claim, src, integrity, commit, quote", async () => {
    const c = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      id: "fetch-timeout",
      claim: "The fetch timeout is 10 seconds.",
      quote: true,
      gitClient: fakeGit(),
    });
    expect(c).toEqual({
      id: "fetch-timeout",
      claim: "The fetch timeout is 10 seconds.",
      src: "src/limits.ts:2",
      integrity: PIN_L2,
      commit: HEAD,
      quote: true,
    });
    expect(Object.keys(c)).toEqual(["id", "claim", "src", "integrity", "commit", "quote"]);
  });

  it("carries only the fields it was given", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/limits.ts:1-3", gitClient: fakeGit() });
    expect(c).toEqual({ src: "src/limits.ts:1-3", integrity: PIN_1_3, commit: HEAD });
    expect(Object.keys(c)).toEqual(["src", "integrity", "commit"]);
  });

  it("pins a whole file with the bare path, canonicalising the src", async () => {
    const whole = await mintCitation({ root: ROOT, src: "src/limits.ts", commit: false });
    expect(whole).toEqual({ src: "src/limits.ts", integrity: PIN_WHOLE });
    const one = await mintCitation({ root: ROOT, src: "src/limits.ts:2-2", commit: false });
    expect(one.src).toBe("src/limits.ts:2");
    expect(one.integrity).toBe(PIN_L2);
  });

  it("walks the root when no git client is given, and records no commit", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/a.txt:12" });
    expect(c).toEqual({ src: "src/a.txt:12", integrity: hashRange("line 12\n") });
  });

  it("records no commit under commit: false, or when git has no HEAD, or no git", async () => {
    expect(await mintCitation({ root: ROOT, src: "src/limits.ts:2", commit: false, gitClient: fakeGit() })).toEqual({
      src: "src/limits.ts:2",
      integrity: PIN_L2,
    });
    expect(
      await mintCitation({ root: ROOT, src: "src/limits.ts:2", gitClient: fakeGit({ head: null }) }),
    ).toEqual({ src: "src/limits.ts:2", integrity: PIN_L2 });
    expect(
      await mintCitation({ root: ROOT, src: "src/limits.ts:2", gitClient: fakeGit({ available: false }) }),
    ).toEqual({ src: "src/limits.ts:2", integrity: PIN_L2 });
  });

  it("records the commit it is given, seven to forty hex", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/limits.ts:2", commit: "3f9c2a1", gitClient: fakeGit() });
    expect(c.commit).toBe("3f9c2a1");
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:2", commit: "3f9c2a", gitClient: fakeGit() }),
    ).rejects.toThrow(CiteError);
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:2", commit: "3F9C2A1", gitClient: fakeGit() }),
    ).rejects.toThrow(/Invalid commit "3F9C2A1"/);
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:2", commit: `${HEAD}0`, gitClient: fakeGit() }),
    ).rejects.toThrow(CiteError);
  });

  it("obfuscates the src and keys the pin with the salt", async () => {
    const c = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      obfuscate: true,
      salt: SALT,
      commit: false,
    });
    expect(c).toEqual({ src: `${TOKEN}:2`, integrity: ladder.mint(ladder.SOURCE, 2, 2, SALT) });
    expect(c.integrity).not.toBe(PIN_L2);
    expect(JSON.stringify(c)).not.toContain("limits");
  });

  it("keys with the empty salt when obfuscating without one", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/limits.ts:1-3", obfuscate: true, commit: false });
    expect(c).toEqual({
      src: `${obfuscatePath("src/limits.ts", "")}:1-3`,
      integrity: ladder.mint(ladder.SOURCE, 1, 3, ""),
    });
  });

  it("accepts a src that is already a token, resolving it through the index and keeping it", async () => {
    const c = await mintCitation({ root: ROOT, src: `${TOKEN}:2`, salt: SALT, commit: false });
    expect(c).toEqual({ src: `${TOKEN}:2`, integrity: ladder.mint(ladder.SOURCE, 2, 2, SALT) });
    const explicit = await mintCitation({ root: ROOT, src: `${TOKEN}:2`, salt: SALT, obfuscate: true, commit: false });
    expect(explicit).toEqual(c);
  });

  it("uses a given source index instead of building one", async () => {
    const index = {
      files: () => Object.freeze(["src/limits.ts"]),
      resolve: () => undefined,
      has: (p: string) => p === "src/limits.ts",
    };
    const c = await mintCitation({ root: ROOT, src: "src/limits.ts:2", commit: false, sourceIndex: index });
    expect(c.integrity).toBe(PIN_L2);
    await expect(
      mintCitation({ root: ROOT, src: "src/a.txt:1", commit: false, sourceIndex: index }),
    ).rejects.toThrow("Source not found: src/a.txt is not a tracked file under the root.");
  });

  it("refuses a range past the end of the file, naming the path", async () => {
    await expect(mintCitation({ root: ROOT, src: "src/limits.ts:1-9", commit: false })).rejects.toThrow(CiteError);
    await expect(mintCitation({ root: ROOT, src: "src/limits.ts:1-9", commit: false })).rejects.toThrow(
      "src/limits.ts has 7 lines; line 9 is out of range.",
    );
  });

  it("refuses a source the index does not hold", async () => {
    await expect(
      mintCitation({ root: ROOT, src: "src/nope.ts:1", commit: false, gitClient: fakeGit() }),
    ).rejects.toThrow("Source not found: src/nope.ts is not a tracked file under the root.");
    // Present on disk, but not tracked.
    await expect(
      mintCitation({ root: ROOT, src: "src/a.txt:1", commit: false, gitClient: fakeGit({ files: ["src/limits.ts"] }) }),
    ).rejects.toThrow("Source not found: src/a.txt is not a tracked file under the root.");
  });

  it("refuses a token nothing matches, without naming any path", async () => {
    const wrong = obfuscatePath("src/limits.ts", "wrong");
    await expect(mintCitation({ root: ROOT, src: `${wrong}:2`, salt: SALT, commit: false })).rejects.toThrow(
      `No tracked file matches ${wrong} (wrong --root or salt?).`,
    );
  });

  it("refuses bad src grammar before touching the root", async () => {
    await expect(mintCitation({ root: ROOT, src: "/abs:1", commit: false })).rejects.toThrow(/^Invalid src/);
    await expect(mintCitation({ root: ROOT, src: "src/limits.ts:3-1", commit: false })).rejects.toThrow(
      'Invalid range "src/limits.ts:3-1": end line 1 is before start line 3.',
    );
  });
});
