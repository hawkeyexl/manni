/**
 * Citations kept in an external-metadata manifest (proposal 0044, "the
 * sidecar is external metadata").
 *
 * `test/fixtures/cite-sidecar` is the family: a `site` collection whose
 * manifest is keyed by page path, a `guides` collection whose manifest is
 * keyed by a page field, and four sub-fixtures, one per refusal. The pages
 * carry no `citations:` of their own except `pages/own.md`, which carries one
 * on purpose.
 *
 * Every run injects `noGit()`: a fixture added on a branch is not tracked
 * yet, and a `git ls-files` index would call every source missing. Every run
 * passes its own `env`, so a developer's `MANNI_ENCRYPTION_KEY` is never
 * read.
 *
 * A write is exercised against a copy of the fixture, never the fixture
 * itself, and the page's own bytes are compared before and after: the point
 * of a sidecar is that the page is not touched.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runAdd } from "../../src/cite/commands/add.js";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { errorSite } from "../../src/cite/core/adapt.js";
import { noGit } from "../../src/cite/core/git.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { encryptSourcePath, decryptSourcePath } from "../../src/cite/core/sources.js";
import { CiteError } from "../../src/cite/errors.js";
import { renderCheckGithub } from "../../src/cite/reporters/github.js";
import { renderCheckPretty } from "../../src/cite/reporters/pretty.js";
import { runKeyRotate } from "../../src/key/index.js";
import type { CheckRun } from "../../src/cite/types.js";
import { makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "cite-sidecar");

/** Fixed test keys. Never real ones. */
const OLD = "sidecar-old-key-0123456789abcdef012345";
const NEW = "sidecar-new-key-0123456789abcdef012345";

const temps: string[] = [];
let repo: string | undefined;
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  removeTempRepo(repo);
  repo = undefined;
});

/** A throwaway copy of the whole fixture, for the cases that write. */
function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-cite-sidecar-"));
  temps.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const manifestOf = (dir: string, rel = "citations.yaml"): Record<string, { citations?: unknown[] }> =>
  parseYaml(read(dir, rel)) as Record<string, { citations?: unknown[] }>;

function check(cwd: string, inputs: string[] = [], over = {}): Promise<CheckRun> {
  return runCheck({ cwd, inputs, gitClient: noGit(), env: {}, ...over });
}

/** The page report for one file of a run. */
function pageOf(run: CheckRun, file: string): CheckRun["pages"][number] {
  const page = run.pages.find((p) => p.file === file);
  if (page === undefined) throw new Error(`no report for ${file}`);
  return page;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("reading citations from the manifest that owns them", () => {
  it("finds a page's entries by path, and says where they sit", async () => {
    const run = await check(FIXTURE);
    const page = pageOf(run, "pages/limits.md");
    expect(page.citations).toHaveLength(1);
    const [citation] = page.citations;
    expect(citation?.origin).toEqual({
      kind: "manifest",
      file: "citations.yaml",
      line: 5,
      index: 0,
    });
    // Both ends are judged exactly as a frontmatter entry's are.
    expect([citation?.claim?.status, citation?.source.status]).toEqual(["current", "current"]);
    expect(page.findings).toEqual([]);
  });

  it("finds them by a join field when the manifest is keyed by one", async () => {
    const run = await check(FIXTURE);
    const page = pageOf(run, "guides/guide.md");
    expect(page.citations[0]?.origin.file).toBe("slugs.yaml");
    expect([page.citations[0]?.claim?.status, page.citations[0]?.source.status]).toEqual([
      "current",
      "current",
    ]);
  });

  it("finds the sidecar for a page named by path, not only for a collection run", async () => {
    const run = await check(FIXTURE, ["pages/limits.md"]);
    expect(run.pages).toHaveLength(1);
    expect(pageOf(run, "pages/limits.md").citations[0]?.origin.kind).toBe("manifest");
  });

  it("reads frontmatter only under --no-config", async () => {
    const run = await check(FIXTURE, ["pages/limits.md"], { noConfig: true, root: FIXTURE });
    expect(pageOf(run, "pages/limits.md").citations).toEqual([]);
  });

  it("reports a finding about the entry on the manifest, at the entry's own line", async () => {
    const run = await check(FIXTURE);
    const page = pageOf(run, "pages/entry-invalid.md");
    const [finding] = page.findings;
    expect(finding?.rule).toBe("entry-invalid");
    expect(finding?.file).toBe("citations.yaml");
    expect(finding?.line).toBe(42);
    // The adapted result keeps both, so sarif and junit locate the manifest.
    const result = run.results.find((r) => r.file === "pages/entry-invalid.md");
    expect(result?.errors[0]).toMatchObject({ file: "citations.yaml", line: 42 });
    // And the annotation is written against the manifest, not the page.
    expect(renderCheckGithub(run)).toContain("file=citations.yaml,line=42");
    // Pretty names the file too: line 42 is a line of the manifest, and a
    // bare "(line 42)" would read as line 42 of the page above it.
    expect(renderCheckPretty(run, { color: false })).toContain("(citations.yaml:42)");
  });

  it("keeps a source finding on the page line the citation anchors to", async () => {
    const run = await check(FIXTURE);
    const page = pageOf(run, "pages/moved.md");
    const [finding] = page.findings;
    expect(finding?.rule).toBe("source-moved");
    // A claim or source finding about an anchored citation is read on the
    // page, whatever file the entry is kept in.
    expect(finding?.file).toBeUndefined();
    expect(finding?.line).toBe(6);
  });

  it("calls a page's own citations entry-invalid when a manifest owns the key", async () => {
    const run = await check(FIXTURE);
    const page = pageOf(run, "pages/own.md");
    expect(page.findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      [
        "entry-invalid",
        3,
        '"citations" is owned by manifest citations.yaml (collection site); remove it from the document',
      ],
    ]);
    // The page's own entry is still checked: the report shows what the page
    // would publish, and the manifest's entry for it is not merged over it.
    expect(page.citations.map((c) => [c.citation.id, c.origin.kind])).toEqual([
      ["on-the-page", "frontmatter"],
    ]);
  });

  it("locates a finding on the page when the manifest is outside the tree", () => {
    const base = { rule: "entry-invalid" as const, ruleId: "manni:cite/entry-invalid", severity: "error" as const, message: "x", line: 4 };
    expect(errorSite({ ...base, file: "citations.yaml" })).toEqual({ file: "citations.yaml", line: 4 });
    // SARIF drops a uri that rebases outside the repository, so the finding
    // falls back to the page and leaves the manifest's line behind with it.
    expect(errorSite({ ...base, file: "../private/citations.yaml" })).toEqual({});
  });
});

describe("cite add, writing the manifest", () => {
  it("writes the entry to the manifest and leaves the page byte for byte", async () => {
    const cwd = copyFixture();
    const before = read(cwd, "pages/limits.md");
    const result = await runAdd({
      cwd,
      page: "pages/limits.md",
      pageLines: { start: 8, end: 8 },
      src: "src/limits.ts:3",
      id: "not-configurable",
      commitSha: false,
      gitClient: noGit(),
      env: {},
    });
    expect(result.placed).toBe("manifest");
    expect(result.manifest?.file).toBe("citations.yaml");
    expect(result.manifest?.written).toBe(true);
    expect(result.written).toBe(false);
    expect(read(cwd, "pages/limits.md")).toBe(before);

    const entries = manifestOf(cwd)["pages/limits.md"]?.citations ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      id: "not-configurable",
      source: { file: "src/limits.ts", lines: 3 },
    });
    // The line the message reports is the entry's own.
    const line = result.manifest?.line ?? 0;
    expect(read(cwd, "citations.yaml").split("\n")[line - 1]).toContain("- id: not-configurable");
    // And the entry the run wrote is the entry the next check reads.
    const run = await check(cwd, ["pages/limits.md"]);
    expect(pageOf(run, "pages/limits.md").citations.map((c) => c.citation.id)).toEqual([
      "fetch-timeout",
      "not-configurable",
    ]);
  });

  it("creates the entry for a page the manifest does not name yet", async () => {
    const cwd = copyFixture();
    const result = await runAdd({
      cwd,
      page: "pages/retries.md",
      pageLines: { start: 6, end: 6 },
      src: "src/limits.ts:3",
      id: "retries",
      commitSha: false,
      gitClient: noGit(),
      env: {},
    });
    expect(result.placed).toBe("manifest");
    const manifest = manifestOf(cwd);
    expect(Object.keys(manifest)).toContain("pages/retries.md");
    expect(manifest["pages/retries.md"]?.citations).toHaveLength(1);
    // Every other entry is untouched: the splice rewrote one value.
    expect(manifest["pages/limits.md"]?.citations).toHaveLength(1);
    const run = await check(cwd, ["pages/retries.md"]);
    const [citation] = pageOf(run, "pages/retries.md").citations;
    expect([citation?.claim?.status, citation?.source.status]).toEqual(["current", "current"]);
  });

  it("refuses a second entry with an id the manifest already uses", async () => {
    const cwd = copyFixture();
    expect(
      await refusal(
        runAdd({
          cwd,
          page: "pages/limits.md",
          pageLines: { start: 6, end: 6 },
          src: "src/limits.ts:2",
          id: "fetch-timeout",
          commitSha: false,
          gitClient: noGit(),
          env: {},
        }),
      ),
    ).toBe("pages/limits.md already has an entry fetch-timeout.");
  });

  it("prints the manifest's diff under --dry-run and writes nothing", async () => {
    const cwd = copyFixture();
    const before = read(cwd, "citations.yaml");
    const result = await runAdd({
      cwd,
      page: "pages/retries.md",
      pageLines: { start: 6, end: 6 },
      src: "src/limits.ts:3",
      id: "retries",
      commitSha: false,
      dryRun: true,
      gitClient: noGit(),
      env: {},
    });
    expect(result.manifest?.written).toBe(false);
    expect(result.manifest?.diff).toContain("+pages/retries.md:");
    expect(result.manifest?.diff).toContain("--- citations.yaml");
    expect(read(cwd, "citations.yaml")).toBe(before);
  });

  it("writes a join-keyed manifest under the page's own value of the field", async () => {
    const cwd = copyFixture();
    const result = await runAdd({
      cwd,
      page: "guides/guide.md",
      src: "src/limits.ts",
      id: "whole-file",
      commitSha: false,
      gitClient: noGit(),
      env: {},
    });
    expect(result.manifest?.file).toBe("slugs.yaml");
    expect(manifestOf(cwd, "slugs.yaml")["guide-one"]?.citations).toHaveLength(2);
  });
});

describe("cite update, writing the manifest", () => {
  it("rewrites a moved end in the manifest and leaves the page alone", async () => {
    const cwd = copyFixture();
    const before = read(cwd, "pages/moved.md");
    const run = await runUpdate({
      cwd,
      inputs: ["pages/moved.md"],
      gitClient: noGit(),
      env: {},
    });
    expect(run.pages[0]?.rewritten.map((r) => [r.end, r.reason, r.to])).toEqual([
      ["source", "moved", "src/moved.ts:4"],
    ]);
    expect(run.pages[0]?.written).toBe(false);
    expect(read(cwd, "pages/moved.md")).toBe(before);
    const entry = manifestOf(cwd)["pages/moved.md"]?.citations?.[0] as {
      source: { lines: number };
    };
    expect(entry.source.lines).toBe(4);
    // The neighbours of the value that moved are untouched.
    expect(read(cwd, "citations.yaml")).toContain(
      "# The site collection's citations, keyed by page path relative to this file.",
    );
    expect(await check(cwd, ["pages/moved.md"]).then((r) => pageOf(r, "pages/moved.md").findings)).toEqual([]);
  });

  it("writes one manifest once for two pages repaired in one run", async () => {
    const cwd = copyFixture();
    const run = await runUpdate({ cwd, inputs: [], gitClient: noGit(), env: {} });
    expect(run.rewritten).toBe(2);
    expect(run.manifests?.map((m) => [m.file, m.written])).toEqual([["citations.yaml", true]]);
    const manifest = manifestOf(cwd);
    const lines = (page: string): unknown =>
      (manifest[page]?.citations?.[0] as { source: { lines: number } }).source.lines;
    expect([lines("pages/moved.md"), lines("pages/moved-two.md")]).toEqual([4, 4]);
  });

  it("writes nothing under --dry-run, and reports the diff it would write", async () => {
    const cwd = copyFixture();
    const before = read(cwd, "citations.yaml");
    const run = await runUpdate({ cwd, inputs: [], dryRun: true, gitClient: noGit(), env: {} });
    expect(run.rewritten).toBe(2);
    expect(run.manifests?.[0]?.written).toBe(false);
    expect(run.manifests?.[0]?.diff).toContain("-        lines: 2");
    expect(run.manifests?.[0]?.diff).toContain("+        lines: 4");
    expect(read(cwd, "citations.yaml")).toBe(before);
  });
});

describe("refusals", () => {
  it("refuses a URL manifest that owns citations", async () => {
    expect(await refusal(check(join(FIXTURE, "url")))).toBe(
      "manni.config.yaml: collection site: citations cannot come from a URL manifest, because cite writes them.",
    );
  });

  it("refuses a page whose two collections both keep citations in a manifest", async () => {
    expect(await refusal(check(join(FIXTURE, "conflict")))).toBe(
      "docs/page.md is in collections site and api, and both keep citations in a manifest.",
    );
  });

  it("refuses `add` from stdin when a manifest owns the page's citations", async () => {
    const message = await refusal(
      runAdd({
        cwd: FIXTURE,
        page: "-",
        as: "markdown",
        stdinContent: "# A page\n\nA claim.\n",
        pageLines: { start: 3, end: 3 },
        src: "src/limits.ts:2",
        commitSha: false,
        gitClient: noGit(),
        env: {},
      }),
    );
    expect(message).toBe(
      "A page read from stdin has no path, and its citations live in citations.yaml, which is keyed by path.",
    );
  });

  it("refuses two pages sharing one join value", async () => {
    expect(await refusal(check(join(FIXTURE, "duplicate")))).toBe(
      '2 pages carry slug "shared"; citations.yaml cannot tell them apart (docs/a.md, docs/b.md).',
    );
  });

  it("refuses an orphan entry on a corpus run, and not on a run given paths", async () => {
    const orphan = join(FIXTURE, "orphan");
    expect(await refusal(check(orphan))).toBe(
      'Manifest citations.yaml:3 names "docs/moved-away.md", which this run did not load. Fix the entry, or remove it.',
    );
    // A typed path means the operator chose part of the corpus, so an entry
    // for the rest is expected rather than orphaned.
    await expect(check(orphan, ["docs/page.md"])).resolves.toBeDefined();
  });

  it("refuses every one of them as an operational error", async () => {
    await expect(check(join(FIXTURE, "url"))).rejects.toBeInstanceOf(CiteError);
    await expect(check(join(FIXTURE, "conflict"))).rejects.toBeInstanceOf(CiteError);
    await expect(check(join(FIXTURE, "duplicate"))).rejects.toBeInstanceOf(CiteError);
    await expect(check(join(FIXTURE, "orphan"))).rejects.toBeInstanceOf(CiteError);
  });
});

describe("key rotate over a manifest", () => {
  const SOURCE = ["export const MAX_FILES = 10_000;", "export const FETCH_TIMEOUT_MS = 10_000;", ""].join("\n");
  const CLAIM = "The fetch timeout is 10 seconds.";
  const LINE_2 = { start: 2, end: 2 };

  /** A family whose one citation lives in a manifest, with its source encrypted under `key`. */
  function family(key: string): string {
    const manifest = [
      "docs/limits.md:",
      "  citations:",
      "    - id: fetch-timeout",
      "      claim:",
      "        lines: 2",
      `        integrity: ${hashRange(`${CLAIM}\n`, { start: 1, end: 1 })}`,
      "      source:",
      `        file: ${encryptSourcePath("src/limits.ts", key)}`,
      "        lines: 2",
      `        integrity: ${hashRange(SOURCE, LINE_2, key)}`,
      "",
    ].join("\n");
    repo = makeTempRepo({
      init: false,
      files: {
        "manni.config.yaml": [
          `encryptionKey: ${key}`,
          "collections:",
          "  - name: site",
          '    paths: ["docs/**/*.md"]',
          "    externalMetadata:",
          "      - file: ./citations.yaml",
          "        keys: [citations]",
          "",
        ].join("\n"),
        "citations.yaml": manifest,
        "src/limits.ts": SOURCE,
        "docs/limits.md": `---\ntitle: Limits\n---\n\n${CLAIM}\n`,
      },
    });
    // A boundary for discovery and the source root, without git answering.
    mkdirSync(join(repo, ".git"));
    return repo;
  }

  it("re-encrypts a manifest's citation, and the pin still holds under the new key", async () => {
    const cwd = family(OLD);
    const page = read(cwd, "docs/limits.md");
    const result = await runKeyRotate({
      inputs: [],
      to: NEW,
      cwd,
      env: {},
      gitClient: noGit(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.reencrypted).toBe(1);
    expect(result.pages[0]?.rewritten[0]?.kind).toBe("citation");
    // The page holds no ciphertext at all, and is not rewritten.
    expect(read(cwd, "docs/limits.md")).toBe(page);

    const entry = manifestOf(cwd)["docs/limits.md"]?.citations?.[0] as {
      source: { file: string; integrity: string };
    };
    expect(decryptSourcePath(entry.source.file, NEW)).toBe("src/limits.ts");
    expect(decryptSourcePath(entry.source.file, OLD)).toBeUndefined();
    expect(entry.source.integrity).toBe(hashRange(SOURCE, LINE_2, NEW));

    // The whole point: the citation is still current, under the new key the
    // config now holds.
    const run = await check(cwd);
    expect(pageOf(run, "docs/limits.md").citations[0]?.source.status).toBe("current");
  });

  it("counts a citation already under the new key as done, so a run can be repeated", async () => {
    const cwd = family(OLD);
    await runKeyRotate({ inputs: [], to: NEW, cwd, env: {}, gitClient: noGit() });
    const manifest = read(cwd, "citations.yaml");
    // The same rotation again: the file decrypts under the new key and the
    // pin holds under it, so there is nothing left to do.
    const again = await runKeyRotate({ inputs: [], to: NEW, cwd, env: {}, gitClient: noGit() });
    expect(again.reencrypted).toBe(0);
    expect(again.skipped).toBe(0);
    expect(read(cwd, "citations.yaml")).toBe(manifest);
  });
});
