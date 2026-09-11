/**
 * `runUpdate` against temp copies of the fixture pages. `moved.ts` is the
 * ladder SOURCE with two lines above it, so `moved.md`'s pins hold two lines
 * down; `changed.ts` drifted at line 2, so `stale-claim.md` is `changed` and
 * only `--accept` re-mints it. Git is off for the fixture cases, as in
 * check.test.ts; the commit splice runs against a throwaway repository.
 */
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { hashRange } from "../../src/cite/core/hash.js";
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
const PIN_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const PIN_L3 = "sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3";

const source = (name: string): string => readFileSync(join(SRC, name), "utf8");
const CHANGED_L2 = hashRange(source("changed.ts"), { start: 2, end: 2 });

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
  return runUpdate({ cwd, root: ROOT, noConfig: true, git: false, env: {}, ...over });
}

async function statuses(label: string, configPath?: string): Promise<string[]> {
  const run = await runCheck({
    cwd,
    root: ROOT,
    git: false,
    env: {},
    inputs: [label],
    ...(configPath === undefined ? { noConfig: true } : { configPath }),
  });
  return run.pages[0]?.citations.map((c) => c.status) ?? [];
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

describe("runUpdate", () => {
  it("rewrites moved sources in both channels and leaves the rest of the page alone", async () => {
    workspace("moved.md");
    const before = onDisk("pages/moved.md");
    const run = await update({ inputs: ["pages/moved.md"] });
    expect(run).toMatchObject({ rewritten: 2, skipped: 0, exitCode: 0 });
    expect(run.pages).toHaveLength(1);
    const [page] = run.pages;
    expect(page?.file).toBe("pages/moved.md");
    expect(page?.written).toBe(true);
    expect(page?.skipped).toEqual([]);
    expect(page?.rewritten).toEqual([
      { id: "fetch-timeout", index: 0, line: 4, from: "src/moved.ts:2", to: "src/moved.ts:4", reason: "moved" },
      { line: 14, from: "src/moved.ts:3", to: "src/moved.ts:5", reason: "moved" },
    ]);
    const after = onDisk("pages/moved.md");
    expect(after).toContain("    src: src/moved.ts:4\n");
    // The author's spacing survives: only the one value changed.
    expect(after).toContain(`<!-- cite {"src": "src/moved.ts:5", "integrity": "${PIN_L3}", "claim": "Retries default to 3."} -->`);
    // Only those two lines differ.
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(changed).toHaveLength(2);
    expect(page?.diff).toContain("-    src: src/moved.ts:2");
    expect(page?.diff).toContain("+    src: src/moved.ts:4");
    expect(await statuses("pages/moved.md")).toEqual(["current", "current"]);
  });

  it("--accept re-mints an encrypted entry in its own form: encrypted, under the current key", async () => {
    workspace();
    const config = tempConfig("git: false", KEY);
    const token = encryptSourcePath("src/changed.ts", KEY);
    const before = hashRange(source("limits.ts"), { start: 2, end: 2 }, KEY);
    const label = write("token.md", ["---", "citations:", `  - src: ${token}:2`, `    integrity: ${before}`, "---", "Body."]);
    expect(await statuses(label, config)).toEqual(["changed"]);
    const run = await update({ inputs: [label], noConfig: false, configPath: config, accept: true });
    const reminted = hashRange(source("changed.ts"), { start: 2, end: 2 }, KEY);
    expect(run.pages[0]?.rewritten).toEqual([{ index: 0, line: 3, from: before, to: reminted, reason: "accepted" }]);
    const after = onDisk(label);
    expect(after).toContain(`  - src: ${token}:2\n`);
    expect(after).toContain(`    integrity: ${reminted}\n`);
    expect(after).not.toContain("changed.ts");
    expect(await statuses(label, config)).toEqual(["current"]);
  });

  it("--accept keeps a plain entry plain, even with a key available", async () => {
    workspace("stale-claim.md");
    const config = tempConfig("git: false", KEY);
    const run = await update({ inputs: ["pages/stale-claim.md"], noConfig: false, configPath: config, accept: true });
    expect(run.pages[0]?.rewritten.map((r) => r.to)).toEqual([CHANGED_L2]);
    expect(onDisk("pages/stale-claim.md")).not.toMatch(/src: ~/);
  });

  it("keeps an encrypted source encrypted across the move", async () => {
    workspace();
    const config = tempConfig("git: false", KEY);
    const token = encryptSourcePath("src/moved.ts", KEY);
    const label = write("token.md", [
      "---",
      "citations:",
      `  - src: ${token}:2`,
      `    integrity: ${hashRange(source("limits.ts"), { start: 2, end: 2 }, KEY)}`,
      "---",
      "Body.",
    ]);
    const run = await update({ inputs: [label], noConfig: false, configPath: config });
    expect(run.pages[0]?.rewritten).toEqual([{ index: 0, line: 3, from: `${token}:2`, to: `${token}:4`, reason: "moved" }]);
    const after = onDisk(label);
    expect(after).toContain(`  - src: ${token}:4\n`);
    expect(after).not.toContain("moved.ts");
    expect(await statuses(label, config)).toEqual(["current"]);
  });

  it("re-mints a changed entry only under --accept", async () => {
    workspace("stale-claim.md");
    const before = onDisk("pages/stale-claim.md");
    const declined = await update({ inputs: ["pages/stale-claim.md"] });
    expect(declined.exitCode).toBe(1);
    expect(declined.rewritten).toBe(0);
    expect(declined.skipped).toBe(1);
    expect(declined.pages[0]).toMatchObject({ file: "pages/stale-claim.md", rewritten: [], diff: "", written: false });
    expect(declined.pages[0]?.skipped.map((f) => [f.rule, f.severity, f.line])).toEqual([["changed", "error", 9]]);
    expect(onDisk("pages/stale-claim.md")).toBe(before);

    const accepted = await update({ inputs: ["pages/stale-claim.md"], accept: true });
    expect(accepted).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(accepted.pages[0]?.rewritten).toEqual([
      { id: "fetch-timeout", index: 0, line: 4, from: PIN_L2, to: CHANGED_L2, reason: "accepted" },
    ]);
    const after = onDisk("pages/stale-claim.md");
    expect(after).toContain(`    integrity: ${CHANGED_L2}\n`);
    expect(after).not.toContain("commit:");
    expect(after.replace(CHANGED_L2, PIN_L2)).toBe(before);
    expect(await statuses("pages/stale-claim.md")).toEqual(["current"]);
  });

  it("re-mints an inline entry in the statement's own form", async () => {
    workspace("inline.mdx");
    const run = await update({ inputs: ["pages/inline.mdx"], accept: true });
    expect(run.pages[0]?.rewritten).toEqual([
      {
        line: 13,
        from: "sha256-0000000000000000000000000000000000000000000000000000000000000003",
        to: PIN_L3,
        reason: "accepted",
      },
    ]);
    expect(onDisk("pages/inline.mdx")).toContain(`{/* cite {"src": "src/limits.ts:3", "integrity": "${PIN_L3}"} */}`);
    expect(await statuses("pages/inline.mdx")).toEqual(["current", "current"]);
  });

  it("limits the work to the ids named by --only", async () => {
    workspace("moved.md");
    const run = await update({ inputs: ["pages/moved.md"], only: ["fetch-timeout"] });
    expect(run).toMatchObject({ rewritten: 1, skipped: 0, exitCode: 0 });
    expect(run.pages[0]?.rewritten.map((r) => r.to)).toEqual(["src/moved.ts:4"]);
    expect(onDisk("pages/moved.md")).toContain('"src": "src/moved.ts:3"');
    // An id nothing carries: nothing to do, and nothing skipped either.
    workspace("moved.md");
    const none = await update({ inputs: ["pages/moved.md"], only: ["nope"] });
    expect(none).toMatchObject({ rewritten: 0, skipped: 0, exitCode: 0 });
    expect(none.pages[0]?.written).toBe(false);
  });

  it("prints the diff and writes nothing under --dry-run", async () => {
    workspace("moved.md");
    const before = onDisk("pages/moved.md");
    const run = await update({ inputs: ["pages/moved.md"], dryRun: true });
    expect(run.rewritten).toBe(2);
    expect(run.pages[0]?.written).toBe(false);
    expect(run.pages[0]?.diff).toContain("+    src: src/moved.ts:4");
    expect(onDisk("pages/moved.md")).toBe(before);
  });

  it("reports what it could not fix and exits 1 for it", async () => {
    workspace("missing.md", "current.md");
    const run = await update({ inputs: ["pages/current.md", "pages/missing.md"], accept: true });
    expect(run.pages.map((p) => [p.file, p.rewritten.length, p.skipped.map((f) => f.rule), p.written])).toEqual([
      ["pages/current.md", 0, [], false],
      ["pages/missing.md", 0, ["missing"], false],
    ]);
    expect(run).toMatchObject({ rewritten: 0, skipped: 1, exitCode: 1 });
    // A warning left behind is reported but does not fail the run.
    workspace("claim-ambiguous.md");
    const warned = await update({ inputs: ["pages/claim-ambiguous.md"] });
    expect(warned.pages[0]?.skipped.map((f) => [f.rule, f.severity])).toEqual([
      ["claim-ambiguous", "warning"],
      ["changed", "error"],
    ]);
    expect(warned.exitCode).toBe(1);
    const accepted = await update({ inputs: ["pages/claim-ambiguous.md"], accept: true });
    expect(accepted.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-ambiguous"]);
    expect(accepted.exitCode).toBe(0);
  });

  it("refuses to run without the sources", async () => {
    workspace("moved.md");
    const message = "update needs the sources: drop --no-sources (or `sources: false`).";
    expect(await refusal(update({ inputs: ["pages/moved.md"], sources: false }))).toBe(message);
    expect(await refusal(update({ inputs: ["pages/moved.md"], noConfig: false, configPath: tempConfig("sources: false") }))).toBe(message);
    expect(await refusal(update({ inputs: [] }))).toBe(
      "No files to update. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("falls back to the configured collections when no paths are given", async () => {
    workspace("moved.md");
    const config = join(cwd, "manni.config.yaml");
    writeFileSync(config, "collections:\n  - name: pages\n    paths: ['pages/*.md']\ncite:\n  git: false\n", "utf8");
    const run = await update({ inputs: [], noConfig: false, configPath: config });
    expect(run.pages.map((p) => [p.file, p.written])).toEqual([["pages/moved.md", true]]);
    expect(run.rewritten).toBe(2);
    expect(await statuses("pages/moved.md", config)).toEqual(["current", "current"]);
  });

  it("takes stdin, returning the diff without writing", async () => {
    workspace();
    const run = await update({ inputs: ["-"], as: "markdown", stdinContent: readFileSync(join(PAGES, "moved.md"), "utf8") });
    expect(run.pages[0]).toMatchObject({ file: "<stdin>", written: false });
    expect(run.pages[0]?.rewritten).toHaveLength(2);
    expect(run.pages[0]?.diff).toContain("+    src: src/moved.ts:4");
  });

  describe.skipIf(!gitAvailable())("with git", () => {
    let repo: string | undefined;
    afterEach(() => {
      removeTempRepo(repo);
      repo = undefined;
    });

    it("re-mints at HEAD and rewrites the entry's commit line", async () => {
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
          "  - id: fetch-timeout",
          "    src: src/limits.ts:2",
          `    integrity: ${PIN_L2}`,
          `    commit: ${first} # minted by hand`,
          "---",
          "Body.",
          "",
        ].join("\n"),
        "utf8",
      );
      const run = await runUpdate({ cwd: repo, inputs: ["docs/limits.md"], noConfig: true, accept: true });
      expect(run.pages[0]?.rewritten).toEqual([
        { id: "fetch-timeout", index: 0, line: 3, from: PIN_L2, to: CHANGED_L2, reason: "accepted" },
      ]);
      const after = readFileSync(page, "utf8");
      expect(after).toContain(`    integrity: ${CHANGED_L2}\n`);
      expect(after).toContain(`    commit: ${second} # minted by hand\n`);
      const check = await runCheck({ cwd: repo, inputs: ["docs/limits.md"], noConfig: true });
      expect(check.pages[0]?.citations.map((c) => c.status)).toEqual(["current"]);
    });
  });
});
