/**
 * `reencryptCitations`: one page's encrypted citations re-encrypted under a
 * new key, for `manni key rotate`. Each case works over a throwaway root that
 * holds the ladder SOURCE at `src/limits.ts`, indexed by a walk unless it
 * needs history, with fixed keys and never the developer's environment.
 *
 * An entry has two ends (proposal 0044), and only the source end is ever
 * touched: `source.file` becomes the path's ciphertext under the new key and
 * `source.integrity` the keyed pin under it. A `claim` is pinned plain, so it
 * comes back byte for byte.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkCitations } from "../../src/cite/core/check-page.js";
import { gitClient, noGit } from "../../src/cite/core/git.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { reencryptCitations } from "../../src/cite/index.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const require = createRequire(import.meta.url);
const ladder = require("../../docs/proposals/0044/ladders/drift-examples.cjs") as {
  SOURCE: string;
  variants: Record<string, string>;
};

const FROM = "rotate-from-key-0123456789abcdef0123";
const TO = "rotate-to-key-0123456789abcdef012345";
const STRANGER = "stranger-key-0123456789abcdef0123456";
const PATH = "src/limits.ts";
const LINE_2 = { start: 2, end: 2 };

const UNDECRYPTABLE = "does not decrypt under the current key";
const MISSING = "missing (no tracked file matches)";
const CHANGED = "changed; run `manni cite update --accept` before rotating";

/** The page body. Its one line is what a `claim` of `lines: 1` pins. */
const BODY = "The fetch timeout is 10 seconds.";
const CLAIM_PIN = hashRange(`${BODY}\n`, { start: 1, end: 1 });

let root: string | undefined;
afterEach(() => {
  removeTempRepo(root);
  root = undefined;
});

function repo(init = false): string {
  root = makeTempRepo({ init, files: { [PATH]: ladder.SOURCE } });
  return root;
}

/** The pin over line 2 of `text` (the ladder SOURCE unless given): keyed with a key, plain without. */
const pinUnder = (key: string | undefined, text = ladder.SOURCE): string =>
  hashRange(text, LINE_2, key);

/** One `citations` entry, as the schema spells it: two ends, each lines and a pin. */
interface Entry {
  id?: string;
  /** A path, or the `~` ciphertext of one. */
  file: string;
  /** Source lines. Absent pins the whole file. */
  lines?: number | string;
  integrity: string;
  "commit-sha"?: string;
  /** A claim over body line 1, always pinned plain. */
  claim?: boolean;
}

function entryLines(entry: Entry): string[] {
  const lines: string[] = [];
  if (entry.id === undefined) {
    lines.push("  - source:");
  } else {
    lines.push(`  - id: ${entry.id}`);
    if (entry.claim === true) lines.push("    claim:", "      lines: 1", `      integrity: ${CLAIM_PIN}`);
    lines.push("    source:");
  }
  lines.push(`      file: ${entry.file}`);
  if (entry.lines !== undefined) lines.push(`      lines: ${String(entry.lines)}`);
  lines.push(`      integrity: ${entry.integrity}`);
  const commit = entry["commit-sha"];
  if (commit !== undefined) lines.push(`      commit-sha: ${commit}`);
  return lines;
}

/** A page whose frontmatter carries `entries`, in order. */
const pageOf = (...entries: Entry[]): string =>
  ["---", "citations:", ...entries.flatMap(entryLines), "---", BODY, ""].join("\n");

/** One encrypted entry over line 2, the shape most cases want. */
const encryptedEntry = (fileKey: string, pinKey: string, id?: string): Entry => ({
  ...(id === undefined ? {} : { id }),
  file: encryptSourcePath(PATH, fileKey),
  lines: 2,
  integrity: pinUnder(pinKey),
});

const rotatePage = (
  content: string,
  opts: { root: string; fromKey?: string; toKey?: string; git?: ReturnType<typeof noGit> },
): ReturnType<typeof reencryptCitations> =>
  reencryptCitations(
    { file: "docs/limits.md", content },
    {
      root: opts.root,
      fromKey: opts.fromKey ?? FROM,
      toKey: opts.toKey ?? TO,
      gitClient: opts.git ?? noGit(),
    },
  );

/** Every source status the page reports under `key`. */
async function sourceStatuses(dir: string, content: string, key: string): Promise<string[]> {
  const report = await checkCitations(
    { file: "docs/limits.md", content },
    { root: dir, key, gitClient: noGit() },
  );
  return report.citations.map((c) => c.source.status);
}

describe("reencryptCitations", () => {
  it("rewrites both source.file and source.integrity, leaving the claim and a plain entry alone", async () => {
    const dir = repo();
    const token = encryptSourcePath(PATH, FROM);
    const next = encryptSourcePath(PATH, TO);
    const content = pageOf(
      { id: "fetch-timeout", file: token, lines: 2, integrity: pinUnder(FROM), claim: true },
      { file: PATH, lines: 2, integrity: pinUnder(undefined) },
    );

    const result = await rotatePage(content, { root: dir });

    expect(result.skipped).toEqual([]);
    expect(result.rewritten).toEqual([
      { id: "fetch-timeout", index: 0, line: 3, from: `${token}:2`, to: `${next}:2` },
    ]);
    // Both halves of the source end moved, and nothing else on the page did.
    expect(result.content).toContain(`      file: ${next}\n`);
    expect(result.content).toContain(`      integrity: ${pinUnder(TO)}\n`);
    expect(result.content).not.toContain(token);
    expect(result.content).not.toContain(pinUnder(FROM));
    expect(result.content).toContain(`      integrity: ${CLAIM_PIN}\n`);
    expect(result.content).toContain(`      file: ${PATH}\n`);
    expect(result.content).toContain(`      integrity: ${pinUnder(undefined)}\n`);
    expect(result.content.endsWith(`---\n${BODY}\n`)).toBe(true);

    // The page reads clean under the new key, and the report names no path:
    // only the plain entry spells one, and it spelled it before.
    expect(await sourceStatuses(dir, result.content, TO)).toEqual(["current", "current"]);
    expect(JSON.stringify({ rewritten: result.rewritten, skipped: result.skipped })).not.toContain(PATH);
  });

  it("leaves a citation whose file and pin are both under the new key, so a rerun is safe", async () => {
    const dir = repo();
    const content = pageOf(encryptedEntry(TO, TO, "fetch-timeout"));
    const result = await rotatePage(content, { root: dir });
    expect(result).toEqual({ content, rewritten: [], skipped: [] });
  });

  it("re-keys the pin in place when the file is under the new key but the pin is not", async () => {
    const dir = repo();
    const token = encryptSourcePath(PATH, TO);
    // The half rotation meta's walker can leave: the source was re-encrypted
    // without its keyed pin being re-taken.
    const content = pageOf(encryptedEntry(TO, FROM, "fetch-timeout"));
    expect(content).toContain(pinUnder(FROM));

    const result = await rotatePage(content, { root: dir });

    expect(result.skipped).toEqual([]);
    // The source is already spelled the way it will stay, so `from` is `to`.
    expect(result.rewritten).toEqual([
      { id: "fetch-timeout", index: 0, line: 3, from: `${token}:2`, to: `${token}:2` },
    ]);
    expect(result.content).toContain(`      file: ${token}\n`);
    expect(result.content).toContain(`      integrity: ${pinUnder(TO)}\n`);
    expect(result.content).not.toContain(pinUnder(FROM));
    expect(await sourceStatuses(dir, result.content, TO)).toEqual(["current"]);
    // And a third run over the finished page rewrites nothing.
    const again = await rotatePage(result.content, { root: dir });
    expect(again).toEqual({ content: result.content, rewritten: [], skipped: [] });
  });

  it("keeps a whole-file encrypted source whole, pinning the whole file again", async () => {
    const dir = repo();
    const token = encryptSourcePath(PATH, FROM);
    const next = encryptSourcePath(PATH, TO);
    const content = pageOf({ file: token, integrity: hashRange(ladder.SOURCE, undefined, FROM) });

    const result = await rotatePage(content, { root: dir });

    expect(result.rewritten).toEqual([{ index: 0, line: 3, from: token, to: next }]);
    expect(result.content).toContain(`      file: ${next}\n`);
    expect(result.content).toContain(`      integrity: ${hashRange(ladder.SOURCE, undefined, TO)}\n`);
    expect(result.content).not.toContain("lines:");
  });

  it("skips a citation that decrypts under neither key", async () => {
    const dir = repo();
    const content = pageOf(encryptedEntry(STRANGER, STRANGER));
    const result = await rotatePage(content, { root: dir });
    expect(result.rewritten).toEqual([]);
    expect(result.skipped).toEqual([{ index: 0, line: 3, message: UNDECRYPTABLE }]);
    expect(result.content).toBe(content);
  });

  it("skips a citation whose decrypted path is not tracked, without naming it", async () => {
    const dir = repo();
    const content = pageOf({
      file: encryptSourcePath("src/gone.ts", FROM),
      lines: 2,
      integrity: pinUnder(FROM),
    });
    const result = await rotatePage(content, { root: dir });
    expect(result.skipped).toEqual([{ index: 0, line: 3, message: MISSING }]);
    expect(result.content).toBe(content);
    expect(JSON.stringify(result.skipped)).not.toContain("gone");
  });

  it("skips a citation whose pin no longer holds, naming update --accept as the repair", async () => {
    const dir = repo();
    writeFileSync(join(dir, PATH), ladder.variants.CHANGED ?? "", "utf8");
    const content = pageOf(encryptedEntry(FROM, FROM, "fetch-timeout"));
    const result = await rotatePage(content, { root: dir });
    expect(result.rewritten).toEqual([]);
    expect(result.skipped).toEqual([{ id: "fetch-timeout", index: 0, line: 3, message: CHANGED }]);
    expect(result.content).toBe(content);
  });

  it("rewrites what it can and skips the rest, keeping each entry's own index", async () => {
    const dir = repo();
    const content = pageOf(
      encryptedEntry(STRANGER, STRANGER, "stranger"),
      encryptedEntry(FROM, FROM, "fetch-timeout"),
    );
    const result = await rotatePage(content, { root: dir });
    expect(result.skipped).toEqual([
      { id: "stranger", index: 0, line: 3, message: UNDECRYPTABLE },
    ]);
    expect(result.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 1,
        line: 8,
        from: `${encryptSourcePath(PATH, FROM)}:2`,
        to: `${encryptSourcePath(PATH, TO)}:2`,
      },
    ]);
    expect(result.content).toContain(encryptSourcePath(PATH, STRANGER));
    expect(result.content).toContain(`      integrity: ${pinUnder(TO)}\n`);
  });

  it("comes back byte for byte when the page has no encrypted citation, costing no index", async () => {
    const dir = repo();
    const content = pageOf({ file: PATH, lines: 2, integrity: pinUnder(undefined) });
    // A root that does not exist: building an index over it would throw, so a
    // clean return proves nothing was indexed.
    const result = await reencryptCitations(
      { file: "docs/limits.md", content },
      { root: join(dir, "nowhere"), fromKey: FROM, toKey: TO },
    );
    expect(result).toEqual({ content, rewritten: [], skipped: [] });
  });

  it.skipIf(!gitAvailable())(
    "re-keys a changed entry from the lines at its commit-sha, so it stays exactly as changed",
    async () => {
      const dir = repo(true);
      const first = commitAll(dir, "add limits");
      writeFileSync(join(dir, PATH), ladder.variants.CHANGED ?? "", "utf8");
      commitAll(dir, "raise the timeout");
      const token = encryptSourcePath(PATH, FROM);
      const content = pageOf({ ...encryptedEntry(FROM, FROM), "commit-sha": first });
      const git = gitClient(dir);

      const result = await reencryptCitations(
        { file: "docs/limits.md", content },
        { root: dir, fromKey: FROM, toKey: TO, gitClient: git },
      );
      expect(result.skipped).toEqual([]);
      expect(result.rewritten).toEqual([
        { index: 0, line: 3, from: `${token}:2`, to: `${encryptSourcePath(PATH, TO)}:2` },
      ]);
      expect(result.content).toContain(`      integrity: ${pinUnder(TO)}\n`);
      const report = await checkCitations(
        { file: "docs/limits.md", content: result.content },
        { root: dir, key: TO, gitClient: git },
      );
      expect(report.citations.map((c) => c.source.status)).toEqual(["changed"]);

      // Without git the same entry has no lines to be re-keyed from.
      const blind = await rotatePage(content, { root: dir });
      expect(blind.skipped).toEqual([{ index: 0, line: 3, message: CHANGED }]);
    },
  );
});
