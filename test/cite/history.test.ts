/**
 * Claim history: the derived baseline, the words test, and the messages a
 * refined claim end reads under. Proposal 0053 is the record.
 *
 * Every case that needs a baseline builds a throwaway repository, because the
 * baseline is the newest commit whose page held the pin. A fixture directory
 * cannot carry that: the pin's history would be this repository's history,
 * and no fixture can commit a page twice.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { checkCitations } from "../../src/cite/core/check-page.js";
import { gitClient, noGit } from "../../src/cite/core/git.js";
import { hashLines, splitLines } from "../../src/cite/core/hash.js";
import {
  MAX_PAGE_COMMITS,
  claimWords,
  holdsWords,
  runsHolding,
} from "../../src/cite/core/history.js";
import { readPage } from "../../src/cite/core/page.js";
import { spellLines } from "../../src/cite/core/range.js";
import { renderCheckPretty, renderUpdatePretty } from "../../src/cite/reporters/pretty.js";
import type {
  PageCitationReport,
  UpdateOptions,
  UpdateRun,
} from "../../src/cite/types.js";
import { commit, git, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const HAS_GIT = gitAvailable();
/** A pin is `sha256-` and 64 hex characters, so a placeholder of that width keeps every line number. */
const PLACEHOLDER = `sha256-${"0".repeat(64)}`;
const SOURCE = "export const TIMEOUT = 10;\n";

/** The plain pin over a span of file lines of `content`. */
function pinAt(content: string, start: number, end = start): string {
  return hashLines(splitLines(content).slice(start - 1, end).join("\n"));
}

/**
 * The body's first file line on a page whose frontmatter carries one entry
 * with claim lines. Twelve frontmatter lines, so the body opens at 13.
 */
const CLAIM_BODY_LINE = 13;

interface PageSpec {
  /** The body, starting at the first line after the frontmatter fence. */
  body: string;
  /** File lines the claim pins. */
  claim: { start: number; end?: number };
  id?: string;
}

/**
 * A page whose claim pin is taken over its own body. The frontmatter is
 * written at placeholder width first, so every line number survives the
 * substitution of the real pins.
 */
function makePage(spec: PageSpec): string {
  const id = spec.id ?? "fetch-timeout";
  const start = spec.claim.start - CLAIM_BODY_LINE + 1;
  const end = (spec.claim.end ?? spec.claim.start) - CLAIM_BODY_LINE + 1;
  const content = [
    "---",
    "title: Limits",
    "citations:",
    `  - id: ${id}`,
    "    claim:",
    `      lines: ${spellLines({ start, end })}`,
    `      integrity: ${PLACEHOLDER}`,
    "    source:",
    "      file: lib/limits.ts",
    "      lines: 1",
    `      integrity: ${PLACEHOLDER}`,
    "---",
    "",
  ].join("\n") + spec.body;
  if (readPage("page.md", content).bodyLine !== CLAIM_BODY_LINE) {
    throw new Error("the frontmatter's height changed; CLAIM_BODY_LINE is stale");
  }
  return content
    .replace(PLACEHOLDER, pinAt(content, spec.claim.start, spec.claim.end ?? spec.claim.start))
    .replace(PLACEHOLDER, hashLines("export const TIMEOUT = 10;"));
}

/** A marker-anchored page: the pin is taken over the span the marker anchors. */
function makeMarkerPage(body: string, markerLine: number, id = "retries"): string {
  const frontmatter = [
    "---",
    "title: Limits",
    "citations:",
    `  - id: ${id}`,
    "    claim:",
    `      integrity: ${PLACEHOLDER}`,
    "    source:",
    "      file: lib/limits.ts",
    "      lines: 1",
    `      integrity: ${PLACEHOLDER}`,
    "---",
    "",
  ].join("\n");
  const content = `${frontmatter}${body}`;
  const lines = splitLines(content);
  // The span the marker anchors: the paragraph below it.
  let start = markerLine + 1;
  while ((lines[start - 1] ?? "").trim() === "") start++;
  let end = start;
  while (end + 1 <= lines.length && (lines[end] ?? "").trim() !== "") end++;
  return content
    .replace(PLACEHOLDER, pinAt(content, start, end))
    .replace(PLACEHOLDER, hashLines("export const TIMEOUT = 10;"));
}

interface Repo {
  dir: string;
  report: (pageText?: string) => Promise<PageCitationReport>;
}

/** A repository holding `lib/limits.ts` and `docs/limits.md`, checked from its root. */
function repoWith(pageText: string, files: Record<string, string> = {}): Repo {
  const dir = makeTempRepo({
    files: { "lib/limits.ts": SOURCE, "docs/limits.md": pageText, ...files },
  });
  return {
    dir,
    report: async (text?: string) => {
      const content = text ?? pageText;
      return checkCitations(
        { file: "docs/limits.md", content },
        { root: dir, gitClient: gitClient(dir) },
      );
    },
  };
}

function claimOf(report: PageCitationReport): PageCitationReport["citations"][number]["claim"] {
  return report.citations[0]?.claim ?? null;
}

function claimFinding(report: PageCitationReport): string {
  return report.findings.find((f) => f.rule.startsWith("claim-"))?.message ?? "";
}

function claimRule(report: PageCitationReport): string {
  return report.findings.find((f) => f.rule.startsWith("claim-"))?.rule ?? "";
}

describe("claimWords", () => {
  it("drops marker-only lines and collapses every run of whitespace", () => {
    const lines = ["<!-- cite retries -->", "A request  is retried", "three   times."];
    expect(claimWords(lines, "markdown")).toBe("A request is retried three times.");
  });

  it("keeps punctuation and inline markup, which are words here", () => {
    expect(claimWords(["A *bold*, claim."], "markdown")).toBe("A *bold*, claim.");
  });

  it("leaves a line that holds a marker and text alone", () => {
    expect(claimWords(["<!-- cite a --> and text"], "markdown")).toBe("<!-- cite a --> and text");
  });
});

describe("holdsWords", () => {
  it("holds a run that sits at either end or in the middle", () => {
    expect(holdsWords("a b c d", "a b")).toBe(true);
    expect(holdsWords("a b c d", "c d")).toBe(true);
    expect(holdsWords("a b c d", "b c")).toBe(true);
    expect(holdsWords("a b c d", "a b c d")).toBe(true);
  });

  it("never holds half a word, and never holds words out of order", () => {
    expect(holdsWords("abc def", "bc de")).toBe(false);
    expect(holdsWords("a b c", "c b")).toBe(false);
    expect(holdsWords("a b", "a b c")).toBe(false);
  });
});

describe("runsHolding", () => {
  const lines = ["---", "title: t", "---", "", "One two.", "Three four.", "One two."];

  it("finds the one run that holds the words", () => {
    expect(runsHolding(lines, "markdown", 4, "Three four.").map(spellLines)).toEqual(["6"]);
  });

  it("finds a run that spans lines", () => {
    expect(runsHolding(lines, "markdown", 4, "Three four. One two.").map(spellLines)).toEqual([
      "6-7",
    ]);
  });

  it("reports every run when the words sit in more than one place", () => {
    expect(runsHolding(lines, "markdown", 4, "One two.").map(spellLines)).toEqual(["5", "7"]);
  });

  it("finds none when the words are not there", () => {
    expect(runsHolding(lines, "markdown", 4, "Five six.")).toEqual([]);
  });

  it("never reads above the body", () => {
    expect(runsHolding(lines, "markdown", 4, "title: t")).toEqual([]);
  });
});

describe.skipIf(!HAS_GIT)("the derived baseline", () => {
  it("reads a rewrapped paragraph as reanchored, with the baseline it held at", async () => {
    const body = "# Limits\n\nA request is retried three times, then fails.\n";
    const pageText = makePage({ body, claim: { start: 15 }, id: "retries" });
    const repo = repoWith(pageText);
    try {
      const first = commit(repo.dir, "docs: add limits");
      const rewrapped = pageText.replace(
        "A request is retried three times, then fails.\n",
        "A request is retried three times,\nthen fails.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), rewrapped, "utf8");
      commit(repo.dir, "docs: rewrap limits.md");
      const report = await repo.report(rewrapped);
      expect(claimOf(report)?.status).toBe("reanchored");
      expect(claimOf(report)?.commitSha).toBe(first);
      expect(claimRule(report)).toBe("claim-reanchored");
      expect(report.findings.find((f) => f.rule === "claim-reanchored")?.severity).toBe("notice");
      expect(claimFinding(report)).toBe(
        `retries: the claim at line 15 was reanchored since ${first.slice(0, 7)}, to lines 15-16. Its words are unchanged.`,
      );
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("reads an edited sentence as changed, and says since when", async () => {
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      const first = commit(repo.dir, "docs: add limits");
      const edited = pageText.replace("is 10 seconds", "is 30 seconds");
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs(limits): the timeout is thirty seconds");
      const report = await repo.report(edited);
      expect(claimOf(report)?.status).toBe("changed");
      expect(claimRule(report)).toBe("claim-changed");
      expect(claimFinding(report)).toBe(
        `fetch-timeout: the claim at line 15 has changed since ${first.slice(0, 7)}, 1 commit.`,
      );
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("names the working tree rather than counting zero commits", async () => {
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      const head = commit(repo.dir, "docs: add limits");
      const edited = pageText.replace("is 10 seconds", "is 30 seconds");
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      const report = await repo.report(edited);
      expect(claimFinding(report)).toBe(
        `fetch-timeout: the claim at line 15 has changed since ${head.slice(0, 7)}, uncommitted.`,
      );
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("reads a sentence added beside the claim as changed, not reanchored", async () => {
    // Condition 2: every word the anchor covers now has to have been on the
    // page at the baseline, and the added sentence was not.
    const body = [
      "# Limits",
      "",
      "<!-- cite retries -->",
      "The fetch timeout is 10 seconds.",
      "",
    ].join("\n");
    const pageText = makeMarkerPage(body, 14);
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      const edited = pageText.replace(
        "The fetch timeout is 10 seconds.\n",
        "The fetch timeout is 10 seconds.\nThis applies to HTTPS only.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs: qualify the timeout");
      const report = await repo.report(edited);
      expect(claimOf(report)?.status).toBe("changed");
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("has no baseline when no commit held the pin", async () => {
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const edited = pageText.replace("is 10 seconds", "is 30 seconds");
    const repo = repoWith(edited);
    try {
      commit(repo.dir, "docs: add limits");
      const report = await repo.report(edited);
      expect(claimOf(report)?.status).toBe("changed");
      expect(claimOf(report)?.commitSha).toBeUndefined();
      expect(claimFinding(report)).toBe(
        "fetch-timeout: the claim at line 15 has changed since it was pinned.",
      );
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("reads no history at all without git", async () => {
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const edited = pageText.replace("is 10 seconds", "is 30 seconds");
    const report = await checkCitations(
      { file: "docs/limits.md", content: edited },
      { root: process.cwd(), gitClient: noGit(), checkSources: false },
    );
    expect(claimOf(report)?.status).toBe("changed");
    expect(claimFinding(report)).toBe(
      "fetch-timeout: the claim at line 15 has changed since it was pinned.",
    );
  });

  it("reads no baseline when the manifest is absent at an older commit", async () => {
    // The page holds no `citations:`, so the pin only ever lived in the
    // manifest, and this manifest is not committed at all. The walk therefore
    // stops at the newest commit rather than reaching the page that held the
    // pinned text, and the claim reads as it does today.
    const body = "---\ntitle: Limits\n---\n\n# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pin = pinAt(body, 7);
    const manifest = [
      "collection: site",
      "pages:",
      "  - page: docs/limits.md",
      "    citations:",
      "      - id: fetch-timeout",
      "        claim:",
      "          lines: 4",
      `          integrity: ${pin}`,
      "        source:",
      "          file: lib/limits.ts",
      "          lines: 1",
      `          integrity: ${hashLines("export const TIMEOUT = 10;")}`,
      "",
    ].join("\n");
    const repo = repoWith(body);
    try {
      commit(repo.dir, "docs: add limits");
      const edited = body.replace("is 10 seconds", "is 30 seconds");
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs: reword the timeout");
      // The manifest reaches the working tree and no commit, which is where
      // `cite add` leaves it until the author commits.
      writeFileSync(join(repo.dir, "citations.yaml"), manifest, "utf8");
      const report = await checkCitations(
        { file: "docs/limits.md", content: edited },
        {
          root: repo.dir,
          gitClient: gitClient(repo.dir),
          owned: { file: "citations.yaml", collection: "site" },
          citations: [
            {
              entry: {
                id: "fetch-timeout",
                claim: { lines: 4, integrity: pin },
                source: {
                  file: "lib/limits.ts",
                  lines: 1,
                  integrity: hashLines("export const TIMEOUT = 10;"),
                },
              },
              origin: { kind: "manifest", file: "citations.yaml", line: 5 },
            },
          ],
        },
      );
      expect(claimOf(report)?.status).toBe("changed");
      expect(claimOf(report)?.commitSha).toBeUndefined();
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("reads a hoisted marker's widened anchor as reanchored", async () => {
    // The marker sat mid-paragraph, so the old pin covered the second half.
    const body = [
      "# Limits",
      "",
      "Requests retry on a 5xx.",
      "<!-- cite retries -->",
      "A request is retried three times,",
      "then fails.",
      "",
    ].join("\n");
    const pageText = makeMarkerPage(body, 15);
    const repo = repoWith(pageText);
    try {
      const first = commit(repo.dir, "docs: add limits");
      const hoisted = pageText.replace(
        "Requests retry on a 5xx.\n<!-- cite retries -->\n",
        "<!-- cite retries -->\nRequests retry on a 5xx.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), hoisted, "utf8");
      commit(repo.dir, "docs(limits): hoist markers to paragraph starts");
      const report = await repo.report(hoisted);
      expect(claimOf(report)?.status).toBe("reanchored");
      expect(claimOf(report)?.commitSha).toBe(first);
      expect(claimFinding(report)).toBe(
        `retries: the claim at lines 15-17 was reanchored since ${first.slice(0, 7)}. Its words are unchanged.`,
      );
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("reads a marker now above a different paragraph as changed", async () => {
    const body = [
      "# Limits",
      "",
      "<!-- cite retries -->",
      "A request is retried three times.",
      "",
      "Timeouts are per request.",
      "",
    ].join("\n");
    const pageText = makeMarkerPage(body, 14);
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      // The cited paragraph is deleted and the marker stays behind.
      const orphaned = pageText.replace("A request is retried three times.\n\n", "");
      writeFileSync(join(repo.dir, "docs", "limits.md"), orphaned, "utf8");
      commit(repo.dir, "docs: drop the retry paragraph");
      const report = await repo.report(orphaned);
      expect(claimOf(report)?.status).toBe("changed");
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("reports several runs of the claim's words as moved-ambiguous", async () => {
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      // The sentence is rewrapped, and the same wrapped pair appears twice.
      const twice = pageText.replace(
        "The fetch timeout is 10 seconds.\n",
        "The fetch timeout\nis 10 seconds.\n\nThe fetch timeout\nis 10 seconds.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), twice, "utf8");
      commit(repo.dir, "docs: say it twice");
      const report = await repo.report(twice);
      expect(claimOf(report)?.status).toBe("moved-ambiguous");
      expect(claimRule(report)).toBe("claim-moved-ambiguous");
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("says the history is unavailable when the walk reaches its cap", async () => {
    // Two commits touched the page, and the older one held the pin. A cap of
    // one stops before it, which is a shallow checkout's position too.
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const edited = pageText.replace("is 10 seconds", "is 30 seconds");
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs: reword the timeout");
      const report = await checkCitations(
        { file: "docs/limits.md", content: edited },
        { root: repo.dir, gitClient: gitClient(repo.dir), pageCommitCap: 1 },
      );
      expect(claimOf(report)?.status).toBe("changed");
      expect(claimOf(report)?.historyAvailable).toBe(false);
      expect(claimFinding(report)).toBe(
        "fetch-timeout: the claim at line 15 has changed since it was pinned (history unavailable; fetch-depth: 0).",
      );
      expect(report.notices).toContain(
        "the page history ends before the pin held; use fetch-depth: 0 to tell reanchored claims from changed ones",
      );
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("caps the walk at 256 commits that touched the page", () => {
    expect(MAX_PAGE_COMMITS).toBe(256);
  });

  it("reads past a commit the entry was not written down at", async () => {
    // A page without the pin is a commit the entry had not reached, which is
    // what either side of a merge looks like to the other. The walk goes on
    // rather than reading the first one it meets as the entry's birth.
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    const page = join(repo.dir, "docs", "limits.md");
    try {
      const first = commit(repo.dir, "docs: add limits");
      writeFileSync(page, "---\ntitle: Limits\n---\n\n# Limits\n\nSomething else.\n", "utf8");
      commit(repo.dir, "docs: rewrite the page with no citations");
      writeFileSync(page, pageText.replace("is 10 seconds", "is 30 seconds"), "utf8");
      commit(repo.dir, "docs: bring the citation back, reworded");
      const report = await repo.report(readFileSync(page, "utf8"));
      expect(claimOf(report)?.status).toBe("changed");
      expect(claimOf(report)?.commitSha).toBe(first);
      expect(claimOf(report)?.commitsSince).toHaveLength(2);
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("reads past a merged lineage the entry was never on", async () => {
    // Either side of a merge is a lineage the other's pins never reached. A
    // page there without the pin is not the entry's birth, so the walk goes
    // on rather than stopping at the first one it meets.
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    const page = join(repo.dir, "docs", "limits.md");
    try {
      const first = commit(repo.dir, "docs: add limits");
      const trunk = git(repo.dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const edited = pageText.replace("is 10 seconds", "is 30 seconds");
      git(repo.dir, ["checkout", "-q", "-b", "side"]);
      writeFileSync(page, edited, "utf8");
      commit(repo.dir, "docs(side): the timeout is thirty seconds");
      git(repo.dir, ["checkout", "-q", trunk]);
      // The trunk's page carries no citations at all, so the pin string is
      // nowhere in it.
      writeFileSync(page, "---\ntitle: Limits\n---\n\n# Limits\n\nSomething else.\n", "utf8");
      commit(repo.dir, "docs(trunk): rewrite the page");
      try {
        git(repo.dir, ["merge", "--no-commit", "--no-ff", "side"]);
      } catch {
        // The whole page conflicts, which is the point; it is resolved below.
      }
      writeFileSync(page, edited, "utf8");
      commit(repo.dir, "Merge side into trunk");
      const report = await repo.report(readFileSync(page, "utf8"));
      expect(claimOf(report)?.status).toBe("changed");
      expect(claimOf(report)?.commitSha).toBe(first);
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("prints the commit subjects and the claim's diff under --show-diff", async () => {
    const body = "# Limits\n\nThe fetch timeout is 10 seconds.\n";
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      const first = commit(repo.dir, "docs: add limits");
      const edited = pageText.replace("is 10 seconds", "is 30 seconds");
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs(limits): the timeout is thirty seconds");
      const run = await runCheck({
        cwd: repo.dir,
        root: repo.dir,
        noConfig: true,
        env: {},
        inputs: ["docs/limits.md"],
        showDiff: true,
      });
      const out = renderCheckPretty(run, { color: false, showDiff: true });
      expect(out).toContain("        docs(limits): the timeout is thirty seconds");
      expect(out).toContain(`        --- docs/limits.md@${first.slice(0, 7)}:15`);
      expect(out).toContain("        +++ docs/limits.md:15");
      expect(out).toContain("        -The fetch timeout is 10 seconds.");
      expect(out).toContain("        +The fetch timeout is 30 seconds.");
    } finally {
      removeTempRepo(repo.dir);
    }
  });
});

describe.skipIf(!HAS_GIT)("update over the page's history", () => {
  const run = (dir: string, over: Partial<UpdateOptions> = {}): Promise<UpdateRun> =>
    runUpdate({
      cwd: dir,
      root: dir,
      noConfig: true,
      env: {},
      inputs: ["docs/limits.md"],
      ...over,
    });

  const onDisk = (dir: string): string => readFileSync(join(dir, "docs", "limits.md"), "utf8");

  it("re-pins a rewrapped claim without --accept, and moves its lines", async () => {
    const body = "# Limits\n\nA request is retried three times, then fails.\n";
    const pageText = makePage({ body, claim: { start: 15 }, id: "retries" });
    const repo = repoWith(pageText);
    try {
      const first = commit(repo.dir, "docs: add limits");
      const rewrapped = pageText.replace(
        "A request is retried three times, then fails.\n",
        "A request is retried three times,\nthen fails.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), rewrapped, "utf8");
      commit(repo.dir, "docs: rewrap limits.md");
      const out = await run(repo.dir);
      expect(out.exitCode).toBe(0);
      expect(out.rewritten).toBe(1);
      expect(out.pages[0]?.rewritten[0]?.reason).toBe("re-anchored");
      expect(out.pages[0]?.rewritten[0]?.status).toBe("reanchored");
      expect(renderUpdatePretty(out, { color: false }).split("\n")[0]).toBe(
        `docs/limits.md: retries claim lines 15 -> 15-16 re-pinned (reanchored; words unchanged since ${first.slice(0, 7)})`,
      );
      expect(onDisk(repo.dir)).toContain("      lines: 3-4\n");
      const report = await repo.report(onDisk(repo.dir));
      expect(claimOf(report)?.status).toBe("current");
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("re-pins a reanchored marker claim without --accept", async () => {
    const body = [
      "# Limits",
      "",
      "Requests retry on a 5xx.",
      "<!-- cite retries -->",
      "A request is retried three times,",
      "then fails.",
      "",
    ].join("\n");
    const pageText = makeMarkerPage(body, 15);
    const repo = repoWith(pageText);
    try {
      const first = commit(repo.dir, "docs: add limits");
      const hoisted = pageText.replace(
        "Requests retry on a 5xx.\n<!-- cite retries -->\n",
        "<!-- cite retries -->\nRequests retry on a 5xx.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), hoisted, "utf8");
      commit(repo.dir, "docs(limits): hoist markers to paragraph starts");
      const out = await run(repo.dir);
      expect(out.exitCode).toBe(0);
      expect(renderUpdatePretty(out, { color: false }).split("\n")[0]).toBe(
        `docs/limits.md: retries claim at lines 15-17 re-pinned (reanchored; words unchanged since ${first.slice(0, 7)})`,
      );
      const report = await repo.report(onDisk(repo.dir));
      expect(claimOf(report)?.status).toBe("current");
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("refuses --accept on a line that now holds wholly other text, and exits 1", async () => {
    const body = [
      "# Limits",
      "",
      "The fetch timeout is 10 seconds. It is not configurable.",
      "",
    ].join("\n");
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      const first = commit(repo.dir, "docs: add limits");
      // The cited sentence is gone and an unrelated one took the line.
      const replaced = pageText.replace(
        "The fetch timeout is 10 seconds. It is not configurable.\n",
        "Retries are capped at three.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), replaced, "utf8");
      commit(repo.dir, "docs: swap the paragraph out");
      const out = await run(repo.dir, { accept: true });
      expect(out.exitCode).toBe(1);
      expect(out.rewritten).toBe(0);
      expect(out.skipped).toBe(1);
      expect(out.pages[0]?.refused[0]?.reason).toBe("replaced");
      expect(out.pages[0]?.refused[0]?.commitSha).toBe(first);
      expect(renderUpdatePretty(out, { color: false }).split("\n")[0]).toBe(
        `docs/limits.md: fetch-timeout claim at line 15 skipped: that line now holds different text than the claim at ${first.slice(0, 7)}. Re-add it with cite add.`,
      );
      // Nothing was written: the pin still stands.
      expect(onDisk(repo.dir)).toBe(replaced);
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("accepts a replaced line when --only names it, and says so", async () => {
    const body = ["# Limits", "", "The fetch timeout is 10 seconds.", ""].join("\n");
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      const replaced = pageText.replace(
        "The fetch timeout is 10 seconds.\n",
        "Retries are capped at three.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), replaced, "utf8");
      commit(repo.dir, "docs: swap the paragraph out");
      const out = await run(repo.dir, { accept: true, only: ["fetch-timeout"] });
      expect(out.exitCode).toBe(0);
      expect(out.rewritten).toBe(1);
      expect(out.pages[0]?.refused).toEqual([]);
      expect(out.pages[0]?.rewritten[0]?.reason).toBe("accepted");
      expect(out.pages[0]?.rewritten[0]?.status).toBe("replaced");
      expect(renderUpdatePretty(out, { color: false }).split("\n")[0]).toBe(
        'docs/limits.md: fetch-timeout claim at line 15 re-pinned (replaced; now "Retries are capped at three.")',
      );
      const report = await repo.report(onDisk(repo.dir));
      expect(claimOf(report)?.status).toBe("current");
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("names each id, so several --only entries each bypass the guard", async () => {
    const body = [
      "# Limits",
      "",
      "The fetch timeout is 10 seconds.",
      "",
      "Retries default to three.",
      "",
    ].join("\n");
    // Two claim-lines entries on one page, each pinning its own paragraph.
    // Nineteen frontmatter lines, so the body opens at 21.
    const src = hashLines("export const TIMEOUT = 10;");
    const entry = (id: string, lines: number): string[] => [
      `  - id: ${id}`,
      "    claim:",
      `      lines: ${String(lines)}`,
      `      integrity: ${PLACEHOLDER}`,
      "    source:",
      "      file: lib/limits.ts",
      "      lines: 1",
      `      integrity: ${src}`,
    ];
    const draft =
      ["---", "title: Limits", "citations:", ...entry("fetch-timeout", 3), ...entry("retries", 5), "---", ""].join("\n") +
      body;
    expect(readPage("page.md", draft).bodyLine).toBe(21);
    const twoEntries = draft
      .replace(PLACEHOLDER, pinAt(draft, 23))
      .replace(PLACEHOLDER, pinAt(draft, 25));
    const repo = repoWith(twoEntries);
    try {
      commit(repo.dir, "docs: add limits");
      const replaced = twoEntries
        .replace("The fetch timeout is 10 seconds.\n", "Something else entirely.\n")
        .replace("Retries default to three.\n", "Another unrelated line.\n");
      writeFileSync(join(repo.dir, "docs", "limits.md"), replaced, "utf8");
      commit(repo.dir, "docs: swap both paragraphs out");
      const out = await run(repo.dir, {
        accept: true,
        only: ["fetch-timeout", "retries"],
      });
      expect(out.exitCode).toBe(0);
      expect(out.pages[0]?.refused).toEqual([]);
      expect(out.pages[0]?.rewritten.map((r) => [r.id, r.status])).toEqual([
        ["fetch-timeout", "replaced"],
        ["retries", "replaced"],
      ]);
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("leaves a named claim that still shares a sentence reading changed", async () => {
    const body = [
      "# Limits",
      "",
      "The fetch timeout is 10 seconds. It is not configurable.",
      "",
    ].join("\n");
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      const edited = pageText.replace("is 10 seconds", "is 30 seconds");
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs(limits): the timeout is thirty seconds");
      const out = await run(repo.dir, { accept: true, only: ["fetch-timeout"] });
      expect(out.exitCode).toBe(0);
      expect(out.pages[0]?.rewritten[0]?.status).toBe("changed");
      expect(renderUpdatePretty(out, { color: false }).split("\n")[0]).toContain("(changed; now ");
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("accepts an edit that still shares a sentence, and names both spans", async () => {
    const body = [
      "# Limits",
      "",
      "The fetch timeout is 10 seconds. It is not configurable.",
      "",
    ].join("\n");
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      const edited = pageText.replace(
        "The fetch timeout is 10 seconds. It is not configurable.\n",
        "The fetch timeout is 30 seconds.\nIt is not configurable.\n",
      );
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs(limits): the timeout is thirty seconds");
      const out = await run(repo.dir, { accept: true });
      expect(out.exitCode).toBe(0);
      expect(out.pages[0]?.refused).toEqual([]);
      expect(renderUpdatePretty(out, { color: false }).split("\n")[0]).toBe(
        'docs/limits.md: fetch-timeout claim lines 15 -> 15-16 re-pinned (changed; now "The fetch timeout is 30 seconds. It is not configurable.")',
      );
    } finally {
      removeTempRepo(repo.dir);
    }
  });

  it("caps the quoted text at 200 characters", async () => {
    const long = `The fetch timeout is 10 seconds. ${"Very long prose. ".repeat(20)}`.trim();
    const body = `# Limits\n\n${long}\n`;
    const pageText = makePage({ body, claim: { start: 15 } });
    const repo = repoWith(pageText);
    try {
      commit(repo.dir, "docs: add limits");
      const edited = pageText.replace("is 10 seconds", "is 30 seconds");
      writeFileSync(join(repo.dir, "docs", "limits.md"), edited, "utf8");
      commit(repo.dir, "docs(limits): the timeout is thirty seconds");
      const out = await run(repo.dir, { accept: true });
      const text = out.pages[0]?.rewritten[0]?.text ?? "";
      expect(text).toHaveLength(201);
      expect(text.endsWith("…")).toBe(true);
    } finally {
      removeTempRepo(repo.dir);
    }
  });
});
