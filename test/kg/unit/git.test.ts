import { describe, expect, it } from "vitest";
import { collectGitHistory } from "../../../src/kg/core/git.js";
import { DockgError } from "../../../src/kg/types.js";
import type { ExecFn, ExecResult } from "@hawkeyexl/inference";

function mockExec(stdout: string, code = 0): ExecFn {
  return () =>
    Promise.resolve<ExecResult>({ code, stdout, stderr: "", timedOut: false });
}

const SOH = "\u0001";

/** Newest-first log: commit c3 modifies b.md; c2 renames a.md -> b.md; c1 adds a.md + docs/keep.md. */
const LOG = [
  `${SOH}c3\tCasey Editor\t2026-03-03T10:00:00+00:00`,
  "",
  "M\tb.md",
  "",
  `${SOH}c2\tJane Doe\t2026-02-02T10:00:00+00:00`,
  "",
  "R095\ta.md\tb.md",
  "",
  `${SOH}c1\tJane Doe\t2026-01-01T10:00:00+00:00`,
  "",
  "A\ta.md",
  "A\tdocs/keep.md",
  "",
].join("\n");

describe("collectGitHistory", () => {
  it("parses one pass into per-file created/modified/authors", async () => {
    const history = await collectGitHistory("/repo", mockExec(LOG));
    expect(history.headTime).toBe("2026-03-03T10:00:00+00:00");

    const keep = history.files.get("docs/keep.md")!;
    expect(keep.created).toBe("2026-01-01T10:00:00+00:00");
    expect(keep.modified).toBe("2026-01-01T10:00:00+00:00");
    expect(keep.authors).toEqual(["Jane Doe"]);
  });

  it("follows renames backward so history accrues to the current path", async () => {
    const history = await collectGitHistory("/repo", mockExec(LOG));
    const b = history.files.get("b.md")!;
    expect(b.created).toBe("2026-01-01T10:00:00+00:00"); // a.md's birth
    expect(b.modified).toBe("2026-03-03T10:00:00+00:00");
    expect(b.authors).toEqual(["Casey Editor", "Jane Doe"]); // newest first, deduped
    expect(b.renamedFrom).toEqual(["a.md"]);
    expect(history.files.has("a.md")).toBe(false); // folded into b.md
  });

  it("tracks multi-hop rename chains", async () => {
    const log = [
      `${SOH}c3\tA\t2026-03-01T00:00:00+00:00`,
      "",
      "R100\tmid.md\tnew.md",
      "",
      `${SOH}c2\tA\t2026-02-01T00:00:00+00:00`,
      "",
      "R100\told.md\tmid.md",
      "",
      `${SOH}c1\tA\t2026-01-01T00:00:00+00:00`,
      "",
      "A\told.md",
      "",
    ].join("\n");
    const history = await collectGitHistory("/repo", mockExec(log));
    const file = history.files.get("new.md")!;
    expect(file.renamedFrom).toEqual(["mid.md", "old.md"]);
    expect(file.created).toBe("2026-01-01T00:00:00+00:00");
  });

  it("throws DockgError outside a git repo, surfacing git's stderr", async () => {
    const exec: ExecFn = () =>
      Promise.resolve<ExecResult>({
        code: 128,
        stdout: "",
        stderr: "fatal: not a git repository",
        timedOut: false,
      });
    // The type is the contract, not just the text: cli.ts fail() maps
    // DockgError to exit 2 and rethrows anything else, so a plain Error here
    // would change the CLI's exit code.
    await expect(collectGitHistory("/repo", exec)).rejects.toThrow(DockgError);
    await expect(collectGitHistory("/repo", exec)).rejects.toThrow(
      /not a git repository/,
    );
  });

  it("distinguishes timeouts and spawn failures from not-a-repo", async () => {
    const timedOut: ExecFn = () =>
      Promise.resolve<ExecResult>({
        code: null,
        stdout: "partial",
        stderr: "",
        timedOut: true,
      });
    await expect(collectGitHistory("/repo", timedOut)).rejects.toThrow(
      /timed out/,
    );

    const spawnFail: ExecFn = () =>
      Promise.resolve<ExecResult>({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        spawnError: "spawn git ENOENT",
      });
    await expect(collectGitHistory("/repo", spawnFail)).rejects.toThrow(
      /git could not be run/,
    );
  });

  it("unquotes C-quoted paths (quotes and octal escapes survive quotepath=off)", async () => {
    const log = [
      `${SOH}c1\tA\t2026-01-01T00:00:00+00:00`,
      "",
      'A\t"docs/a\\"b.md"',
      'A\t"docs/caf\\303\\251.md"',
      "",
    ].join("\n");
    const history = await collectGitHistory("/repo", mockExec(log));
    expect(history.files.has('docs/a"b.md')).toBe(true);
    expect(history.files.has("docs/café.md")).toBe(true);
  });

  it("handles tab-free author names with unicode paths (quotepath off)", async () => {
    const log = [
      `${SOH}c1\tRené Müller\t2026-01-01T00:00:00+00:00`,
      "",
      "A\tdocs/café guide.md",
      "",
    ].join("\n");
    const history = await collectGitHistory("/repo", mockExec(log));
    expect(history.files.get("docs/café guide.md")!.authors).toEqual([
      "René Müller",
    ]);
  });

  it("unsets inherited GIT_* variables so ambient git state cannot redirect the read", async () => {
    // git exports these to every hook subprocess. Inheriting them makes git log
    // read that repo instead of cwd — same inputs, different graph.
    process.env.GIT_DIR = "/somewhere/else/.git";
    process.env.GIT_INDEX_FILE = "/somewhere/else/.git/index";
    try {
      let seen: Record<string, string | undefined> | undefined;
      const exec: ExecFn = (_cmd, opts) => {
        seen = opts?.env;
        // Non-empty: an empty log is treated as "not a repo" and throws.
        return Promise.resolve<ExecResult>({
          code: 0,
          stdout: [
            `${SOH}c1\tA\t2026-01-01T00:00:00+00:00`,
            "",
            "A\ta.md",
            "",
          ].join("\n"),
          stderr: "",
          timedOut: false,
        });
      };
      await collectGitHistory("/repo", exec);

      // Present as keys with an undefined value — that is how the exec seam
      // signals "remove", as opposed to merely not overriding them.
      expect(seen).toBeDefined();
      expect(Object.keys(seen!)).toContain("GIT_DIR");
      expect(Object.keys(seen!)).toContain("GIT_INDEX_FILE");
      expect(seen!.GIT_DIR).toBeUndefined();
      expect(seen!.GIT_INDEX_FILE).toBeUndefined();
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_INDEX_FILE;
    }
  });
});
