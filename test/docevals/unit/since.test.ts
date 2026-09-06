/**
 * `--since <ref>` scoping (ADR 01040).
 *
 * Three ways this feature fails without saying so, and every test here exists
 * for one of them.
 *
 * 1. **Path reconciliation.** `git diff --name-only` prints paths relative to
 *    the repository top level; `page.file` is relative to the *discovery* root.
 *    They differ the moment the config lives in a subdirectory — and comparing
 *    them anyway does not throw, it just matches nothing, so every page reads
 *    as unchanged and the run exits 0 having evaluated nothing.
 * 2. **Corpus graders.** `GraderContext` carries targets, not a page list, so
 *    `tool:differentiation` builds its comparison population from what it is
 *    handed. `gradeGroup` returns `[]` below two targets, and no findings is a
 *    *pass* — so narrowing a corpus grader's input silently converts the check
 *    into a pass, by default, in CI. Corpus graders are therefore exempt.
 * 3. **Quoting.** Without `-z`, `core.quotePath` C-escapes non-ASCII paths and
 *    they stop matching, silently.
 *
 * Everything is driven through the injected `ExecFn`; no test here runs git.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { changedFilesSince, changedKey } from "../../../src/docevals/core/since.js";
import { runEvals, type EngineReport } from "../../../src/docevals/core/engine.js";
import { runRun } from "../../../src/docevals/commands/run.js";
import { renderHuman } from "../../../src/docevals/reporters/human.js";
import { renderMarkdown } from "../../../src/docevals/reporters/markdown.js";
import { renderGithub } from "../../../src/docevals/reporters/github.js";
import { DocevalsError } from "../../../src/docevals/types.js";
import type { ExecFn, ExecOptions, ExecResult } from "../../../src/docevals/graders/types.js";

const OK: ExecResult = { code: 0, stdout: "", stderr: "", timedOut: false };

interface GitCall {
  cmd: string[];
  opts: ExecOptions | undefined;
}

/**
 * A fake git. `topLevel` answers `rev-parse --show-toplevel`; `changed` is
 * NUL-joined into the diff's stdout exactly as git writes it — including the
 * trailing separator, which is the empty entry the parser has to drop.
 */
function fakeGit(options: {
  topLevel?: string;
  changed?: string[];
  revParse?: Partial<ExecResult>;
  diff?: Partial<ExecResult>;
}): { exec: ExecFn; calls: GitCall[] } {
  const calls: GitCall[] = [];
  const exec: ExecFn = (cmd, opts) => {
    calls.push({ cmd, opts });
    if (cmd[1] === "rev-parse") {
      return Promise.resolve({
        ...OK,
        stdout: `${options.topLevel ?? "/repo"}\n`,
        ...options.revParse,
      });
    }
    return Promise.resolve({
      ...OK,
      stdout: (options.changed ?? []).map((f) => `${f}\0`).join(""),
      ...options.diff,
    });
  };
  return { exec, calls };
}

describe("changedKey", () => {
  it("resolves to an absolute path", () => {
    expect(changedKey("docs/page.md")).toBe(
      changedKey(resolve("docs/page.md")),
    );
  });

  // git reports the index's case, fast-glob reports the disk's, and the two
  // sources disagree about the drive letter as well. On a case-insensitive
  // filesystem that difference is not a different file.
  it("is case-insensitive on win32 and case-sensitive elsewhere", () => {
    const a = changedKey(resolve("/repo/Docs/Page.md"));
    const b = changedKey(resolve("/repo/docs/page.md"));
    if (process.platform === "win32") expect(a).toBe(b);
    else expect(a).not.toBe(b);
  });
});

describe("changedFilesSince: how git is invoked", () => {
  it("asks for the top level, then a NUL-delimited three-dot diff", async () => {
    const { exec, calls } = fakeGit({ topLevel: resolve("/repo") });
    await changedFilesSince("origin/main", resolve("/repo/docs"), exec);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.cmd).toEqual(["git", "rev-parse", "--show-toplevel"]);
    // `-z` is not optional: without it `core.quotePath` C-escapes non-ASCII
    // paths, and the escaped form silently matches no page.
    expect(calls[1]?.cmd).toEqual([
      "git",
      "--no-pager",
      "diff",
      "--name-only",
      "-z",
      "origin/main...HEAD",
    ]);
  });

  it("runs both invocations in the discovery root with a timeout", async () => {
    const root = resolve("/repo/docs");
    const { exec, calls } = fakeGit({ topLevel: resolve("/repo") });
    await changedFilesSince("HEAD~1", root, exec);

    for (const call of calls) {
      expect(call.opts?.cwd).toBe(root);
      expect(call.opts?.timeoutMs).toBe(30_000);
    }
  });
});

describe("changedFilesSince: parsing", () => {
  it("drops the trailing empty entry a NUL-terminated list ends with", async () => {
    const { exec } = fakeGit({
      topLevel: resolve("/repo"),
      changed: ["docs/a.md", "docs/b.md"],
    });
    const changed = await changedFilesSince("HEAD~1", resolve("/repo"), exec);

    expect(changed.size).toBe(2);
    expect([...changed].some((k) => k === "")).toBe(false);
  });

  it("returns an empty set for an empty diff", async () => {
    const { exec } = fakeGit({ topLevel: resolve("/repo"), changed: [] });
    expect(
      (await changedFilesSince("HEAD", resolve("/repo"), exec)).size,
    ).toBe(0);
  });

  it("keeps a path git had to quote, because -z means git did not quote it", async () => {
    const { exec } = fakeGit({
      topLevel: resolve("/repo"),
      changed: ["docs/café.md"],
    });
    const changed = await changedFilesSince("HEAD~1", resolve("/repo"), exec);
    expect(changed.has(changedKey(resolve("/repo", "docs/café.md")))).toBe(true);
  });

  // The reconciliation that makes a subdirectory config work at all.
  it("anchors on the git top level, not the discovery root", async () => {
    const top = resolve("/repo");
    const discovery = resolve("/repo/site");
    const { exec } = fakeGit({ topLevel: top, changed: ["site/docs/a.md"] });
    const changed = await changedFilesSince("HEAD~1", discovery, exec);

    expect(changed.has(changedKey(resolve(top, "site/docs/a.md")))).toBe(true);
    expect(changed.has(changedKey(resolve(discovery, "site/docs/a.md")))).toBe(
      false,
    );
  });
});

describe("changedFilesSince: failure triage", () => {
  // Three different repairs, so three different messages. Collapsing the
  // spawn failure into "not a git repository" sends the reader to fix the
  // wrong thing.
  it("says git could not be run when it could not be spawned", async () => {
    const { exec } = fakeGit({ revParse: { spawnError: "ENOENT", code: null } });
    await expect(
      changedFilesSince("HEAD~1", resolve("/repo"), exec),
    ).rejects.toThrow(DocevalsError);
    await expect(
      changedFilesSince("HEAD~1", resolve("/repo"), exec),
    ).rejects.toThrow(/could not run git/i);
  });

  it("says so when git timed out", async () => {
    const { exec } = fakeGit({ revParse: { timedOut: true, code: null } });
    await expect(
      changedFilesSince("HEAD~1", resolve("/repo"), exec),
    ).rejects.toThrow(/timed out/i);
  });

  it("reports a non-repository distinctly from a spawn failure", async () => {
    const { exec } = fakeGit({
      revParse: { code: 128, stderr: "fatal: not a git repository" },
    });
    const err = await changedFilesSince(
      "HEAD~1",
      resolve("/repo"),
      exec,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DocevalsError);
    expect((err as Error).message).toMatch(/not a git repository/i);
    expect((err as Error).message).not.toMatch(/could not run git/i);
  });

  it("names the ref and mentions shallow clones when the ref will not resolve", async () => {
    const { exec } = fakeGit({
      topLevel: resolve("/repo"),
      diff: {
        code: 128,
        stderr: "fatal: bad revision 'origin/main...HEAD'",
      },
    });
    const err = await changedFilesSince(
      "origin/main",
      resolve("/repo"),
      exec,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DocevalsError);
    // `actions/checkout` defaults to fetch-depth: 1, where `origin/main` is
    // simply absent. This will be the most common report against the feature.
    expect((err as Error).message).toMatch(/origin\/main/);
    expect((err as Error).message).toMatch(/shallow/i);
    expect((err as Error).message).toMatch(/fetch-depth/);
    expect((err as Error).message).toMatch(/bad revision/);
  });

  it("reports a timed-out diff as a timeout, not a bad ref", async () => {
    const { exec } = fakeGit({
      topLevel: resolve("/repo"),
      diff: { timedOut: true, code: null },
    });
    await expect(
      changedFilesSince("HEAD~1", resolve("/repo"), exec),
    ).rejects.toThrow(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// Engine-level: what `--since` does to a run.
// ---------------------------------------------------------------------------

const CONFIG_EVALS = [
  "  evals:",
  "    always-passes:",
  "      assertion: The page was reviewed within the last century.",
  "      grader: tool:freshness",
  "      options:",
  "        max-age-days: 100000",
  "      severity: error",
  "    always-fails:",
  "      assertion: The page was reviewed in the last day.",
  "      grader: tool:freshness",
  "      options:",
  "        max-age-days: 1",
  "      severity: error",
  "  suites:",
  "    reference:",
  "      target-pass-rate: 1.0",
  "      evals: [always-passes, always-fails]",
  // A page in this suite carries only the passing eval, which is what lets a
  // scoped run compute 1/1 = 100% against a target of 1.0.
  "    light:",
  "      target-pass-rate: 1.0",
  "      evals: [always-passes]",
];

function page(evals: string[], extra: string[] = []): string {
  return [
    "---",
    "title: A page",
    "last-reviewed: 2020-01-01",
    ...extra,
    "evals:",
    ...evals.map((e) => `  - use: ${e}`),
    "---",
    "",
    "# A page",
    "",
    "Body text.",
    "",
  ].join("\n");
}

/**
 * Three discoverable pages plus one the config excludes, so a diff naming an
 * undiscovered file has somewhere to land. `gamma.md` carries only the passing
 * eval — it is the page that isolates suite suspension, because scoping to it
 * alone would otherwise compute 1/1 against a target of 1.0.
 */
function scaffold(configDir = ""): { root: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-since-"));
  const cwd = configDir === "" ? root : join(root, configDir);
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs", "alpha.md"), page(["always-passes", "always-fails"]));
  writeFileSync(join(cwd, "docs", "beta.md"), page(["always-passes", "always-fails"]));
  writeFileSync(
    join(cwd, "docs", "gamma.md"),
    page(["always-passes"], ["eval-suite: light"]),
  );
  writeFileSync(join(cwd, "docs", "draft.md"), page(["always-fails"]));
  writeFileSync(
    join(cwd, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  baseline: .manni-docevals-baseline.json",
      "  files:",
      '    include: ["docs/**/*.md"]',
      '    exclude: ["docs/draft.md"]',
      "  defaults:",
      "    suite: reference",
      ...CONFIG_EVALS,
      "",
    ].join("\n"),
  );
  return { root, cwd };
}

/** Three near-identical pages, so `tool:differentiation` has something to say. */
function corpusScaffold(): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-since-corpus-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  const body = [
    "",
    "# Endpoint",
    "",
    "This endpoint accepts a request and returns a response.",
    "Send the request with the required headers and read the response body.",
    "",
  ].join("\n");
  const pages: [string, string[]][] = [
    ["a.md", ["distinct"]],
    ["b.md", ["distinct", "always-passes"]],
    ["c.md", ["distinct"]],
  ];
  for (const [name, evals] of pages) {
    writeFileSync(
      join(root, "docs", name),
      [
        "---",
        "title: Endpoint",
        "last-reviewed: 2020-01-01",
        "evals:",
        ...evals.map((e) => `  - use: ${e}`),
        "---",
        body,
      ].join("\n"),
    );
  }
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "  defaults:",
      "    suite: reference",
      "  evals:",
      "    distinct:",
      "      assertion: Sibling pages describe different things.",
      "      grader: tool:differentiation",
      "      options:",
      "        max-similarity: 0.5",
      "      severity: error",
      "    always-passes:",
      "      assertion: The page was reviewed within the last century.",
      "      grader: tool:freshness",
      "      options:",
      "        max-age-days: 100000",
      "      severity: error",
      "  suites:",
      "    reference:",
      "      target-pass-rate: 1.0",
      "      evals: [distinct, always-passes]",
      "",
    ].join("\n"),
  );
  return root;
}

/** A run wired to a fake git that reports exactly `changed` (repo-relative). */
function run(
  cwd: string,
  changed: string[],
  options: Record<string, unknown> = {},
  topLevel = cwd,
): { calls: GitCall[]; report: Promise<EngineReport> } {
  const { exec, calls } = fakeGit({ topLevel, changed });
  return {
    calls,
    report: runEvals({ cwd, generate: false, exec, since: "HEAD~1", ...options }),
  };
}

describe("--since: a clean tree", () => {
  // NOT a usage error, unlike an `--eval` that matches nothing. "No page
  // changed" is a correct and expected answer for a CI job on a branch that
  // touched only source; refusing it would make the flag unusable for the job
  // it exists for.
  it("exits 0 having evaluated nothing", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, []).report;

    expect(report.evalResults).toHaveLength(0);
    expect(report.exitCode).toBe(0);
  });

  it("reports the scope rather than leaving it to be inferred", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, [], { since: "HEAD" }).report;

    expect(report.since).toEqual({ ref: "HEAD", pagesSelected: 0, pagesTotal: 3 });
    // The corpus count is the corpus count; the scope block carries the rest.
    expect(report.pages).toBe(3);
  });

  it("never claims a suite target was met", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, []).report;
    expect(report.suites.some((s) => s.meetsTarget)).toBe(false);
  });
});

describe("--since: a changed page", () => {
  it("runs every eval on it", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, ["docs/alpha.md"]).report;

    expect(report.evalResults.map((r) => r.file)).toEqual([
      "docs/alpha.md",
      "docs/alpha.md",
    ]);
    expect(report.since?.pagesSelected).toBe(1);
  });

  it("still exits 1 when one of its evals fails", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, ["docs/alpha.md"]).report;
    expect(report.exitCode).toBe(1);
  });

  it("ignores a changed file the config excludes", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, ["docs/draft.md", "README.md"]).report;

    expect(report.evalResults).toHaveLength(0);
    expect(report.since?.pagesSelected).toBe(0);
    expect(report.exitCode).toBe(0);
  });
});

describe("--since: the config lives in a subdirectory", () => {
  // The test that fails the instant anyone compares git's output against
  // `page.file`. git says `site/docs/alpha.md`; the page calls itself
  // `docs/alpha.md`. Neither is wrong, and neither matches the other.
  it("reconciles git's repo-relative paths against the discovery root", async () => {
    const { root, cwd } = scaffold("site");
    const report = await run(cwd, ["site/docs/alpha.md"], {}, root).report;

    expect(report.evalResults.map((r) => r.file)).toEqual([
      "docs/alpha.md",
      "docs/alpha.md",
    ]);
    expect(report.since?.pagesSelected).toBe(1);
  });
});

describe("--since: suite enforcement", () => {
  // The ADR 01018 hazard, reached by a different route: `gamma.md` carries
  // only the passing eval, so a scoped run computes 1/1 = 100% against a
  // target of 1.0 and would report the gate as met on one page out of three.
  it("is suspended, exactly as a --eval filter suspends it", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, ["docs/gamma.md"]).report;

    expect(report.evalResults).toHaveLength(1);
    expect(report.evalResults[0]?.outcome).toBe("pass");
    expect(report.suites[0]?.partial).toBe(true);
    expect(report.suites[0]?.meetsTarget).toBe(false);
    expect(report.exitCode).toBe(0);
  });

  it("leaves an unscoped run enforced", async () => {
    const { cwd } = scaffold();
    const report = await runEvals({ cwd, generate: false });

    expect(report.since).toBeUndefined();
    expect(report.suites[0]?.partial).toBeUndefined();
    expect(report.exitCode).toBe(1);
  });
});

describe("--since: corpus graders are exempt", () => {
  // `GraderContext` carries targets, not pages, so narrowing the targets
  // narrows the comparison population. `gradeGroup` bails below two targets
  // and returns no findings — and no findings is a *pass*. Scoping would
  // therefore turn this check green by default, in CI, silently.
  it("compares a changed page against unchanged siblings", async () => {
    const root = corpusScaffold();
    const report = await run(root, ["docs/a.md"]).report;

    const a = report.evalResults.find(
      (r) => r.file === "docs/a.md" && r.evalName === "distinct",
    );
    expect(a?.outcome).toBe("fail");
    expect(a?.findings?.[0]?.message).toMatch(/similar to docs\/(b|c)\.md/);
    expect(report.exitCode).toBe(1);
  });

  it("keeps a corpus eval on an unchanged page, but drops its other evals", async () => {
    const root = corpusScaffold();
    const report = await run(root, ["docs/a.md"]).report;

    // b.md did not change: its corpus eval survives, its freshness eval does not.
    const onB = report.evalResults.filter((r) => r.file === "docs/b.md");
    expect(onB.map((r) => r.evalName)).toEqual(["distinct"]);
  });

  it("produces the same verdicts as the unscoped run", async () => {
    const root = corpusScaffold();
    const scoped = await run(root, ["docs/a.md"]).report;
    const whole = await runEvals({ cwd: root, generate: false });

    const distinct = (r: EngineReport) =>
      r.evalResults
        .filter((x) => x.evalName === "distinct")
        .map((x) => `${x.file} ${x.outcome}`)
        .sort();
    expect(distinct(scoped)).toEqual(distinct(whole));
    expect(distinct(scoped)).toHaveLength(3);
  });
});

describe("--since: composition with the other flags", () => {
  // Selection is applied first, over the whole corpus, so its empty-match
  // usage error is unaffected by what happens to have changed.
  it("still rejects an --eval name that matches nothing", async () => {
    const { cwd } = scaffold();
    await expect(
      run(cwd, [], { evalNames: ["no-such-eval"] }).report,
    ).rejects.toThrow(DocevalsError);
  });

  it("intersects with --eval", async () => {
    const { cwd } = scaffold();
    const report = await run(cwd, ["docs/alpha.md"], {
      evalNames: ["always-passes"],
    }).report;

    expect(report.evalResults.map((r) => `${r.file} ${r.evalName}`)).toEqual([
      "docs/alpha.md always-passes",
    ]);
    expect(report.exitCode).toBe(0);
  });

  // A re-record rebuilds the file from this run's findings, so recording from
  // a scoped run would forgive every finding the scope excluded — the same
  // reason --eval and --suite are refused. Refused before git is spawned.
  it("refuses --write-baseline, without running git", async () => {
    const { cwd } = scaffold();
    const { report, calls } = run(cwd, ["docs/alpha.md"], { writeBaseline: true });

    await expect(report).rejects.toThrow(DocevalsError);
    await expect(report).rejects.toThrow(/--since/);
    expect(calls).toHaveLength(0);
  });

  // `stale` counts recorded findings on files this run actually graded. A
  // scoped run grades fewer files, and reporting the rest as "no longer occur"
  // is the sentence that invites the re-record which deletes them.
  it("reading a baseline does not mark unscoped files stale", async () => {
    const { cwd } = scaffold();
    await runEvals({ cwd, generate: false, writeBaseline: true, toolVersion: "test" });

    const report = await run(cwd, ["docs/alpha.md"], { baseline: true }).report;

    expect(report.baseline?.suppressed).toBe(1);
    expect(report.baseline?.stale).toBe(0);
    expect(report.exitCode).toBe(0);
  });
});

describe("--since: what stays unfiltered", () => {
  // Resolution runs over the whole corpus, so a bad `eval-*` key on a page
  // nobody touched is still an error. Scoping narrows what is *graded*, never
  // what is *diagnosed*.
  it("reports a resolution problem on an unchanged page", async () => {
    const { cwd } = scaffold();
    writeFileSync(
      join(cwd, "docs", "beta.md"),
      page(["always-passes"], ["eval-typo: true"]),
    );
    const report = await run(cwd, ["docs/alpha.md"]).report;

    const problem = report.problems.find((p) => p.file === "docs/beta.md");
    expect(problem?.level).toBe("error");
    expect(problem?.message).toMatch(/eval-/);
    expect(report.exitCode).toBe(1);
  });
});

describe("--since: an unresolvable ref reaches the caller", () => {
  it("fails the run rather than scoping it to nothing", async () => {
    const { cwd } = scaffold();
    const { exec } = fakeGit({
      topLevel: cwd,
      diff: { code: 128, stderr: "fatal: bad revision" },
    });
    await expect(
      runEvals({ cwd, generate: false, exec, since: "origin/main" }),
    ).rejects.toThrow(/shallow/i);
  });
});

describe("--since: the human report says what was scoped", () => {
  it("names the scope on a run that evaluated something", async () => {
    const { cwd } = scaffold();
    const out = renderHuman(
      await run(cwd, ["docs/alpha.md"], { since: "main" }).report,
    );
    expect(out).toContain("1 of 3");
    expect(out).toContain("main");
  });

  // Without this line a clean-tree run is an indistinguishable green: same
  // exit code, same empty body, no statement that nothing ran.
  it("says outright when nothing was evaluated", async () => {
    const { cwd } = scaffold();
    const out = renderHuman(await run(cwd, [], { since: "main" }).report);
    expect(out).toContain("No pages changed since main — nothing was evaluated.");
  });
});

describe("--since: the CI reporters say what was scoped", () => {
  // The formats CI actually reads. `renderGithub` delegates its summary to
  // `renderMarkdown`, so the markdown line reaches both — but the annotation
  // is what surfaces in the Actions log without opening the step summary.
  const base: EngineReport = {
    pages: 3,
    evalResults: [],
    suites: [],
    usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 0 },
    generated: [],
    exitCode: 0,
    problems: [],
  };

  it("markdown names the scope", () => {
    const md = renderMarkdown({
      ...base,
      since: { ref: "origin/main", pagesSelected: 2, pagesTotal: 40 },
    });
    expect(md).toContain("2 of 40");
    expect(md).toContain("origin/main");
  });

  it("markdown says outright when nothing was evaluated", () => {
    const md = renderMarkdown({
      ...base,
      since: { ref: "origin/main", pagesSelected: 0, pagesTotal: 40 },
    });
    expect(md).toContain("No pages changed since `origin/main`");
    expect(md).toContain("nothing was evaluated");
  });

  it("github annotates the scope so it survives a collapsed log", () => {
    const gh = renderGithub({
      ...base,
      since: { ref: "origin/main", pagesSelected: 0, pagesTotal: 40 },
    });
    expect(gh).toContain("::notice title=manni docevals::");
    expect(gh).toContain("No pages changed since origin/main");
  });

  it("says nothing at all when --since was not used", () => {
    expect(renderMarkdown(base)).not.toContain("changed since");
    expect(renderGithub(base)).not.toContain("::notice");
    expect(renderHuman(base)).not.toContain("changed since");
  });
});

describe("--since: the run command threads the flag to the engine", () => {
  // `runRun` is the seam between `src/cli.ts` and the engine; the flag itself
  // is exercised end-to-end by the dogfood step in ci.yml.
  it("passes the ref through and reports the scope", async () => {
    const { cwd } = scaffold();
    const { exec, calls } = fakeGit({ topLevel: cwd, changed: ["docs/gamma.md"] });
    const report = await runRun(
      [],
      { cwd, deterministicOnly: true, generate: false, since: "origin/main" },
      { exec, judge: undefined, generateScripts: undefined },
    );

    expect(calls[1]?.cmd).toContain("origin/main...HEAD");
    expect(report.since).toEqual({
      ref: "origin/main",
      pagesSelected: 1,
      pagesTotal: 3,
    });
  });

  it("leaves an unscoped run untouched", async () => {
    const { cwd } = scaffold();
    const report = await runRun(
      [],
      { cwd, deterministicOnly: true, generate: false },
      { judge: undefined, generateScripts: undefined },
    );
    expect(report.since).toBeUndefined();
  });
});
