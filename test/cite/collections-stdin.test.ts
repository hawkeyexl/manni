/**
 * Stdin beside a configured collection.
 *
 * `resolveCiteRun` counted the stdin token `-` as a positional input, so the
 * collections fallback was cancelled by it: `manni cite check - --as markdown
 * --collection pages` read stdin, opened no file of `pages`, reported nothing
 * and exited 0. The refusal just above already treats `-` as one more input
 * rather than a path, so the flag was accepted and then did nothing.
 *
 * Stdin is one more input, so it rides beside the collection the flag names:
 * the run checks the piped page *and* walks the collection's files, in one
 * pass. That holds for `check` and `update`, which share `prepareRun`. A
 * bare `-` with no flag still cancels the implicit fallback, because a piped
 * page is a run of its own.
 *
 * The repository is built with `init: false` and git is injected away, as the
 * fixture cases in check.test.ts do: this is about which paths a run resolves,
 * not about history, so it needs no `git` binary and never skips.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { noGit } from "../../src/cite/core/git.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "fixtures", "cite");
const PAGES = join(ROOT, "pages");
const SRC = join(ROOT, "src");

const source = (name: string): string => readFileSync(join(SRC, name), "utf8");
const page = (name: string): string => readFileSync(join(PAGES, name), "utf8");

/** The one collection the cases select, declared at the family level. */
const COLLECTIONS = "collections:\n  - name: pages\n    paths: ['docs/*.md']\n";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) removeTempRepo(dir);
});

/**
 * A project whose `pages` collection lists three documents: one whose source
 * moved, one that is current, and one whose source changed. Each classifies
 * differently, so a run that really opened them says something different
 * about each.
 */
function configured(): string {
  const dir = makeTempRepo({
    files: {
      "src/changed.ts": source("changed.ts"),
      "src/limits.ts": source("limits.ts"),
      "src/moved.ts": source("moved.ts"),
      "docs/moved.md": page("moved.md"),
      "docs/ok.md": page("current.md"),
      "docs/stale.md": page("source-changed.md"),
      "manni.config.yaml": COLLECTIONS + "cite:\n  root: .\n",
    },
    init: false,
  });
  temps.push(dir);
  return dir;
}

/** Stdin first, then the collection's files in the order the glob resolves. */
const LABELS = ["<stdin>", "docs/moved.md", "docs/ok.md", "docs/stale.md"];

describe("--collection is honoured with stdin beside it", () => {
  it("checks the collection's pages beside <stdin> under --collection", async () => {
    const dir = configured();
    const run = await runCheck({
      cwd: dir,
      inputs: ["-"],
      as: "markdown",
      stdinContent: page("current.md"),
      collection: ["pages"],
      gitClient: noGit(),
      env: {},
    });
    expect(run.results.map((r) => r.file)).toEqual(LABELS);
    expect(run.summary.files).toBe(LABELS.length);
    // A finding only a page that was read and classified could produce.
    const stale = run.pages.find((p) => p.file === "docs/stale.md");
    expect(stale?.citations.map((c) => c.source.status)).toEqual(["changed"]);
    expect(stale?.findings.map((f) => f.rule)).toEqual(["source-changed"]);
  });

  it("updates the collection's pages beside <stdin> under --collection", async () => {
    const dir = configured();
    const run = await runUpdate({
      cwd: dir,
      inputs: ["-"],
      as: "markdown",
      stdinContent: page("current.md"),
      collection: ["pages"],
      dryRun: true,
      gitClient: noGit(),
      env: {},
    });
    expect(run.pages.map((p) => p.file)).toEqual(LABELS);
    const moved = run.pages.find((p) => p.file === "docs/moved.md");
    expect(moved?.written).toBe(false);
    expect(moved?.rewritten).toHaveLength(1);
    expect(moved?.rewritten[0]).toMatchObject({
      id: "fetch-timeout",
      index: 0,
      end: "source",
      reason: "moved",
      status: "moved",
    });
    expect(moved?.diff).toContain("+      lines: 4");
  });

  it("checks <stdin> alone when no --collection is given", async () => {
    // The other side of the rule: `--collection` is a request the run honours,
    // the *implicit* fallback is not, and a piped page is a run of its own.
    const dir = configured();
    const run = await runCheck({
      cwd: dir,
      inputs: ["-"],
      as: "markdown",
      stdinContent: page("current.md"),
      gitClient: noGit(),
      env: {},
    });
    expect(run.results.map((r) => r.file)).toEqual(["<stdin>"]);
  });
});
