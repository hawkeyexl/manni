/**
 * Proposal 0055: following a source across files, and inside a changed range.
 *
 * Both searches turn on what git can show, so every case here is built with
 * real commits in a throwaway repository rather than from a static tree. The
 * material is the `src/` fixtures: `limits.ts` is the cited file,
 * `changed.ts` the same file edited, and `grown-range.ts` the same file with
 * two comment lines inserted *inside* the cited function, which is the case
 * that re-pinned the wrong lines before this proposal.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { messageFor } from "../../src/cite/core/adapt.js";
import { classifyCitation } from "../../src/cite/core/classify.js";
import { gitClient } from "../../src/cite/core/git.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { buildSourceIndex, encryptSourcePath } from "../../src/cite/core/sources.js";
import type { Citation, PageCitation, SourceEnd } from "../../src/cite/types.js";
import {
  commitAll,
  git,
  gitAvailable,
  makeTempRepo,
  removeTempRepo,
  writeFile,
} from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "fixtures", "cite", "src");
const source = (name: string): string => readFileSync(join(SRC, name), "utf8");

const LIMITS = source("limits.ts");
/** `limits.ts` line 2. */
const PIN_L2 = hashRange(LIMITS, { start: 2, end: 2 });
/** `limits.ts` lines 5-7: the whole `limits()` function. */
const PIN_FN = hashRange(LIMITS, { start: 5, end: 7 });
/** The whole of `limits.ts`. */
const PIN_FILE = hashRange(LIMITS);
/** A fixed test key; never the developer's environment. */
const KEY = "follow-key-0123456789abcdef0123456789";

function entry(
  file: string,
  lines: string | number | undefined,
  integrity: string,
  commit?: string,
): PageCitation {
  const citation: Citation = { id: "pinned", source: { file, integrity } };
  if (lines !== undefined) citation.source.lines = lines;
  if (commit !== undefined) citation.source["commit-sha"] = commit;
  return { citation, origin: { kind: "frontmatter", file: "docs/limits.md", index: 0, line: 3 } };
}

/** `git mv`, with the destination directory made first. */
function move(repo: string, from: string, to: string): void {
  mkdirSync(dirname(join(repo, to)), { recursive: true });
  git(repo, ["mv", from, to]);
}

async function classify(repo: string, page: PageCitation, key?: string): Promise<SourceEnd> {
  const client = gitClient(repo);
  const index = await buildSourceIndex(repo, { gitClient: client });
  return classifyCitation(page, {
    root: repo,
    index,
    git: client,
    ...(key === undefined ? {} : { key }),
  });
}

describe.skipIf(!gitAvailable())("a source that moved to another file", () => {
  let repo: string | undefined;
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("follows a file renamed with no edit, and names the new path", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    move(repo, "src/limits.ts", "src/core/limits.ts");
    commitAll(repo, "move limits into core");

    const result = await classify(repo, entry("src/limits.ts", 2, PIN_L2, first));
    expect(result.status).toBe("moved");
    expect(result.newSrc).toBe("src/core/limits.ts:2");
    expect(result.newLines).toBe("2");
    expect(messageFor(result)).toBe("moved -> src/core/limits.ts:2");
  });

  it("follows a whole-file pin, which has no lines to rewrite", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    move(repo, "src/limits.ts", "src/core/limits.ts");
    commitAll(repo, "move limits into core");

    const result = await classify(repo, entry("src/limits.ts", undefined, PIN_FILE, first));
    expect(result.status).toBe("moved");
    expect(result.newSrc).toBe("src/core/limits.ts");
    expect(result.newLines).toBeUndefined();
  });

  it("follows a pin out of a file that is still there", async () => {
    // The #49 case: one function left `check.ts` for `sources.ts`, byte for
    // byte, and the file it left is still on disk.
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    const lines = LIMITS.split("\n");
    writeFile(repo, "src/limits.ts", lines.slice(0, 4).join("\n") + "\n");
    writeFile(repo, "src/core/limits.ts", lines.slice(4).join("\n"));
    commitAll(repo, "split limits");

    const result = await classify(repo, entry("src/limits.ts", "5-7", PIN_FN, first));
    expect(result.status).toBe("moved");
    expect(result.newSrc).toBe("src/core/limits.ts:1-3");
  });

  it("refuses to pick between two files holding the pin", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    move(repo, "src/limits.ts", "src/core/limits.ts");
    writeFile(repo, "vendor/limits.ts", LIMITS);
    commitAll(repo, "move limits and vendor a copy");

    const result = await classify(repo, entry("src/limits.ts", 2, PIN_L2, first));
    expect(result.status).toBe("moved-ambiguous");
    expect(result.candidates).toEqual(["src/core/limits.ts:2", "vendor/limits.ts:2"]);
  });

  it("does not follow a move that is only in the working tree", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    move(repo, "src/limits.ts", "src/core/limits.ts");
    // Staged, never committed: `git diff <commit> HEAD` names neither path.
    const result = await classify(repo, entry("src/limits.ts", 2, PIN_L2, first));
    expect(result.status).toBe("missing");
  });

  it("leaves a renamed and edited file missing, because the pin is gone", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    git(repo, ["rm", "-q", "src/limits.ts"]);
    writeFile(repo, "src/core/limits.ts", source("changed.ts"));
    commitAll(repo, "move limits and raise the timeout");

    const result = await classify(repo, entry("src/limits.ts", 2, PIN_L2, first));
    expect(result.status).toBe("missing");
  });

  it("leaves an untracked destination missing", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS, ".gitignore": "drafts/\n" } });
    const first = commitAll(repo, "add limits");
    git(repo, ["rm", "-q", "src/limits.ts"]);
    writeFile(repo, "drafts/limits.ts", LIMITS);
    commitAll(repo, "park limits in drafts");

    const result = await classify(repo, entry("src/limits.ts", 2, PIN_L2, first));
    expect(result.status).toBe("missing");
  });

  it("needs a commit git can show: without one nothing is followed", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    commitAll(repo, "add limits");
    move(repo, "src/limits.ts", "src/core/limits.ts");
    commitAll(repo, "move limits into core");

    const none = await classify(repo, entry("src/limits.ts", 2, PIN_L2));
    expect(none.status).toBe("missing");
    const unknown = await classify(
      repo,
      entry("src/limits.ts", 2, PIN_L2, "0123456789abcdef0123456789abcdef01234567"),
    );
    expect(unknown.status).toBe("missing");
  });

  it("drops the missing reason once the pin turns up at another path", async () => {
    // The old path was gone, so `readSource` recorded why. The verdict is no
    // longer `missing`, so the reason has no business travelling with it.
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    move(repo, "src/limits.ts", "src/core/limits.ts");
    commitAll(repo, "move limits into core");

    const result = await classify(repo, entry("src/limits.ts", 2, PIN_L2, first));
    expect(result.status).toBe("moved");
    expect(result.missingReason).toBeUndefined();
  });

  it("writes an encrypted source's new path encrypted, and names it nowhere else", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    move(repo, "src/limits.ts", "src/core/limits.ts");
    commitAll(repo, "move limits into core");

    const keyed = hashRange(LIMITS, { start: 2, end: 2 }, KEY);
    const token = encryptSourcePath("src/limits.ts", KEY);
    const result = await classify(repo, entry(token, 2, keyed, first), KEY);
    expect(result.status).toBe("moved");
    expect(result.newSrc).toBe(`${encryptSourcePath("src/core/limits.ts", KEY)}:2`);
    expect(result.newSrc).not.toContain("src/core/limits.ts");
    // Pretty-only, and only under `--reveal`.
    expect(result.resolvedNewPath).toBe("src/core/limits.ts");
    // The message abbreviates the ciphertext rather than printing 82 characters.
    expect(messageFor(result)).toMatch(/^moved -> ~[A-Za-z0-9_-]{4}…:2$/);
  });
});

describe.skipIf(!gitAvailable())("a range that grew", () => {
  let repo: string | undefined;
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("stays changed and names the span the old first and last lines now cover", async () => {
    // The case this repository hit for real: four comment lines inside a
    // cited function pushed its closing brace down, so the stored end landed
    // mid-function and a straight `--accept` would have hashed a truncated span.
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    writeFile(repo, "src/limits.ts", source("grown-range.ts"));
    commitAll(repo, "explain why the limits travel together");

    const result = await classify(repo, entry("src/limits.ts", "5-7", PIN_FN, first));
    expect(result.status).toBe("changed");
    // The stored end, 7, now lands on a comment line inside the function.
    // The old first and last lines sit at 5 and 9.
    expect(result.newLines).toBe("5-9");
    expect(messageFor(result)).toMatch(/^changed since [0-9a-f]{7}, 1 commit; now at lines 5-9$/);
  });

  it("offers no span when the old last line occurs twice", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    const twice = source("grown-range.ts") + "\nexport function other() {\n  return 1;\n}\n";
    writeFile(repo, "src/limits.ts", twice);
    commitAll(repo, "add a second function");

    const result = await classify(repo, entry("src/limits.ts", "5-7", PIN_FN, first));
    expect(result.status).toBe("changed");
    expect(result.newLines).toBeUndefined();
  });

  it("offers no span on a never-true end", async () => {
    // The pin did not hold at the recorded commit, so git can show no
    // canonical first and last line to bracket by.
    repo = makeTempRepo({ files: { "src/limits.ts": source("grown-range.ts") } });
    const first = commitAll(repo, "add limits");
    writeFile(repo, "src/limits.ts", `\n${source("grown-range.ts")}`);
    commitAll(repo, "add a leading blank line");

    const result = await classify(repo, entry("src/limits.ts", "5-7", PIN_FN, first));
    expect(result.status).toBe("never-true");
    expect(result.newLines).toBeUndefined();
  });

  it("offers no span to a whole-file pin, which has no range to grow", async () => {
    // `historyOf` hands back the whole file as the original, and its first and
    // last line each sit once in the file as it stands. A span there would be
    // a range the citation never had.
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    writeFile(repo, "src/limits.ts", source("changed.ts"));
    commitAll(repo, "raise the timeout");

    const result = await classify(repo, entry("src/limits.ts", undefined, PIN_FILE, first));
    expect(result.status).toBe("changed");
    expect(result.newLines).toBeUndefined();
  });

  it("offers no span when the old first line is gone", async () => {
    repo = makeTempRepo({ files: { "src/limits.ts": LIMITS } });
    const first = commitAll(repo, "add limits");
    writeFileSync(join(repo, "src", "limits.ts"), "// a header\n" + source("changed.ts"), "utf8");
    commitAll(repo, "raise the timeout and add a header");

    const gone = await classify(repo, entry("src/limits.ts", 2, PIN_L2, first));
    expect(gone.status).toBe("changed");
    expect(gone.newLines).toBeUndefined();
  });
});
