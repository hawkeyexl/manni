/**
 * `reencryptCitations`: one page's encrypted citations re-encrypted under a
 * new key, for `manni key rotate`. Each case works over a throwaway root that
 * holds the ladder SOURCE at `src/limits.ts`, indexed by a walk unless it
 * needs history, with fixed keys and never the developer's environment.
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
const CHANGED = "changed; run `manni cite update --accept` before rotating";

let root: string | undefined;
afterEach(() => {
  removeTempRepo(root);
  root = undefined;
});

function repo(init = false): string {
  root = makeTempRepo({ init, files: { [PATH]: ladder.SOURCE } });
  return root;
}

/** The keyed pin over line 2 of `text` (the ladder SOURCE unless given). */
const pinUnder = (key: string, text = ladder.SOURCE): string => hashRange(text, LINE_2, key);

/** A page with one frontmatter entry. */
const onePage = (src: string, integrity: string, extra = ""): string =>
  `---\ncitations:\n  - src: ${src}\n    integrity: ${integrity}\n${extra}---\nBody.\n`;

describe("reencryptCitations", () => {
  it("re-encrypts every encrypted citation in both channels, and leaves plain ones alone", async () => {
    const dir = repo();
    const token = encryptSourcePath(PATH, FROM);
    const content = [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      `    src: ${token}:2`,
      `    integrity: ${pinUnder(FROM)}`,
      "    claim: The fetch timeout is 10 seconds.",
      "  - src: src/limits.ts:2",
      `    integrity: ${hashRange(ladder.SOURCE, LINE_2)}`,
      "---",
      "The fetch timeout is 10 seconds.",
      "",
      `<!-- cite {"src": "${token}:1-3", "integrity": "${hashRange(ladder.SOURCE, { start: 1, end: 3 }, FROM)}", "claim": "Retries default to 3."} -->`,
      "Retries default to 3.",
      "",
    ].join("\n");

    const result = await reencryptCitations(
      { file: "docs/limits.md", content },
      { root: dir, fromKey: FROM, toKey: TO, gitClient: noGit() },
    );

    const next = encryptSourcePath(PATH, TO);
    expect(result.skipped).toEqual([]);
    expect(result.rewritten).toEqual([
      { id: "fetch-timeout", index: 0, line: 3, from: `${token}:2`, to: `${next}:2` },
      { line: 12, from: `${token}:1-3`, to: `${next}:1-3` },
    ]);
    expect(result.content).not.toContain(token);
    expect(result.content).toContain(`    src: ${next}:2\n`);
    expect(result.content).toContain(`    integrity: ${pinUnder(TO)}\n`);
    expect(result.content).toContain(
      `<!-- cite {"src": "${next}:1-3", "integrity": "${hashRange(ladder.SOURCE, { start: 1, end: 3 }, TO)}", "claim": "Retries default to 3."} -->`,
    );
    // The plain entry and the body are untouched.
    expect(result.content).toContain("  - src: src/limits.ts:2\n");
    expect(result.content.split("\n").slice(9)).toEqual(content.split("\n").slice(9).map((line) => line.replace(token, next).replace(hashRange(ladder.SOURCE, { start: 1, end: 3 }, FROM), hashRange(ladder.SOURCE, { start: 1, end: 3 }, TO))));

    // The page reads clean under the new key. The report rows name no path:
    // only the plain entry spells one, and it spelled it before.
    const report = await checkCitations({ file: "docs/limits.md", content: result.content }, { root: dir, key: TO, gitClient: noGit() });
    expect(report.citations.map((c) => c.status)).toEqual(["current", "current", "current"]);
    expect(JSON.stringify({ rewritten: result.rewritten, skipped: result.skipped })).not.toContain(PATH);
  });

  it("leaves a citation that already decrypts under the new key, so a rerun is safe", async () => {
    const dir = repo();
    const content = onePage(`${encryptSourcePath(PATH, TO)}:2`, pinUnder(TO));
    const result = await reencryptCitations({ file: "p.md", content }, { root: dir, fromKey: FROM, toKey: TO, gitClient: noGit() });
    expect(result).toEqual({ content, rewritten: [], skipped: [] });
  });

  it("skips a citation that decrypts under neither key", async () => {
    const dir = repo();
    const content = onePage(`${encryptSourcePath(PATH, STRANGER)}:2`, pinUnder(STRANGER));
    const result = await reencryptCitations({ file: "p.md", content }, { root: dir, fromKey: FROM, toKey: TO, gitClient: noGit() });
    expect(result.rewritten).toEqual([]);
    expect(result.skipped).toEqual([{ index: 0, line: 3, message: "does not decrypt under the current key" }]);
    expect(result.content).toBe(content);
  });

  it("skips a citation whose decrypted path is not tracked, without naming it", async () => {
    const dir = repo();
    const content = onePage(`${encryptSourcePath("src/gone.ts", FROM)}:2`, pinUnder(FROM));
    const result = await reencryptCitations({ file: "p.md", content }, { root: dir, fromKey: FROM, toKey: TO, gitClient: noGit() });
    expect(result.skipped).toEqual([{ index: 0, line: 3, message: "missing (no tracked file matches)" }]);
    expect(result.content).toBe(content);
    expect(JSON.stringify(result.skipped)).not.toContain("gone");
  });

  it("skips a citation whose pin no longer holds, naming update --accept as the repair", async () => {
    const dir = repo();
    writeFileSync(join(dir, PATH), ladder.variants.CHANGED ?? "", "utf8");
    const content = onePage(`${encryptSourcePath(PATH, FROM)}:2`, pinUnder(FROM), "    id: fetch-timeout\n");
    const result = await reencryptCitations({ file: "p.md", content }, { root: dir, fromKey: FROM, toKey: TO, gitClient: noGit() });
    expect(result.rewritten).toEqual([]);
    expect(result.skipped).toEqual([{ id: "fetch-timeout", index: 0, line: 3, message: CHANGED }]);
    expect(result.content).toBe(content);
  });

  it("comes back byte for byte when the page has no encrypted citation", async () => {
    const dir = repo();
    const content = onePage("src/limits.ts:2", hashRange(ladder.SOURCE, LINE_2));
    const result = await reencryptCitations({ file: "p.md", content }, { root: dir, fromKey: FROM, toKey: TO, gitClient: noGit() });
    expect(result).toEqual({ content, rewritten: [], skipped: [] });
  });

  it.skipIf(!gitAvailable())("re-keys a changed entry from the lines at its commit, so it stays exactly as changed", async () => {
    const dir = repo(true);
    const first = commitAll(dir, "add limits");
    writeFileSync(join(dir, PATH), ladder.variants.CHANGED ?? "", "utf8");
    commitAll(dir, "raise the timeout");
    const token = encryptSourcePath(PATH, FROM);
    const content = onePage(`${token}:2`, pinUnder(FROM), `    commit: ${first}\n`);
    const git = gitClient(dir);

    const result = await reencryptCitations({ file: "p.md", content }, { root: dir, fromKey: FROM, toKey: TO, gitClient: git });
    expect(result.skipped).toEqual([]);
    expect(result.rewritten).toEqual([
      { index: 0, line: 3, from: `${token}:2`, to: `${encryptSourcePath(PATH, TO)}:2` },
    ]);
    expect(result.content).toContain(`    integrity: ${pinUnder(TO)}\n`);
    const report = await checkCitations({ file: "p.md", content: result.content }, { root: dir, key: TO, gitClient: git });
    expect(report.citations.map((c) => c.status)).toEqual(["changed"]);

    // Without git the same entry has no lines to be re-keyed from.
    const blind = await reencryptCitations({ file: "p.md", content }, { root: dir, fromKey: FROM, toKey: TO, gitClient: noGit() });
    expect(blind.skipped).toEqual([{ index: 0, line: 3, message: CHANGED }]);
  });
});
