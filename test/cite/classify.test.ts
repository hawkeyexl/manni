/**
 * Classification agrees with the ladder (docs/proposals/0040/ladders/
 * drift-examples.cjs): every row of its VERDICTS table is replayed here
 * through the real `classifyCitation`, with the ladder's `current` text on
 * disk and its `atCommit` answered by a fake git client. The move search is
 * then exercised in both regimes and under a byte budget, and once more
 * against a real repository with two commits.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MOVE_BUDGET_BYTES,
  MOVE_WINDOW_LINES,
  classifyCitation,
  findWindows,
} from "../../src/cite/core/classify.js";
import { hashLines, splitLines } from "../../src/cite/core/hash.js";
import { buildSourceIndex } from "../../src/cite/core/sources.js";
import { gitClient } from "../../src/cite/core/git.js";
import type {
  Citation,
  CitationResult,
  GitClient,
  PageCitation,
  ShownFile,
  SourceIndex,
} from "../../src/cite/types.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const require = createRequire(import.meta.url);

interface LadderEntry {
  id?: string;
  src: string;
  integrity: string;
  commit?: string;
}
type LadderAtCommit = string | null | undefined;
interface LadderExpected {
  status: string;
  newSrc?: string;
  candidates?: string[];
  historyAvailable?: boolean;
  reason?: string;
  fileLines?: number;
}
type Verdict = [
  name: string,
  entry: LadderEntry,
  current: string | null,
  atCommit: LadderAtCommit,
  expected: LadderExpected,
  opts?: { salt?: string },
];
const ladder = require("../../docs/proposals/0040/ladders/drift-examples.cjs") as {
  SOURCE: string;
  variants: Record<string, string>;
  mint(text: string, l1?: number, l2?: number, salt?: string): string | undefined;
  obfuscate(path: string, salt: string): string;
  VERDICTS: Verdict[];
};

const SALT = "SALT-LADDER";
const PATH = "src/limits.ts";
const TOKEN = ladder.obfuscate(PATH, SALT);
const SOURCE_LINES = splitLines(ladder.SOURCE);
const PIN_L2 = ladder.mint(ladder.SOURCE, 2) ?? "";

/** An index over one path, with the ladder's token resolving to it whatever the salt. */
function indexOf(files: string[]): SourceIndex {
  const held = new Set(files);
  return {
    files: () => files,
    resolve: (token) => (token === TOKEN && held.has(PATH) ? PATH : undefined),
    has: (path) => held.has(path),
  };
}

/** A client that answers `showFile` from the ladder's `atCommit` column. */
function fakeGit(atCommit: LadderAtCommit, available = true): GitClient {
  const shown = (): ShownFile => {
    if (atCommit === "unavailable") return { missing: "commit" };
    if (atCommit === null) return { missing: "path" };
    if (atCommit === undefined) throw new Error("showFile called without a commit");
    return { text: atCommit };
  };
  return {
    available: () => Promise.resolve(available),
    head: () => Promise.resolve(null),
    lsFiles: () => Promise.resolve([PATH]),
    showFile: () => Promise.resolve(shown()),
    subjectsSince: () => Promise.resolve(["raise fetch timeout to 30s"]),
    diffSince: () => Promise.resolve("-old\n+new\n"),
  };
}

function page(citation: Citation): PageCitation {
  return { citation, origin: { kind: "frontmatter", index: 0, line: 3 } };
}

/** The ladder's verdict shape, from a result: status plus the fields the ladder names. */
function verdictOf(result: CitationResult): LadderExpected {
  const out: LadderExpected = { status: result.status };
  if (result.newSrc !== undefined) out.newSrc = result.newSrc;
  if (result.candidates !== undefined) out.candidates = result.candidates;
  if (result.historyAvailable !== undefined) out.historyAvailable = result.historyAvailable;
  return out;
}

describe("classifyCitation agrees with the ladder", () => {
  let root: string;
  beforeAll(() => {
    root = makeTempRepo({ init: false, files: { [PATH]: ladder.SOURCE } });
  });
  afterAll(() => {
    removeTempRepo(root);
  });

  for (const [name, entry, current, atCommit, expected, opts] of ladder.VERDICTS) {
    it(name, async () => {
      if (current !== null) writeFileSync(join(root, PATH), current, "utf8");
      const citation: Citation = { src: entry.src, integrity: entry.integrity };
      if (entry.id !== undefined) citation.id = entry.id;
      if (entry.commit !== undefined) citation.commit = entry.commit;
      const result = await classifyCitation(page(citation), {
        root,
        index: indexOf(current === null ? [] : [PATH]),
        git: fakeGit(atCommit),
        salt: opts?.salt ?? SALT,
      });
      // `reason` and `fileLines` are the ladder's own; CitationResult has no
      // field for either, so the comparison is over what it does carry.
      const { reason: _reason, fileLines: _fileLines, ...want } = expected;
      expect(verdictOf(result)).toEqual(want);
      expect(result.citation).toBe(citation);
      if (current !== null) expect(result.resolvedPath).toBe(PATH);
      if (entry.commit !== undefined) expect(result.commit).toBe(entry.commit);
    });
  }

  it("attaches commit subjects and the diff to a changed pin with history", async () => {
    writeFileSync(join(root, PATH), ladder.variants.CHANGED ?? "", "utf8");
    const result = await classifyCitation(
      page({ src: `${PATH}:2`, integrity: PIN_L2, commit: "3f9c2a1" }),
      { root, index: indexOf([PATH]), git: fakeGit(ladder.SOURCE), salt: "" },
    );
    expect(result.status).toBe("changed");
    expect(result.historyAvailable).toBe(true);
    expect(result.commitsSince).toEqual(["raise fetch timeout to 30s"]);
    expect(result.diff).toBe("-old\n+new\n");
  });

  it("takes the page-level commit when the entry carries none", async () => {
    writeFileSync(join(root, PATH), ladder.variants.CHANGED ?? "", "utf8");
    const result = await classifyCitation(page({ src: `${PATH}:2`, integrity: PIN_L2 }), {
      root,
      index: indexOf([PATH]),
      git: fakeGit(ladder.variants.AT_COMMIT_OTHER),
      salt: "",
      pageCommit: "3f9c2a1",
    });
    expect(result.status).toBe("never-true");
    expect(result.commit).toBe("3f9c2a1");
  });

  it("leaves history alone under useGit: false, and when git is unavailable", async () => {
    writeFileSync(join(root, PATH), ladder.variants.CHANGED ?? "", "utf8");
    const entry = page({ src: `${PATH}:2`, integrity: PIN_L2, commit: "3f9c2a1" });
    const off = await classifyCitation(entry, {
      root,
      index: indexOf([PATH]),
      git: fakeGit(ladder.variants.AT_COMMIT_OTHER),
      useGit: false,
      salt: "",
    });
    expect(verdictOf(off)).toEqual({ status: "changed" });
    expect(off.commitsSince).toBeUndefined();
    const absent = await classifyCitation(entry, {
      root,
      index: indexOf([PATH]),
      git: fakeGit(ladder.variants.AT_COMMIT_OTHER, false),
      salt: "",
    });
    expect(verdictOf(absent)).toEqual({ status: "changed" });
  });

  it("moves a keyed pin without history, spelling the token as the page did", async () => {
    writeFileSync(join(root, PATH), ladder.variants.MOVED ?? "", "utf8");
    const keyed = ladder.mint(ladder.SOURCE, 1, 3, SALT) ?? "";
    const result = await classifyCitation(page({ src: `${TOKEN}:1-3`, integrity: keyed }), {
      root,
      index: indexOf([PATH]),
      git: fakeGit(undefined),
      salt: SALT,
    });
    expect(result.status).toBe("moved");
    expect(result.newSrc).toBe(`${TOKEN}:3-5`);
    expect(result.resolvedPath).toBe(PATH);
  });

  it("reports a truncated search as changed with truncatedSearch", async () => {
    writeFileSync(join(root, PATH), ladder.variants.MOVED ?? "", "utf8");
    const result = await classifyCitation(page({ src: `${PATH}:2`, integrity: PIN_L2 }), {
      root,
      index: indexOf([PATH]),
      git: fakeGit(undefined),
      salt: "",
      budget: 4,
    });
    expect(result.status).toBe("changed");
    expect(result.truncatedSearch).toBe(true);
  });
});

describe("findWindows", () => {
  const moved = splitLines(ladder.variants.MOVED ?? "");
  const ambiguous = splitLines(ladder.variants.MOVED_AMBIG ?? "");
  const line2 = SOURCE_LINES[1] ?? "";

  it("with the original lines: first-line candidates, lexical compare, then the hash", () => {
    expect(findWindows(moved, 1, PIN_L2, undefined, { around: 2, original: [line2] })).toEqual({
      starts: [4],
      truncated: false,
    });
    expect(findWindows(ambiguous, 1, PIN_L2, undefined, { around: 2, original: [line2] })).toEqual({
      starts: [4, 11],
      truncated: false,
    });
    const pin13 = ladder.mint(ladder.SOURCE, 1, 3) ?? "";
    expect(
      findWindows(moved, 3, pin13, undefined, { around: 1, original: SOURCE_LINES.slice(0, 3) }),
    ).toEqual({ starts: [3], truncated: false });
  });

  it("with the original lines, a first-line match that diverges later is not hashed into a hit", () => {
    const lines = [line2, "different", line2, SOURCE_LINES[2] ?? ""];
    const pin = hashLines([line2, SOURCE_LINES[2] ?? ""].join("\n"));
    expect(findWindows(lines, 2, pin, undefined, { original: [line2, SOURCE_LINES[2] ?? ""] })).toEqual({
      starts: [3],
      truncated: false,
    });
  });

  it("without the original lines: hashes windows, keyed when a salt is given", () => {
    expect(findWindows(moved, 1, PIN_L2, undefined, { around: 2 })).toEqual({ starts: [4], truncated: false });
    expect(findWindows(ambiguous, 1, PIN_L2, undefined, { around: 2 })).toEqual({
      starts: [4, 11],
      truncated: false,
    });
    const keyed = ladder.mint(ladder.SOURCE, 2, 2, SALT) ?? "";
    expect(findWindows(moved, 1, keyed, SALT, { around: 2 })).toEqual({ starts: [4], truncated: false });
    expect(findWindows(moved, 1, keyed, undefined, { around: 2 })).toEqual({ starts: [], truncated: false });
  });

  it("a window longer than the file has nowhere to be", () => {
    expect(findWindows(SOURCE_LINES.slice(0, 3), 7, PIN_L2, undefined, { around: 1 })).toEqual({
      starts: [],
      truncated: false,
    });
  });

  it("searches the band around the original position before the rest, under the budget", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${String(i + 1)}`);
    const bytes = (from: number, to: number): number =>
      lines.slice(from - 1, to).reduce((n, l) => n + Buffer.byteLength(l, "utf8"), 0);
    const around = 100;
    const bandEnd = around + MOVE_WINDOW_LINES;
    const budget = bytes(1, bandEnd) + bytes(bandEnd + 1, bandEnd + 5);

    const inBand = hashLines("line 2000");
    expect(findWindows(lines, 1, inBand, undefined, { around, budget })).toEqual({
      starts: [2000],
      truncated: true,
    });
    const outside = hashLines("line 4900");
    expect(findWindows(lines, 1, outside, undefined, { around, budget })).toEqual({
      starts: [],
      truncated: true,
    });
    expect(findWindows(lines, 1, outside, undefined, { around })).toEqual({ starts: [4900], truncated: false });
    expect(MOVE_BUDGET_BYTES).toBe(64 * 1024 * 1024);
  });

  it("a tiny budget truncates before the first window", () => {
    expect(findWindows(moved, 1, PIN_L2, undefined, { around: 2, budget: 1 })).toEqual({
      starts: [],
      truncated: true,
    });
  });
});

describe.skipIf(!gitAvailable())("classifyCitation against a real repository", () => {
  let repo: string | undefined;
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("never-true, changed with subjects and a diff, then moved", async () => {
    repo = makeTempRepo({ files: { [PATH]: ladder.SOURCE } });
    const first = commitAll(repo, "add limits");
    writeFileSync(join(repo, PATH), ladder.variants.CHANGED ?? "", "utf8");
    writeFileSync(join(repo, "src", "new.ts"), "export const NEW = 1;\n", "utf8");
    const second = commitAll(repo, "raise fetch timeout to 30s");
    const git = gitClient(repo);
    const index = await buildSourceIndex(repo, "", { gitClient: git });
    const opts = { root: repo, index, git, salt: "" };

    const changed = await classifyCitation(page({ src: `${PATH}:2`, integrity: PIN_L2, commit: first }), opts);
    expect(changed.status).toBe("changed");
    expect(changed.historyAvailable).toBe(true);
    expect(changed.commitsSince).toEqual(["raise fetch timeout to 30s"]);
    expect(changed.diff).toContain("+export const FETCH_TIMEOUT_MS = 30_000;");

    const neverTrue = await classifyCitation(page({ src: `${PATH}:2`, integrity: PIN_L2, commit: second }), opts);
    expect(neverTrue.status).toBe("never-true");

    const absent = await classifyCitation(
      page({ src: "src/new.ts:1", integrity: "sha256-" + "0".repeat(64), commit: first }),
      opts,
    );
    expect(absent.status).toBe("never-true");

    writeFileSync(join(repo, PATH), ladder.variants.MOVED ?? "", "utf8");
    const moved = await classifyCitation(page({ src: `${PATH}:2`, integrity: PIN_L2, commit: first }), opts);
    expect(moved.status).toBe("moved");
    expect(moved.newSrc).toBe(`${PATH}:4`);
    expect(moved.commitsSince).toBeUndefined();

    const unknown = await classifyCitation(
      page({ src: `${PATH}:2`, integrity: "sha256-" + "0".repeat(64), commit: "0123456789abcdef0123456789abcdef01234567" }),
      opts,
    );
    expect(unknown.status).toBe("changed");
    expect(unknown.historyAvailable).toBe(false);
  });

  it("a pin moved by update and then changed is `changed`, not `never-true`", async () => {
    // C1: the pin is minted for line 2. C2: two lines are inserted above and
    // `update` rewrites src to :4, keeping the commit at C1. C3: line 4 is
    // edited. The recorded commit's file holds other bytes at line 4, but the
    // pinned bytes were there, at line 2, so the pin was true then.
    repo = makeTempRepo({ files: { [PATH]: ladder.SOURCE } });
    const first = commitAll(repo, "add limits");
    writeFileSync(join(repo, PATH), ladder.variants.MOVED ?? "", "utf8");
    commitAll(repo, "comment the limits");
    writeFileSync(join(repo, PATH), ladder.variants.MOVED_CHANGED ?? "", "utf8");
    commitAll(repo, "raise fetch timeout to 30s");
    const git = gitClient(repo);
    const index = await buildSourceIndex(repo, "", { gitClient: git });
    const opts = { root: repo, index, git, salt: "" };

    const result = await classifyCitation(page({ src: `${PATH}:4`, integrity: PIN_L2, commit: first }), opts);
    expect(result.status).toBe("changed");
    expect(result.historyAvailable).toBe(true);
    expect(result.commitsSince).toEqual(["raise fetch timeout to 30s", "comment the limits"]);
    expect(result.diff).toContain("+export const FETCH_TIMEOUT_MS = 30_000;");

    // The same history, but the pinned bytes were never in the file at C1.
    const never = await classifyCitation(
      page({ src: `${PATH}:4`, integrity: ladder.mint("export const NEVER = 1;\n", 1) ?? "", commit: first }),
      opts,
    );
    expect(never.status).toBe("never-true");
  });
});
