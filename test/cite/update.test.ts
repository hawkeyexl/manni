/**
 * `runUpdate` against temp copies of the fixture pages. An entry has two ends
 * and `update` repairs both: `claim-moved.md` splices `claim.lines`,
 * `moved.md` splices `source.lines` (`moved.ts` is the ladder source with two
 * comment lines above it, so every pin holds two lines down). `--accept`
 * re-pins what changed: `claim-changed.md` and `marker-changed.md` on the page
 * side, `source-changed.md` on the source side. The fixture cases inject a git
 * that is not there, as in check.test.ts; the commit splice runs against a
 * throwaway repository.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashLines, hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import type { UpdateOptions, UpdateRun } from "../../src/cite/types.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
const SRC = join(ROOT, "src");
/** A fixed test key; never the developer's environment. */
const KEY = "update-key-0123456789abcdef0123456789";
/** `src/limits.ts` line 2, the pin every fixture's source end carries. */
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
/** `src/limits.ts` line 3. */
const PIN_L3 = "sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3";
/** The claim pin `current.md` and friends carry: "The fetch timeout is 10 seconds." */
const CLAIM_10 = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
/** The claim pin a marker-anchored fixture carries: "Retries default to 3." */
const CLAIM_RETRIES = "sha256-3049e93e72873542aac2c1c4778fa655e70656f03c08f202444062f404a3315d";

const source = (name: string): string => readFileSync(join(SRC, name), "utf8");
const CHANGED_L2 = hashRange(source("changed.ts"), { start: 2, end: 2 });
const NO_HISTORY =
  "git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.";
const NO_COMMIT = "git is not available here, so the citation records no commit.";

let cwd = "";
function workspace(...pages: string[]): void {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = mkdtempSync(join(tmpdir(), "manni-cite-update-"));
  mkdirSync(join(cwd, "pages"));
  for (const name of pages) copyFileSync(join(PAGES, name), join(cwd, "pages", name));
}
function write(name: string, lines: string[]): string {
  if (cwd === "") workspace();
  writeFileSync(join(cwd, "pages", name), lines.join("\n") + "\n", "utf8");
  return `pages/${name}`;
}
const onDisk = (label: string): string => readFileSync(join(cwd, label), "utf8");
afterEach(() => {
  if (cwd !== "") rmSync(cwd, { recursive: true, force: true });
  cwd = "";
});

function update(over: Partial<UpdateOptions> & { inputs: string[] }): Promise<UpdateRun> {
  return runUpdate({ cwd, root: ROOT, noConfig: true, gitClient: noGit(), env: {}, ...over });
}

/** Both ends of every citation on a page, as `check` reads them now. */
async function ends(label: string, configPath?: string): Promise<(string | null)[][]> {
  const run = await runCheck({
    cwd,
    root: ROOT,
    gitClient: noGit(),
    env: {},
    inputs: [label],
    ...(configPath === undefined ? { noConfig: true } : { configPath }),
  });
  return (run.pages[0]?.citations ?? []).map((c) => [c.claim?.status ?? null, c.source.status]);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CiteError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

/** `manni.config.yaml` in the workspace: the given `cite:` body, and the family key when given. */
function tempConfig(cite: string, key?: string): string {
  const path = join(cwd, "manni.config.yaml");
  const family = key === undefined ? "" : `encryptionKey: ${key}\n`;
  writeFileSync(path, `${family}cite:\n${cite.replace(/^/gm, "  ")}\n`, "utf8");
  return path;
}

describe("runUpdate: the claim end", () => {
  it("splices a moved claim's lines and leaves the rest of the page alone", async () => {
    workspace("claim-moved.md");
    const before = onDisk("pages/claim-moved.md");
    const run = await update({ inputs: ["pages/claim-moved.md"] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    const [page] = run.pages;
    expect(page?.file).toBe("pages/claim-moved.md");
    expect(page?.written).toBe(true);
    expect(page?.skipped).toEqual([]);
    expect(page?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "claim",
        reason: "moved",
        status: "moved",
        from: "15",
        to: "17",
      },
    ]);
    const after = onDisk("pages/claim-moved.md");
    expect(after).toContain("      lines: 5\n");
    // Only that one line differs: the pin, the source and the body are untouched.
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(changed).toEqual(["      lines: 5"]);
    expect(page?.diff).toContain("-      lines: 3");
    expect(page?.diff).toContain("+      lines: 5");
    expect(await ends("pages/claim-moved.md")).toEqual([["current", "current"]]);
  });

  it("--accept re-pins a changed claim over the paragraph now at its line, and says what it took", async () => {
    workspace("claim-changed.md");
    const declined = await update({ inputs: ["pages/claim-changed.md"] });
    // claim-changed is a warning, so leaving it behind is not work undone.
    expect(declined).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(declined.pages[0]?.skipped.map((f) => [f.rule, f.severity, f.line])).toEqual([
      ["claim-changed", "warning", 15],
    ]);

    workspace("claim-changed.md");
    const pin = hashLines("The fetch timeout is 30 seconds.");
    const run = await update({ inputs: ["pages/claim-changed.md"], accept: true });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "claim",
        reason: "accepted",
        status: "changed",
        from: CLAIM_10,
        to: pin,
        at: 15,
        text: "The fetch timeout is 30 seconds.",
      },
    ]);
    const after = onDisk("pages/claim-changed.md");
    expect(after).toContain(`      integrity: ${pin}\n`);
    // The claim still covers its one recorded line, so `lines:` is left alone.
    expect(after).toContain("      lines: 3\n");
    expect(await ends("pages/claim-changed.md")).toEqual([["current", "current"]]);
  });

  it("--accept re-pins a marker-anchored claim in place, with no lines to splice", async () => {
    workspace("marker-changed.md");
    const pin = hashLines("Retries default to 5.");
    const run = await update({ inputs: ["pages/marker-changed.md"], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "retries",
        index: 0,
        line: 4,
        end: "claim",
        reason: "accepted",
        status: "changed",
        from: CLAIM_RETRIES,
        to: pin,
        at: 15,
        text: "Retries default to 5.",
      },
    ]);
    const after = onDisk("pages/marker-changed.md");
    expect(after).toContain(`      integrity: ${pin}\n`);
    expect(after).not.toContain("lines:\n");
    expect(after).toContain("<!-- cite retries -->\n");
    expect(await ends("pages/marker-changed.md")).toEqual([["current", "current"]]);
  });

  it("--accept re-pins a paragraph that grew, moving the claim's last line with it", async () => {
    workspace();
    const label = write("grown.md", [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    claim:",
      "      lines: 1",
      `      integrity: ${CLAIM_10}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "The fetch timeout is 30 seconds. It is",
      "not configurable either.",
    ]);
    const pin = hashLines("The fetch timeout is 30 seconds. It is\nnot configurable either.");
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 3,
        end: "claim",
        reason: "accepted",
        status: "changed",
        from: CLAIM_10,
        to: pin,
        at: 12,
        // The report collapses the whitespace, so a two-line claim reads as one.
        text: "The fetch timeout is 30 seconds. It is not configurable either.",
      },
    ]);
    expect(onDisk(label)).toContain("      lines: 1-2\n");
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("skips a changed claim whose line is now blank", async () => {
    workspace();
    const label = write("blank.md", [
      "---",
      "citations:",
      "  - id: gone",
      "    claim:",
      "      lines: 1",
      `      integrity: ${hashLines("A sentence nobody kept.")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "",
      "Something else entirely.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(run.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-changed"]);
    expect(onDisk(label)).toBe(before);
  });

  it("skips a changed quote whose claim lines are no longer a fenced block", async () => {
    workspace();
    const label = write("unfenced.md", [
      "---",
      "citations:",
      "  - id: header",
      "    claim:",
      "      lines: 1-3",
      `      integrity: ${hashLines("```ts\nexport const FETCH_TIMEOUT_MS = 10_000;\n```")}`,
      "    source:",
      "      file: src/limits.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "    quote: true",
      "---",
      "The fetch timeout is documented here.",
      "It used to be a fenced block.",
      "Now it is prose.",
    ]);
    const before = onDisk(label);
    const run = await update({ inputs: [label], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([]);
    // The claim is left for a fresh `cite add`, and the anchor is an error, so
    // the run reports work undone.
    expect(run.pages[0]?.skipped.map((f) => f.rule).sort()).toEqual([
      "anchor-invalid",
      "claim-changed",
    ]);
    expect(run.exitCode).toBe(1);
    expect(onDisk(label)).toBe(before);
  });

  it("leaves a claim that moved to two places for a person to settle", async () => {
    workspace("claim-moved-ambiguous.md");
    const before = onDisk("pages/claim-moved-ambiguous.md");
    const run = await update({ inputs: ["pages/claim-moved-ambiguous.md"], accept: true });
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 0 });
    expect(run.pages[0]?.skipped.map((f) => [f.rule, f.severity])).toEqual([
      ["claim-moved-ambiguous", "warning"],
    ]);
    expect(onDisk("pages/claim-moved-ambiguous.md")).toBe(before);
  });
});

describe("runUpdate: the source end", () => {
  it("splices a moved source's lines", async () => {
    workspace("moved.md");
    const before = onDisk("pages/moved.md");
    const run = await update({ inputs: ["pages/moved.md"] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "source",
        reason: "moved",
        status: "moved",
        from: "src/moved.ts:2",
        to: "src/moved.ts:4",
      },
    ]);
    const after = onDisk("pages/moved.md");
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(changed).toEqual(["      lines: 4"]);
    expect(run.pages[0]?.diff).toContain("+      lines: 4");
    expect(await ends("pages/moved.md")).toEqual([["current", "current"]]);
  });

  it("--accept re-mints a changed source, recording no commit where the entry records none", async () => {
    workspace("source-changed.md");
    const before = onDisk("pages/source-changed.md");
    const declined = await update({ inputs: ["pages/source-changed.md"] });
    expect(declined).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 1 });
    expect(declined.pages[0]?.skipped.map((f) => [f.rule, f.severity])).toEqual([
      ["source-changed", "error"],
    ]);
    expect(onDisk("pages/source-changed.md")).toBe(before);

    const run = await update({ inputs: ["pages/source-changed.md"], accept: true });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        id: "fetch-timeout",
        index: 0,
        line: 4,
        end: "source",
        reason: "accepted",
        status: "changed",
        from: PIN_L2,
        to: CHANGED_L2,
        src: "src/changed.ts:2",
      },
    ]);
    const after = onDisk("pages/source-changed.md");
    expect(after).toContain(`      integrity: ${CHANGED_L2}\n`);
    expect(after).not.toContain("commit-sha");
    expect(after.replace(CHANGED_L2, PIN_L2)).toBe(before);
    expect(await ends("pages/source-changed.md")).toEqual([["current", "current"]]);
  });

  it("keeps an encrypted source encrypted across a move", async () => {
    workspace();
    const config = tempConfig("", KEY);
    const token = encryptSourcePath("src/moved.ts", KEY);
    const label = write("token.md", [
      "---",
      "citations:",
      "  - source:",
      `      file: ${token}`,
      "      lines: 2",
      `      integrity: ${hashRange(source("limits.ts"), { start: 2, end: 2 }, KEY)}`,
      "---",
      "Body.",
    ]);
    const run = await update({ inputs: [label], noConfig: false, configPath: config });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        index: 0,
        line: 3,
        end: "source",
        reason: "moved",
        status: "moved",
        from: `${token}:2`,
        to: `${token}:4`,
      },
    ]);
    const after = onDisk(label);
    expect(after).toContain("      lines: 4\n");
    expect(after).not.toContain("moved.ts");
    expect(await ends(label, config)).toEqual([[null, "current"]]);
  });

  it("--accept re-mints an encrypted entry in its own form: encrypted, under the current key", async () => {
    workspace();
    const config = tempConfig("", KEY);
    const token = encryptSourcePath("src/changed.ts", KEY);
    const before = hashRange(source("limits.ts"), { start: 2, end: 2 }, KEY);
    const label = write("token.md", [
      "---",
      "citations:",
      "  - source:",
      `      file: ${token}`,
      "      lines: 2",
      `      integrity: ${before}`,
      "---",
      "Body.",
    ]);
    expect(await ends(label, config)).toEqual([[null, "changed"]]);
    const run = await update({ inputs: [label], noConfig: false, configPath: config, accept: true });
    const reminted = hashRange(source("changed.ts"), { start: 2, end: 2 }, KEY);
    expect(run.pages[0]?.rewritten).toEqual([
      {
        index: 0,
        line: 3,
        end: "source",
        reason: "accepted",
        status: "changed",
        from: before,
        to: reminted,
        src: `${token}:2`,
      },
    ]);
    const after = onDisk(label);
    expect(after).toContain(`      file: ${token}\n`);
    expect(after).toContain(`      integrity: ${reminted}\n`);
    expect(after).not.toContain("changed.ts");
    expect(await ends(label, config)).toEqual([[null, "current"]]);
  });

  it("--accept keeps a plain entry plain, even with a key available", async () => {
    workspace("source-changed.md");
    const config = tempConfig("", KEY);
    const run = await update({
      inputs: ["pages/source-changed.md"],
      noConfig: false,
      configPath: config,
      accept: true,
    });
    expect(run.pages[0]?.rewritten.map((r) => r.to)).toEqual([CHANGED_L2]);
    expect(onDisk("pages/source-changed.md")).not.toMatch(/file: ~/);
  });
});

describe("runUpdate: both ends, and what is left", () => {
  it("repairs a moved claim and a moved source on one page, in one pass", async () => {
    workspace();
    const label = write("both.md", [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    claim:",
      "      lines: 1",
      `      integrity: ${CLAIM_10}`,
      "    source:",
      "      file: src/moved.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "---",
      "A paragraph someone added above it.",
      "",
      "The fetch timeout is 10 seconds.",
    ]);
    const run = await update({ inputs: [label] });
    expect(run).toMatchObject({ rewritten: 2, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.from, r.to])).toEqual([
      ["claim", "12", "14"],
      ["source", "src/moved.ts:2", "src/moved.ts:4"],
    ]);
    expect(await ends(label)).toEqual([["current", "current"]]);
  });

  it("limits the work to the ids named by --only", async () => {
    workspace();
    const label = write("two.md", [
      "---",
      "citations:",
      "  - id: one",
      "    source:",
      "      file: src/moved.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "  - id: two",
      "    source:",
      "      file: src/moved.ts",
      "      lines: 3",
      `      integrity: ${PIN_L3}`,
      "---",
      "Body.",
    ]);
    const run = await update({ inputs: [label], only: ["one"] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => [r.id, r.to])).toEqual([["one", "src/moved.ts:4"]]);
    expect(await ends(label)).toEqual([
      [null, "current"],
      [null, "moved"],
    ]);
    // An id nothing carries: nothing to do, and nothing skipped either.
    const none = await update({ inputs: [label], only: ["nope"] });
    expect(none).toMatchObject({ rewritten: 0, skipped: 0, exitCode: 0 });
    expect(none.pages[0]?.written).toBe(false);
  });

  it("prints the diff and writes nothing under --dry-run", async () => {
    workspace("moved.md");
    const before = onDisk("pages/moved.md");
    const run = await update({ inputs: ["pages/moved.md"], dryRun: true });
    expect(run.rewritten).toBe(1);
    expect(run.pages[0]?.written).toBe(false);
    expect(run.pages[0]?.diff).toContain("+      lines: 4");
    expect(onDisk("pages/moved.md")).toBe(before);
  });

  it("reports what it could not fix and exits 1 for an error left behind", async () => {
    workspace("missing.md", "current.md");
    const run = await update({ inputs: ["pages/current.md", "pages/missing.md"], accept: true });
    expect(
      run.pages.map((p) => [p.file, p.rewritten.length, p.skipped.map((f) => f.rule), p.written]),
    ).toEqual([
      ["pages/current.md", 0, [], false],
      ["pages/missing.md", 0, ["source-missing"], false],
    ]);
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 1 });
  });

  it("does not report as skipped the finding a rewrite settled", async () => {
    workspace("moved.md");
    const run = await update({ inputs: ["pages/moved.md"] });
    expect(run.pages[0]?.skipped).toEqual([]);
    // A marker repeated on the page is about the entry, not an end: it stays.
    workspace("marker-repeated.md");
    const repeated = await update({ inputs: ["pages/marker-repeated.md"], accept: true });
    expect(repeated.pages[0]?.skipped.map((f) => f.rule)).toEqual(["marker-repeated"]);
    expect(repeated.exitCode).toBe(0);
  });

  it("refuses to run without the sources, and with nothing to update", async () => {
    workspace("moved.md");
    const message = "update needs the sources: drop --no-check-sources (or `checkSources: false`).";
    expect(await refusal(update({ inputs: ["pages/moved.md"], checkSources: false }))).toBe(message);
    expect(
      await refusal(
        update({
          inputs: ["pages/moved.md"],
          noConfig: false,
          configPath: tempConfig("checkSources: false"),
        }),
      ),
    ).toBe(message);
    expect(await refusal(update({ inputs: [] }))).toBe(
      "No files to update. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("says once, under --accept, that a re-mint without git records no commit", async () => {
    workspace("source-changed.md");
    const notices: string[] = [];
    const run = await update({
      inputs: ["pages/source-changed.md"],
      accept: true,
      onNotice: (m) => notices.push(m),
    });
    expect(run.rewritten).toBe(1);
    expect(notices).toEqual([NO_COMMIT]);
  });

  it("says nothing about git when nothing needed it", async () => {
    workspace("moved.md", "claim-changed.md");
    const notices: string[] = [];
    await update({
      inputs: ["pages/moved.md", "pages/claim-changed.md"],
      accept: true,
      onNotice: (m) => notices.push(m),
    });
    expect(notices).toEqual([]);
  });

  it("says history is off for a citation with a commit, then that the re-mint records none", async () => {
    workspace();
    const label = write("commit.md", [
      "---",
      "citations:",
      "  - id: fetch-timeout",
      "    source:",
      "      file: src/changed.ts",
      "      lines: 2",
      `      integrity: ${PIN_L2}`,
      "      commit-sha: fc09aeff7891fcbedfe7d127393fc662fd3ddf7a",
      "---",
      "Body.",
    ]);
    const notices: string[] = [];
    const run = await update({ inputs: [label], accept: true, onNotice: (m) => notices.push(m) });
    expect(run.rewritten).toBe(1);
    expect(notices).toEqual([NO_HISTORY, NO_COMMIT]);
  });

  it("falls back to the configured collections when no paths are given", async () => {
    workspace("moved.md");
    const config = join(cwd, "manni.config.yaml");
    writeFileSync(config, "collections:\n  - name: pages\n    paths: ['pages/*.md']\n", "utf8");
    const run = await update({ inputs: [], noConfig: false, configPath: config });
    expect(run.pages.map((p) => [p.file, p.written])).toEqual([["pages/moved.md", true]]);
    expect(run.rewritten).toBe(1);
    expect(await ends("pages/moved.md", config)).toEqual([["current", "current"]]);
  });

  it("takes stdin, returning the rewritten page without writing", async () => {
    workspace();
    const run = await update({
      inputs: ["-"],
      as: "markdown",
      stdinContent: readFileSync(join(PAGES, "moved.md"), "utf8"),
    });
    expect(run.pages[0]).toMatchObject({ file: "<stdin>", written: false });
    expect(run.pages[0]?.rewritten).toHaveLength(1);
    expect(run.pages[0]?.diff).toContain("+      lines: 4");
    expect(run.pages[0]?.content).toContain("      lines: 4\n");
  });

  describe.skipIf(!gitAvailable())("with git", () => {
    let repo: string | undefined;
    afterEach(() => {
      removeTempRepo(repo);
      repo = undefined;
    });

    it("re-mints at HEAD, writing a commit-sha only where the entry records one", async () => {
      repo = makeTempRepo({ files: { "src/limits.ts": source("limits.ts") } });
      const first = commitAll(repo, "add limits");
      writeFileSync(join(repo, "src", "limits.ts"), source("changed.ts"), "utf8");
      const second = commitAll(repo, "raise fetch timeout to 30s");
      mkdirSync(join(repo, "docs"));
      const page = join(repo, "docs", "limits.md");
      writeFileSync(
        page,
        [
          "---",
          "citations:",
          "  - id: pinned",
          "    source:",
          "      file: src/limits.ts",
          "      lines: 2",
          `      integrity: ${PIN_L2}`,
          `      commit-sha: ${first} # minted by hand`,
          "  - id: loose",
          "    source:",
          "      file: src/limits.ts",
          "      lines: 2",
          `      integrity: ${PIN_L2}`,
          "---",
          "Body.",
          "",
        ].join("\n"),
        "utf8",
      );
      const run = await runUpdate({
        cwd: repo,
        inputs: ["docs/limits.md"],
        noConfig: true,
        accept: true,
        env: {},
      });
      expect(run.pages[0]?.rewritten).toEqual([
        {
          id: "pinned",
          index: 0,
          line: 3,
          end: "source",
          reason: "accepted",
          status: "changed",
          from: PIN_L2,
          to: CHANGED_L2,
          src: "src/limits.ts:2",
          commitSha: second,
        },
        {
          id: "loose",
          index: 1,
          line: 9,
          end: "source",
          reason: "accepted",
          status: "changed",
          from: PIN_L2,
          to: CHANGED_L2,
          src: "src/limits.ts:2",
        },
      ]);
      const after = readFileSync(page, "utf8");
      expect(after).toContain(`      commit-sha: ${second} # minted by hand\n`);
      // The entry that recorded no commit gains none: the splice replaces a
      // scalar, it does not add a key.
      expect(after.match(/commit-sha/g)).toHaveLength(1);
      const check = await runCheck({ cwd: repo, inputs: ["docs/limits.md"], noConfig: true, env: {} });
      expect(check.pages[0]?.citations.map((c) => c.source.status)).toEqual(["current", "current"]);
    });
  });
});
