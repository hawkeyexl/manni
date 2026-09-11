/**
 * `mintCitation` mints the whole entry: the claim end is handed in already
 * pinned, and the source end is read, hashed and dated here. What it returns
 * is what `add` writes, so the field order of both the entry and its `source`
 * block is asserted, not just its contents.
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mintCitation } from "../../src/cite/core/mint.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { CiteError } from "../../src/cite/errors.js";
import type { GitClient } from "../../src/cite/types.js";

const require = createRequire(import.meta.url);
const ladder = require("../../docs/proposals/0044/ladders/drift-examples.cjs") as {
  SOURCE: string;
  mint(text: string, l1?: number, l2?: number, key?: string): string | undefined;
};

const here = dirname(fileURLToPath(import.meta.url));
/** The fixture root: `src/limits.ts` under it is the ladder's SOURCE. */
const ROOT = join(here, "..", "fixtures", "cite");

/** Fixed test keys; never the developer's environment. */
const KEY = "mint-key-0123456789abcdef0123456789ab";
const OTHER = "another-key-0123456789abcdef012345";
const HEAD = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_1_3 = "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6";
const PIN_WHOLE = "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023";
const TOKEN = encryptSourcePath("src/limits.ts", KEY);
const LINE_2 = "export const FETCH_TIMEOUT_MS = 10_000;";
/** The keyed pin line 2 carries once its file is encrypted, as the ladder mints it. */
const KEYED_L2 = ladder.mint(ladder.SOURCE, 2, 2, KEY) ?? "";
/** A claim, already pinned by the caller over the page lines. */
const CLAIM = {
  lines: 3,
  integrity: "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094",
};

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
  it("pins one line, records HEAD, and orders the entry id, claim, source, quote", async () => {
    const c = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      id: "fetch-timeout",
      claim: CLAIM,
      quote: true,
      gitClient: fakeGit(),
    });
    expect(c).toEqual({
      id: "fetch-timeout",
      claim: CLAIM,
      source: {
        file: "src/limits.ts",
        lines: 2,
        integrity: PIN_L2,
        "commit-sha": HEAD,
      },
      quote: true,
    });
    expect(Object.keys(c)).toEqual(["id", "claim", "source", "quote"]);
  });

  it("orders the source file, lines, integrity, commit-sha", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/limits.ts:1-3", gitClient: fakeGit() });
    expect(Object.keys(c.source)).toEqual(["file", "lines", "integrity", "commit-sha"]);
  });

  it("carries only the fields it was given", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/limits.ts:1-3", gitClient: fakeGit() });
    expect(c).toEqual({
      source: { file: "src/limits.ts", lines: "1-3", integrity: PIN_1_3, "commit-sha": HEAD },
    });
    expect(Object.keys(c)).toEqual(["source"]);
  });

  it("passes a marker-anchored claim through, lines and all absent", async () => {
    const claim = { integrity: CLAIM.integrity };
    const c = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      id: "fetch-timeout",
      claim,
      commitSha: false,
    });
    expect(c.claim).toEqual(claim);
    expect(c.claim?.lines).toBeUndefined();
    expect(Object.keys(c)).toEqual(["id", "claim", "source"]);
  });

  it("pins a whole file with the bare path, and writes no lines for it", async () => {
    const whole = await mintCitation({ root: ROOT, src: "src/limits.ts", commitSha: false });
    expect(whole).toEqual({ source: { file: "src/limits.ts", integrity: PIN_WHOLE } });
    expect(whole.source.lines).toBeUndefined();
  });

  it("writes a one-line range as the integer it is", async () => {
    const one = await mintCitation({ root: ROOT, src: "src/limits.ts:2-2", commitSha: false });
    expect(one.source.lines).toBe(2);
    expect(one.source.integrity).toBe(PIN_L2);
  });

  it("walks the root when no git client is given, and records no commit", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/a.txt:12" });
    expect(c).toEqual({ source: { file: "src/a.txt", lines: 12, integrity: hashRange("line 12\n") } });
  });

  it("records no commit under commitSha: false, or when git has no HEAD, or no git", async () => {
    const bare = { file: "src/limits.ts", lines: 2, integrity: PIN_L2 };
    expect(
      await mintCitation({ root: ROOT, src: "src/limits.ts:2", commitSha: false, gitClient: fakeGit() }),
    ).toEqual({ source: bare });
    expect(
      await mintCitation({ root: ROOT, src: "src/limits.ts:2", gitClient: fakeGit({ head: null }) }),
    ).toEqual({ source: bare });
    expect(
      await mintCitation({ root: ROOT, src: "src/limits.ts:2", gitClient: fakeGit({ available: false }) }),
    ).toEqual({ source: bare });
  });

  it("records the commit-sha it is given, seven to sixty-four hex", async () => {
    const short = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      commitSha: "3f9c2a1",
      gitClient: fakeGit(),
    });
    expect(short.source["commit-sha"]).toBe("3f9c2a1");
    const long = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      commitSha: "a".repeat(64),
      gitClient: fakeGit(),
    });
    expect(long.source["commit-sha"]).toBe("a".repeat(64));
  });

  it("refuses a commit-sha that is too short, uppercase, or too long", async () => {
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:2", commitSha: "3f9c2a", gitClient: fakeGit() }),
    ).rejects.toThrow(CiteError);
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:2", commitSha: "3F9C2A1", gitClient: fakeGit() }),
    ).rejects.toThrow('Invalid commit-sha "3F9C2A1": expected 7 to 64 lowercase hex digits.');
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:2", commitSha: "a".repeat(65), gitClient: fakeGit() }),
    ).rejects.toThrow(CiteError);
  });

  it("encrypts the file and keys the pin under the key", async () => {
    const c = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      encrypt: true,
      key: KEY,
      commitSha: false,
    });
    expect(c).toEqual({
      source: { file: TOKEN, lines: 2, integrity: KEYED_L2 },
    });
    expect(c.source.integrity.startsWith("hmac-sha256-")).toBe(true);
    expect(c.source.integrity).not.toBe(PIN_L2);
    expect(JSON.stringify(c)).not.toContain("limits");
  });

  it("keys the pin as the proposal's own reference implementation does", () => {
    // The ladder is the contract src/cite must agree with, not the other way
    // round, so the keyed pin is read from it rather than restated here.
    expect(KEYED_L2).toBe(hashRange(LINE_2, undefined, KEY));
    expect(KEYED_L2.startsWith("hmac-sha256-")).toBe(true);
  });

  it("writes a plain file unless told to encrypt, whatever the key", async () => {
    const c = await mintCitation({ root: ROOT, src: "src/limits.ts:2", key: KEY, commitSha: false });
    expect(c).toEqual({ source: { file: "src/limits.ts", lines: 2, integrity: PIN_L2 } });
  });

  it("refuses to encrypt with no key, naming the src as typed", async () => {
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:1-3", encrypt: true, commitSha: false }),
    ).rejects.toThrow(
      "src/limits.ts:1-3 must be encrypted, and no encryption key is available. Run `manni key set`, or set MANNI_ENCRYPTION_KEY.",
    );
  });

  it("accepts a src that is already encrypted, decrypting it under the key and keeping it", async () => {
    const c = await mintCitation({ root: ROOT, src: `${TOKEN}:2`, key: KEY, commitSha: false });
    expect(c).toEqual({
      source: { file: TOKEN, lines: 2, integrity: KEYED_L2 },
    });
    const explicit = await mintCitation({
      root: ROOT,
      src: `${TOKEN}:2`,
      key: KEY,
      encrypt: true,
      commitSha: false,
    });
    expect(explicit).toEqual(c);
  });

  it("uses a given source index instead of building one", async () => {
    const index = {
      files: () => Object.freeze(["src/limits.ts"]),
      has: (p: string) => p === "src/limits.ts",
    };
    const c = await mintCitation({
      root: ROOT,
      src: "src/limits.ts:2",
      commitSha: false,
      sourceIndex: index,
    });
    expect(c.source.integrity).toBe(PIN_L2);
    await expect(
      mintCitation({ root: ROOT, src: "src/a.txt:1", commitSha: false, sourceIndex: index }),
    ).rejects.toThrow("Source not found: src/a.txt is not a tracked file under the root.");
  });

  it("refuses a range past the end of the file, naming the path", async () => {
    await expect(mintCitation({ root: ROOT, src: "src/limits.ts:1-9", commitSha: false })).rejects.toThrow(
      CiteError,
    );
    await expect(mintCitation({ root: ROOT, src: "src/limits.ts:1-9", commitSha: false })).rejects.toThrow(
      "src/limits.ts has 7 lines; line 9 is out of range.",
    );
  });

  it("refuses a source the index does not hold", async () => {
    await expect(
      mintCitation({ root: ROOT, src: "src/nope.ts:1", commitSha: false, gitClient: fakeGit() }),
    ).rejects.toThrow("Source not found: src/nope.ts is not a tracked file under the root.");
    // Present on disk, but not tracked.
    await expect(
      mintCitation({
        root: ROOT,
        src: "src/a.txt:1",
        commitSha: false,
        gitClient: fakeGit({ files: ["src/limits.ts"] }),
      }),
    ).rejects.toThrow("Source not found: src/a.txt is not a tracked file under the root.");
  });

  it("refuses a src another key encrypted, without naming any path", async () => {
    const wrong = encryptSourcePath("src/limits.ts", OTHER);
    await expect(
      mintCitation({ root: ROOT, src: `${wrong}:2`, key: KEY, commitSha: false }),
    ).rejects.toThrow(`${wrong} does not decrypt under the current key.`);
  });

  it("refuses an encrypted src with no key to decrypt it", async () => {
    await expect(mintCitation({ root: ROOT, src: `${TOKEN}:2`, commitSha: false })).rejects.toThrow(
      `${TOKEN} is encrypted, and no encryption key is available to decrypt it.`,
    );
  });

  it("refuses an encrypted src whose path is not tracked, without naming the path", async () => {
    const untracked = encryptSourcePath("src/nope.ts", KEY);
    await expect(
      mintCitation({ root: ROOT, src: `${untracked}:1`, key: KEY, commitSha: false }),
    ).rejects.toThrow(`No tracked file matches ${untracked} (wrong --root?).`);
  });

  it("refuses bad src grammar before touching the root", async () => {
    await expect(mintCitation({ root: ROOT, src: "/abs:1", commitSha: false })).rejects.toThrow(
      /^Invalid src/,
    );
    await expect(
      mintCitation({ root: ROOT, src: "src/limits.ts:3-1", commitSha: false }),
    ).rejects.toThrow('Invalid range "src/limits.ts:3-1": end line 1 is before start line 3.');
  });
});
