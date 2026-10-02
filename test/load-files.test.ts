import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { resolveTargetSet, resolveTargets } from "../src/meta/core/load-files.js";
import { DocmetaError } from "../src/meta/types.js";
import { DOC, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = `${here}/fixtures`;

describe("resolveTargets", () => {
  it("includes an explicit file as given", async () => {
    const files = await resolveTargets({
      inputs: ["test/fixtures/valid.md"],
      cwd: `${here}/..`,
    });
    expect(files).toContain("test/fixtures/valid.md");
  });

  it("walks a directory for supported extensions only", async () => {
    const files = await resolveTargets({ inputs: ["."], cwd: fixtures });
    expect(files).toContain("valid.md");
    expect(files).toContain("sample.mdx");
    expect(files).toContain("valid.rst");
    expect(files).toContain("topic.dita");
    // extra.schema.json is .json — not a supported document extension
    expect(files.some((f) => f.endsWith(".json"))).toBe(false);
  });

  it("expands a glob", async () => {
    const files = await resolveTargets({ inputs: ["*.md"], cwd: fixtures });
    expect(files).toContain("valid.md");
    expect(files).not.toContain("sample.mdx");
  });

  it("applies exclude globs", async () => {
    const files = await resolveTargets({
      inputs: ["*.md"],
      exclude: ["missing-*.md"],
      cwd: fixtures,
    });
    expect(files).not.toContain("missing-type.md");
    expect(files).toContain("valid.md");
  });

  it("de-duplicates and sorts", async () => {
    const files = await resolveTargets({
      inputs: ["*.md", "valid.md"],
      cwd: fixtures,
    });
    const validCount = files.filter((f) => f === "valid.md").length;
    expect(validCount).toBe(1);
    expect([...files]).toEqual([...files].sort());
  });

  it("ignores the stdin token", async () => {
    const files = await resolveTargets({ inputs: ["-"], cwd: fixtures });
    expect(files).toEqual([]);
  });
});

describe("resolveTargets: a named file that does not exist is an error", () => {
  it("reports a literal input that does not exist", async () => {
    await expect(
      resolveTargets({ inputs: ["no-such-file.md"], cwd: fixtures }),
    ).rejects.toThrow(DocmetaError);
    await expect(
      resolveTargets({ inputs: ["no-such-file.md"], cwd: fixtures }),
    ).rejects.toThrow(/File not found: "no-such-file\.md"/);
  });

  it("errors even when another input did match", async () => {
    await expect(
      resolveTargets({ inputs: ["valid.md", "no-such-file.md"], cwd: fixtures }),
    ).rejects.toThrow(/no-such-file\.md/);
  });

  it("does not error for a glob that matches nothing", async () => {
    // A pattern matching nothing is the caller's business (see the zero-files
    // check in the command cores); only a *named* file is reported here.
    const files = await resolveTargets({ inputs: ["*.nomatch"], cwd: fixtures });
    expect(files).toEqual([]);
  });

  it("treats a backslash path as a literal name, not a pattern", async () => {
    // picomatch.scan() consumes backslashes as escapes, so `nested\doc.md`
    // would scan as the literal `nesteddoc.md` and be misclassified unless the
    // input is normalized to posix first.
    const files = await resolveTargets({
      inputs: ["nested\\doc.md"],
      cwd: fixtures,
    });
    expect(files).toEqual(["nested/doc.md"]);
  });

  it("reports a missing backslash path under its posix name", async () => {
    await expect(
      resolveTargets({ inputs: ["nested\\nope.md"], cwd: fixtures }),
    ).rejects.toThrow(/nested\/nope\.md/);
  });

  it("allowEmpty suppresses the missing-file error", async () => {
    const files = await resolveTargets({
      inputs: ["valid.md", "no-such-file.md"],
      cwd: fixtures,
      allowEmpty: true,
    });
    expect(files).toEqual(["valid.md"]);
  });

  it("still accepts a directory that exists", async () => {
    const files = await resolveTargets({ inputs: ["nested"], cwd: fixtures });
    expect(files).toContain("nested/doc.md");
  });

  it("ignores the stdin token when checking for missing files", async () => {
    const files = await resolveTargets({ inputs: ["-"], cwd: fixtures });
    expect(files).toEqual([]);
  });
});

/**
 * A directory argument is a path, not a pattern, and the two are not the same
 * string. Both cases here were found by the lint tool against real trees and
 * fixed in its own walker; the fixes moved here when it started sharing this
 * one, because the failures are silent in the way that matters — a docset that
 * is not checked, reported as "no files matched" or as a clean run.
 */
describe("resolveTargets: a directory is walked, not pattern-matched", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function tree(...rel: string[]): Promise<void> {
    dir = await mkdtemp(join(tmpdir(), "manni-walk-"));
    for (const path of rel) {
      const abs = join(dir, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, "---\ntype: how-to\n---\n\n# T\n", "utf8");
    }
  }

  // `docs (2024)` and `Program Files (x86)` are ordinary directories, and
  // every one of `(`, `)`, `[`, `!`, `+`, `@` is a glob metacharacter.
  // Interpolated raw, such a directory matches nothing and the run exits 2
  // claiming it is empty.
  it("escapes glob metacharacters in the directory's own name", async () => {
    await tree("docs (2024)/a.md");
    const files = await resolveTargets({ inputs: ["docs (2024)"], cwd: dir });
    expect(files).toEqual(["docs (2024)/a.md"]);
  });

  // A directory outside cwd relativizes to a `../` chain, and a leading
  // wildcard will not cross a `..` segment — so `..` leaves every ignore glob,
  // the node_modules and .git defaults included, silently matching nothing.
  it("still applies excludes when the directory is outside cwd", async () => {
    await tree("docs/intro.md", "docs/drafts/wip.md");
    const files = await resolveTargets({
      inputs: [join(dir, "docs")],
      exclude: ["**/drafts/**"],
      cwd: here,
    });
    expect(files.some((f) => f.endsWith("/intro.md"))).toBe(true);
    expect(files.some((f) => f.includes("/drafts/"))).toBe(false);
  });
});

/**
 * An ignore glob means one thing: it is written in the run's cwd frame,
 * wherever the walked directory happens to sit.
 *
 * The alternative is what a directory-anchored walk produces by itself — an
 * exclude read against the walked directory when the target escapes cwd and
 * against cwd otherwise. One flag, two meanings, chosen by a property of the
 * *target*; and both halves fail silently, one by checking a tree the author
 * excluded, the other by dropping one they did not.
 *
 * A "drafts anywhere" pattern cannot tell the two frames apart, so every test
 * here uses one that can.
 */
describe("resolveTargets: an exclude is read in the cwd frame", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function tree(...rel: string[]): Promise<void> {
    dir = await mkdtemp(join(tmpdir(), "manni-frame-"));
    for (const path of rel) {
      const abs = join(dir, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, "---\ntype: how-to\n---\n\n# T\n", "utf8");
    }
  }

  const posix = (p: string): string => p.replace(/\\/g, "/");

  // `drafts/**` names `<cwd>/drafts`. A tree outside cwd has no such directory
  // in it, so the pattern must remove nothing from it — rather than quietly
  // matching a `drafts` the author was not talking about.
  it("does not let a cwd-relative exclude reach a tree outside cwd", async () => {
    await tree("docs/intro.md", "docs/drafts/wip.md");
    const files = await resolveTargets({
      inputs: [join(dir, "docs")],
      exclude: ["drafts/**"],
      cwd: here,
    });
    expect(files.some((f) => f.endsWith("/intro.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("/drafts/wip.md"))).toBe(true);
  });

  // ...and the pattern that *does* name that directory in the cwd frame has to
  // work, or a tree outside cwd cannot be excluded at all.
  it("applies an exclude written as the `../` path the run reports", async () => {
    await tree("docs/intro.md", "docs/drafts/wip.md");
    const drafts = posix(relative(here, join(dir, "docs", "drafts")));
    const files = await resolveTargets({
      inputs: [join(dir, "docs")],
      exclude: [`${drafts}/**`],
      cwd: here,
    });
    expect(files.some((f) => f.endsWith("/intro.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("/drafts/wip.md"))).toBe(false);
  });

  // The defaults are ignore globs like any other, so they shift frames like any
  // other: a vendored docset resolves to nothing under cwd and to a file list
  // outside it. Both spellings name the same kind of tree.
  it("applies the node_modules default wherever the tree sits", async () => {
    await tree("vendor/node_modules/pkg/docs/a.md");
    const inside = await resolveTargets({
      inputs: ["vendor/node_modules/pkg/docs"],
      cwd: dir,
    });
    const outside = await resolveTargets({
      inputs: [join(dir, "vendor", "node_modules", "pkg", "docs")],
      cwd: here,
    });
    expect(inside).toEqual([]);
    expect(outside).toEqual([]);
  });

  // `relative()` answers `..archive` for `<cwd>/..archive`, which begins with
  // `..` without escaping anything. Read as an escape, an ordinary directory
  // inside cwd had its excludes measured from the wrong place.
  it("treats a directory whose name merely starts with `..` as inside cwd", async () => {
    await tree("..archive/intro.md", "..archive/drafts/wip.md");
    const files = await resolveTargets({
      inputs: ["..archive"],
      exclude: ["..archive/drafts/**"],
      cwd: dir,
    });
    expect(files).toEqual(["..archive/intro.md"]);
  });
});

/**
 * `.gitignore`-aware discovery.
 *
 * Every repo here is built at runtime by `makeTempRepo` — see that helper for
 * why a gitignored fixture cannot live in `test/fixtures/`.
 */
describe("resolveTargets: .gitignore-aware discovery", () => {
  let repo: string | undefined;

  // Cleanup runs whether the test passed or threw, so a failing assertion
  // never leaves a temp repo behind.
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  /** A repo with `build/` ignored and one document on each side of the line. */
  const buildIgnored = (init = true): string =>
    makeTempRepo({
      init,
      files: {
        ".gitignore": "build/\n",
        "build/x.md": DOC,
        "docs/x.md": DOC,
      },
    });

  it("drops a gitignored file from a glob expansion", async () => {
    repo = buildIgnored();
    const files = await resolveTargets({ inputs: ["**/*.md"], cwd: repo });
    expect(files).toEqual(["docs/x.md"]);
  });

  it("drops a gitignored file from a directory walk", async () => {
    repo = buildIgnored();
    const files = await resolveTargets({ inputs: ["."], cwd: repo });
    expect(files).toEqual(["docs/x.md"]);
  });

  /**
   * The control for the two above: the *filter* has to be what excludes
   * `build/x.md`. Remove the `git init` and the same tree must keep both files
   * — otherwise those tests would still pass on a machine with no git, where
   * the filter silently does nothing.
   */
  it("keeps everything in the same tree when there is no repository", async () => {
    repo = buildIgnored(false);
    const files = await resolveTargets({ inputs: ["**/*.md"], cwd: repo });
    expect(files).toEqual(["build/x.md", "docs/x.md"]);
  });

  it("never filters an explicitly named file", async () => {
    repo = buildIgnored();
    const files = await resolveTargets({
      inputs: ["build/x.md", "docs/x.md"],
      cwd: repo,
    });
    expect(files).toEqual(["build/x.md", "docs/x.md"]);
  });

  it("keeps an explicitly named file that a glob in the same run also matched", async () => {
    repo = buildIgnored();
    const files = await resolveTargets({
      inputs: ["**/*.md", "build/x.md"],
      cwd: repo,
    });
    expect(files).toEqual(["build/x.md", "docs/x.md"]);
  });

  it("respectGitignore: false keeps ignored files", async () => {
    repo = buildIgnored();
    const files = await resolveTargets({
      inputs: ["**/*.md"],
      cwd: repo,
      respectGitignore: false,
    });
    expect(files).toEqual(["build/x.md", "docs/x.md"]);
  });

  /**
   * git's own semantics, asserted rather than reimplemented: `!keep.md` does
   * not rescue a file inside an excluded directory. This is the case that
   * killed the hand-rolled picomatch translation.
   */
  it("honors a nested .gitignore, and does not re-include below an excluded directory", async () => {
    repo = makeTempRepo({
      files: {
        ".gitignore": "build/\n",
        "docs/.gitignore": "tmp/\n!keep.md\n",
        "docs/real.md": DOC,
        "docs/tmp/x.md": DOC,
        "docs/tmp/keep.md": DOC,
        "build/x.md": DOC,
      },
    });
    const files = await resolveTargets({ inputs: ["**/*.md"], cwd: repo });
    expect(files).toEqual(["docs/real.md"]);
  });

  /**
   * `git check-ignore` exits 1 when nothing matched. That is a successful
   * answer meaning "keep everything", and reading it as a failure would make
   * the filter no-op in the common clean case.
   */
  it("keeps every file when nothing is ignored (check-ignore exits 1)", async () => {
    repo = makeTempRepo({
      files: {
        ".gitignore": "never-matches-anything/\n",
        "a.md": DOC,
        "docs/b.md": DOC,
      },
    });
    // The file list alone cannot tell the two readings of exit 1 apart —
    // "keep everything" and "git failed, so filter nothing" produce the same
    // answer here. The notice is what distinguishes them: git answered, so
    // nothing may be reported as unavailable.
    let told = 0;
    const files = await resolveTargets({
      inputs: ["**/*.md"],
      cwd: repo,
      onGitignoreUnavailable: () => {
        told += 1;
      },
    });
    expect(files).toEqual(["a.md", "docs/b.md"]);
    expect(told).toBe(0);
  });

  it("keeps every file when git is not on PATH", async () => {
    repo = buildIgnored();
    const realPath = process.env.PATH;
    try {
      // Point PATH at a directory that exists but holds no executables, so the
      // spawn fails the way a minimal CI container would.
      process.env.PATH = join(repo, "docs");
      const files = await resolveTargets({ inputs: ["**/*.md"], cwd: repo });
      expect(files).toEqual(["build/x.md", "docs/x.md"]);
    } finally {
      process.env.PATH = realPath;
    }
  });

  it("reports that git could not answer, when a caller asked to be told", async () => {
    repo = buildIgnored();
    const realPath = process.env.PATH;
    let told = 0;
    try {
      process.env.PATH = join(repo, "docs");
      await resolveTargets({
        inputs: ["**/*.md"],
        cwd: repo,
        onGitignoreUnavailable: () => {
          told += 1;
        },
      });
    } finally {
      process.env.PATH = realPath;
    }
    expect(told).toBe(1);
  });

  it("stays silent when git answered normally", async () => {
    repo = buildIgnored();
    let told = 0;
    await resolveTargets({
      inputs: ["**/*.md"],
      cwd: repo,
      onGitignoreUnavailable: () => {
        told += 1;
      },
    });
    expect(told).toBe(0);
  });

  it("filters a run started from a subdirectory of the git root", async () => {
    repo = makeTempRepo({
      files: {
        ".gitignore": "build/\n",
        "docs/real.md": DOC,
        "docs/build/x.md": DOC,
      },
    });
    const files = await resolveTargets({
      inputs: ["**/*.md"],
      cwd: join(repo, "docs"),
    });
    expect(files).toEqual(["real.md"]);
  });

  /**
   * Candidates spanning more than one repository (proposal 0037). A config in
   * one checkout whose `paths:` reach into another is the external-metadata layout, and
   * `git check-ignore` refuses a path outside the repository it runs in with
   * exit 128 — which used to read as "git unavailable" for the *whole* batch,
   * so one cross-root candidate silently switched filtering off for every
   * file in the run, including the ones in the config's own repository.
   */
  describe("candidates in more than one repository", () => {
    /** `private/` and `public/` as sibling repositories under one temp dir. */
    const siblings = (): string => {
      const dir = makeTempRepo({
        init: false,
        files: {
          "private/.gitignore": "scratch/\n",
          "private/notes/a.md": DOC,
          "private/scratch/b.md": DOC,
          "public/.gitignore": "build/\n",
          "public/docs/x.md": DOC,
          "public/build/x.md": DOC,
        },
      });
      execFileSync("git", ["init", "-q"], { cwd: join(dir, "private"), stdio: "ignore" });
      execFileSync("git", ["init", "-q"], { cwd: join(dir, "public"), stdio: "ignore" });
      return dir;
    };

    it("honors each repository's .gitignore when a run spans two of them", async () => {
      repo = siblings();
      const files = await resolveTargets({
        inputs: ["**/*.md", "../public/**/*.md"],
        cwd: join(repo, "private"),
      });
      expect(files).toEqual(["../public/docs/x.md", "notes/a.md"]);
    });

    it("does not report git as unavailable for a cross-root run", async () => {
      repo = siblings();
      let told = 0;
      await resolveTargets({
        inputs: ["../public/**/*.md"],
        cwd: join(repo, "private"),
        onGitignoreUnavailable: () => {
          told += 1;
        },
      });
      expect(told).toBe(0);
    });

    it("honors the .gitignore of a repository nested inside the run's own", async () => {
      repo = makeTempRepo({
        files: {
          ".gitignore": "tmp/\n",
          "tmp/z.md": DOC,
          "public/.gitignore": "build/\n",
          "public/docs/x.md": DOC,
          "public/build/x.md": DOC,
        },
      });
      execFileSync("git", ["init", "-q"], { cwd: join(repo, "public"), stdio: "ignore" });
      const files = await resolveTargets({ inputs: ["**/*.md"], cwd: repo });
      expect(files).toEqual(["public/docs/x.md"]);
    });

    it("keeps the candidates of a repository git cannot answer for, and still filters the rest", async () => {
      // `public/.git` is a file that is not a gitdir pointer, so the root
      // walk finds a repository there and git refuses to work in it (exit
      // 128). That must not switch filtering off for `private/`, and must
      // not be reported as "no files were skipped" when some were.
      repo = makeTempRepo({
        init: false,
        files: {
          "private/.gitignore": "scratch/\n",
          "private/notes/a.md": DOC,
          "private/scratch/b.md": DOC,
          "public/.git": "not a gitdir\n",
          "public/docs/x.md": DOC,
        },
      });
      execFileSync("git", ["init", "-q"], { cwd: join(repo, "private"), stdio: "ignore" });
      let told = 0;
      const files = await resolveTargets({
        inputs: ["**/*.md", "../public/**/*.md"],
        cwd: join(repo, "private"),
        onGitignoreUnavailable: () => {
          told += 1;
        },
      });
      expect(files).toEqual(["../public/docs/x.md", "notes/a.md"]);
      expect(told).toBe(0);
    });

    it("keeps a candidate that lives in no repository, and still filters the rest", async () => {
      repo = makeTempRepo({
        init: false,
        files: {
          "loose/l.md": DOC,
          "inner/.gitignore": "build/\n",
          "inner/docs/x.md": DOC,
          "inner/build/x.md": DOC,
        },
      });
      execFileSync("git", ["init", "-q"], { cwd: join(repo, "inner"), stdio: "ignore" });
      let told = 0;
      const files = await resolveTargets({
        inputs: ["**/*.md"],
        cwd: repo,
        onGitignoreUnavailable: () => {
          told += 1;
        },
      });
      expect(files).toEqual(["inner/docs/x.md", "loose/l.md"]);
      expect(told).toBe(0);
    });
  });
});

/**
 * The skipped count, which is what makes a quieter gate auditable rather than
 * silent. It answers "how many candidate documents did .gitignore remove",
 * so it counts only files that survived the extension filter.
 */
describe("resolveTargetSet: what .gitignore removed", () => {
  let repo: string | undefined;

  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("counts the documents it dropped", async () => {
    repo = makeTempRepo({
      files: {
        ".gitignore": "build/\n",
        "build/a.md": DOC,
        "build/b.md": DOC,
        "docs/c.md": DOC,
      },
    });
    const resolved = await resolveTargetSet({ inputs: ["**/*.md"], cwd: repo });
    expect(resolved.files).toEqual(["docs/c.md"]);
    expect(resolved.gitignoreSkipped).toBe(2);
  });

  it("counts only extension-eligible files, not everything git ignores", async () => {
    repo = makeTempRepo({
      files: {
        ".gitignore": "build/\n",
        "build/a.md": DOC,
        "build/bundle.js": "//\n",
        "build/styles.css": "a{}\n",
        "docs/c.md": DOC,
      },
    });
    const resolved = await resolveTargetSet({ inputs: ["**/*"], cwd: repo });
    expect(resolved.files).toEqual(["docs/c.md"]);
    expect(resolved.gitignoreSkipped).toBe(1);
  });

  it("does not count a dropped file twice when two inputs both matched it", async () => {
    repo = makeTempRepo({
      files: { ".gitignore": "build/\n", "build/a.md": DOC, "docs/c.md": DOC },
    });
    const resolved = await resolveTargetSet({
      inputs: ["**/*.md", "build/*.md"],
      cwd: repo,
    });
    expect(resolved.gitignoreSkipped).toBe(1);
  });

  it("does not count an explicitly named file that git ignores", async () => {
    repo = makeTempRepo({
      files: { ".gitignore": "build/\n", "build/a.md": DOC, "docs/c.md": DOC },
    });
    const resolved = await resolveTargetSet({
      inputs: ["**/*.md", "build/a.md"],
      cwd: repo,
    });
    expect(resolved.files).toEqual(["build/a.md", "docs/c.md"]);
    expect(resolved.gitignoreSkipped).toBe(0);
  });

  it("counts nothing when there is no repository to ask", async () => {
    repo = makeTempRepo({
      init: false,
      files: { ".gitignore": "build/\n", "build/a.md": DOC, "docs/c.md": DOC },
    });
    const resolved = await resolveTargetSet({ inputs: ["**/*.md"], cwd: repo });
    expect(resolved.files).toEqual(["build/a.md", "docs/c.md"]);
    expect(resolved.gitignoreSkipped).toBe(0);
  });
});
