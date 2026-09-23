/**
 * cite over a manifest per page (proposal 0058, as amended by the approved
 * plan).
 *
 * `test/fixtures/per-page/cite` declares `file: "{page}.citations.yaml"`, so
 * `docs/limits.md` keeps its citations in `docs/limits.citations.yaml` and
 * `docs/timeout.md` in `docs/timeout.citations.yaml`. `docs/uncited.md` has
 * no manifest at all. Every manifest here already exists: creating one is the
 * writer's business, tested with the writers.
 *
 * `cite-stray` adds a manifest whose page is gone, which a full run refuses
 * and a one-page run never walks to. `cite-conflict` is two collections
 * owning one page's citations through two patterns.
 *
 * Every run injects `noGit()` for the sources and its own `env`, as the
 * sidecar suite does. The `.gitignore` warning needs git to answer, so that
 * case builds a real repository and skips where git is absent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { runAdd } from "../../src/cite/commands/add.js";
import { runCheck } from "../../src/cite/commands/check.js";
import { runRemove } from "../../src/cite/commands/remove.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { noGit } from "../../src/cite/core/git.js";
import { CiteError } from "../../src/cite/errors.js";
import { renderCheckPretty } from "../../src/cite/reporters/pretty.js";
import type { CheckRun } from "../../src/cite/types.js";
import { runValidate } from "../../src/meta/commands/validate.js";
import { DocmetaError } from "../../src/meta/types.js";
import { resetWarnings } from "../../src/shared/warn.js";
import { gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "fixtures", "per-page");
const FIXTURE = join(FIXTURES, "cite");
const STRAY = join(FIXTURES, "cite-stray");
const NO_COLOR = { color: false };

const STRAY_REFUSAL =
  'Manifest docs/old.citations.yaml:1 names "docs/old.md", which this run did not load. Fix the entry, or remove the file.';

const temps: string[] = [];
let repo: string | undefined;
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  removeTempRepo(repo);
  repo = undefined;
});

/** A throwaway copy of a fixture, for the cases that write. */
function copyOf(fixture = FIXTURE): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-cite-per-page-"));
  temps.push(dir);
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");
const manifestOf = (dir: string, rel: string): Record<string, { citations?: unknown[] }> =>
  parseYaml(read(dir, rel)) as Record<string, { citations?: unknown[] }>;

/** Every file under `dir`, relative and posix, to prove nothing literal was written. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map((f) => f.split("\\").join("/"));
}

function check(cwd: string, inputs: string[] = [], over = {}): Promise<CheckRun> {
  return runCheck({ cwd, inputs, gitClient: noGit(), env: {}, ...over });
}

function pageOf(run: CheckRun, file: string): CheckRun["pages"][number] {
  const page = run.pages.find((p) => p.file === file);
  if (page === undefined) throw new Error(`no report for ${file}`);
  return page;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("cite reads each page's own manifest", () => {
  it("finds a page's entries in the file {page} names for it", async () => {
    const run = await check(FIXTURE);
    expect(pageOf(run, "docs/limits.md").citations[0]?.origin).toEqual({
      kind: "manifest",
      file: "docs/limits.citations.yaml",
      // Under the file's comment line.
      line: 4,
      index: 0,
    });
    expect(pageOf(run, "docs/timeout.md").citations[0]?.origin).toEqual({
      kind: "manifest",
      file: "docs/timeout.citations.yaml",
      line: 3,
      index: 0,
    });
    for (const file of ["docs/limits.md", "docs/timeout.md"]) {
      const [citation] = pageOf(run, file).citations;
      expect([citation?.claim?.status, citation?.source.status]).toEqual(["current", "current"]);
    }
  });

  it("reads a page with no manifest as citing nothing, and passes (stress test 1)", async () => {
    const run = await check(FIXTURE);
    expect(pageOf(run, "docs/uncited.md").citations).toEqual([]);
    expect(pageOf(run, "docs/uncited.md").findings).toEqual([]);
    expect(run.summary.failed).toBe(0);
  });

  it("reads the one manifest of a page named by path", async () => {
    const run = await check(FIXTURE, ["docs/timeout.md"]);
    expect(run.pages).toHaveLength(1);
    expect(pageOf(run, "docs/timeout.md").citations[0]?.origin.file).toBe("docs/timeout.citations.yaml");
  });

  it("names the page's own manifest when the page also carries citations", async () => {
    const cwd = copyOf();
    const page = read(cwd, "docs/limits.md").replace("title: Limits", "title: Limits\ncitations: []");
    writeFileSync(join(cwd, "docs/limits.md"), page);
    const run = await check(cwd, ["docs/limits.md"]);
    expect(pageOf(run, "docs/limits.md").findings.map((f) => f.message)).toContain(
      '"citations" is owned by manifest docs/limits.citations.yaml (collection site); remove it from the document',
    );
  });
});

describe("cite writes each page's own manifest", () => {
  it("add appends to the page's manifest, and to no other file", async () => {
    const cwd = copyOf();
    const timeout = read(cwd, "docs/timeout.citations.yaml");
    const result = await runAdd({
      cwd,
      page: "docs/limits.md",
      pageLines: { start: 8, end: 8 },
      src: "src/limits.ts:3",
      id: "not-configurable",
      commitSha: false,
      gitClient: noGit(),
      env: {},
    });
    expect(result.placed).toBe("manifest");
    expect(result.manifest?.file).toBe("docs/limits.citations.yaml");
    expect(manifestOf(cwd, "docs/limits.citations.yaml")["docs/limits.md"]?.citations).toHaveLength(2);
    expect(read(cwd, "docs/timeout.citations.yaml")).toBe(timeout);
    expect(filesUnder(cwd).filter((f) => f.includes("{page}"))).toEqual([]);
  });

  it("update rewrites each page's moved end in that page's manifest", async () => {
    const cwd = copyOf();
    // Two lines above the pinned one: every source end moves by two.
    writeFileSync(join(cwd, "src/limits.ts"), `// one\n// two\n${read(cwd, "src/limits.ts")}`);
    const run = await runUpdate({ cwd, inputs: [], gitClient: noGit(), env: {} });
    expect(run.rewritten).toBe(2);
    expect(run.manifests?.map((m) => [m.file, m.written])).toEqual([
      ["docs/limits.citations.yaml", true],
      ["docs/timeout.citations.yaml", true],
    ]);
    const lines = (file: string, page: string): unknown =>
      (manifestOf(cwd, file)[page]?.citations?.[0] as { source: { lines: number } }).source.lines;
    expect(lines("docs/limits.citations.yaml", "docs/limits.md")).toBe(4);
    expect(lines("docs/timeout.citations.yaml", "docs/timeout.md")).toBe(4);
    // The comment above limits.md's entry is a byte the splice keeps.
    expect(read(cwd, "docs/limits.citations.yaml")).toContain("# limits.md's own citations, and nobody else's.");
    expect(filesUnder(cwd).filter((f) => f.includes("{page}"))).toEqual([]);
  });

  it("remove takes the entry out of the page's manifest and leaves the others", async () => {
    const cwd = copyOf();
    const limits = read(cwd, "docs/limits.citations.yaml");
    const run = await runRemove({
      cwd,
      inputs: ["docs/timeout.md"],
      only: ["timeout-claim"],
      gitClient: noGit(),
      env: {},
    });
    expect(run.removed).toBe(1);
    // The page's last citation took its entry with it, and nothing else was there.
    const after = parseYaml(read(cwd, "docs/timeout.citations.yaml")) as Record<string, unknown> | null;
    expect(after?.["docs/timeout.md"]).toBeUndefined();
    expect(read(cwd, "docs/limits.citations.yaml")).toBe(limits);
  });
});

describe("the ownership refusals, with a {page} manifest", () => {
  it("refuses `add` from stdin, naming the pattern", async () => {
    const err = await refusal(
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
    expect(err.message).toBe(
      "A page read from stdin has no path, and its citations live in {page}.citations.yaml, which is keyed by path.",
    );
  });

  it("refuses a page two collections own, although neither manifest exists", async () => {
    const err = await refusal(check(join(FIXTURES, "cite-conflict")));
    expect(err).toBeInstanceOf(CiteError);
    expect(err.message).toBe("docs/page.md is in collections site and api, and both keep citations in a manifest.");
  });
});

describe("a stray manifest (0058 § 5)", () => {
  it("is refused by a full cite run, as an operational error", async () => {
    const err = await refusal(check(STRAY));
    expect(err).toBeInstanceOf(CiteError);
    expect(err.message).toBe(STRAY_REFUSAL);
  });

  it("is refused by cite update and cite remove on a full run too", async () => {
    const cwd = copyOf(STRAY);
    expect((await refusal(runUpdate({ cwd, inputs: [], gitClient: noGit(), env: {} }))).message).toBe(STRAY_REFUSAL);
    expect(
      (await refusal(runRemove({ cwd, inputs: [], only: ["fetch-timeout"], gitClient: noGit(), env: {} }))).message,
    ).toBe(STRAY_REFUSAL);
  });

  it("is refused by a full meta validate run, with the same text", async () => {
    const err = await refusal(runValidate({ cwd: STRAY, inputs: [] }));
    expect(err).toBeInstanceOf(DocmetaError);
    expect(err.message).toBe(STRAY_REFUSAL);
  });

  it("is not walked to by a run given one page", async () => {
    const run = await check(STRAY, ["docs/page.md"]);
    expect(run.pages.map((p) => p.file)).toEqual(["docs/page.md"]);
    await expect(runValidate({ cwd: STRAY, inputs: ["docs/page.md"] })).resolves.toBeDefined();
  });

  it("is not walked to by a run narrowed with --collection", async () => {
    await expect(check(STRAY, [], { collection: ["site"] })).resolves.toBeDefined();
  });

  it("leaves a manifest whose entry names another page's file to the copied-manifest rule", async () => {
    // A copy of the fixture tree somewhere the pattern does not resolve for
    // its entries: `nested/docs/page.citations.yaml` names `docs/page.md`,
    // whose manifest is `docs/page.citations.yaml`. Not this config's file.
    const cwd = copyOf(STRAY);
    rmSync(join(cwd, "docs/old.citations.yaml"));
    cpSync(join(cwd, "docs"), join(cwd, "nested/docs"), { recursive: true });
    rmSync(join(cwd, "nested/docs/page.md"));
    const run = await check(cwd);
    expect(run.pages.map((p) => p.file)).toEqual(["docs/page.md"]);
  });
});

describe("the .gitignore warning", () => {
  let stderr: string[];
  beforeEach(() => {
    resetWarnings();
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The cite fixture as a real repository, with `limits.md`'s manifest ignored. */
  function ignoredRepo(): string {
    const files: Record<string, string> = { ".gitignore": "docs/limits.citations.yaml\n" };
    for (const rel of filesUnder(FIXTURE)) {
      if (statSync(join(FIXTURE, rel)).isFile()) {
        files[rel] = read(FIXTURE, rel);
      }
    }
    repo = makeTempRepo({ files });
    return repo;
  }

  it.skipIf(!gitAvailable())("warns once, on a full run, for a manifest .gitignore covers", async () => {
    const cwd = ignoredRepo();
    await check(cwd);
    await check(cwd);
    const said = stderr.filter((line) => line.includes("covered by .gitignore"));
    expect(said).toEqual([
      "manni: docs/limits.citations.yaml is covered by .gitignore, so CI checks out a page with no citations.\n",
    ]);
  });

  it.skipIf(!gitAvailable())("says nothing on a run given one page", async () => {
    const cwd = ignoredRepo();
    await check(cwd, ["docs/limits.md"]);
    expect(stderr.filter((line) => line.includes("covered by .gitignore"))).toEqual([]);
  });
});

describe("pretty output names a page's one manifest once", () => {
  it("prints the manifest on the page's own line, and drops it from each row", async () => {
    const run = await check(FIXTURE);
    const lines = renderCheckPretty(run, NO_COLOR).split("\n");
    const at = lines.indexOf("✓ docs/limits.md   docs/limits.citations.yaml");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("    ✓ fetch-timeout   :6 current   src/limits.ts:2 current");
    expect(lines).toContain("✓ docs/timeout.md   docs/timeout.citations.yaml");
    // A page with no manifest has nothing to name.
    expect(lines).toContain("✓ docs/uncited.md");
  });
});
