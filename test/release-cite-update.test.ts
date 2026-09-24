/**
 * Guard for the release plugin `scripts/release-cite-update.mjs`.
 *
 * The bug it exists for: two pages cite `CHANGELOG.md`, and semantic-release
 * prepends to that file on every release. So every release moved both pins,
 * and every branch open at the time went red on `docs-as-tests` at its next
 * push, each needing an identical four-line diff. Six of roughly fifteen CI
 * failures on one day were a branch being behind rather than wrong.
 *
 * The plugin re-anchors those pins inside the release, between the changelog
 * write and the release commit, so the commit carries them and no branch ever
 * sees the drift.
 *
 * `verdict` and `summarize` are tested rather than the spawn. The exit code is
 * the whole of the policy — writing nothing is the common case and must not be
 * an error, an unresolved finding must not abort a publish, and a run that
 * could not happen at all must — and the log line is the only trace the step
 * leaves in a release someone reads afterwards.
 */
import { describe, it, expect } from "vitest";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = join(repoRoot, "scripts", "release-cite-update.mjs");

interface Verdict {
  fail: boolean;
  message?: string;
}

const plugin = (await import(pathToFileURL(pluginPath).href)) as {
  prepare: unknown;
  verdict: (status: number | null, timedOut?: boolean) => Verdict;
  summarize: (stdout: string) => string;
  TIMEOUT_MS: number;
};

describe("the release cite-update plugin", () => {
  it("exports only `prepare` among semantic-release's lifecycle steps", () => {
    // semantic-release imports a path plugin and calls whichever lifecycle
    // names it exports. This one belongs in `prepare` and nowhere else.
    const lifecycles = [
      "verifyConditions",
      "analyzeCommits",
      "verifyRelease",
      "generateNotes",
      "prepare",
      "publish",
      "addChannel",
      "success",
      "fail",
    ];
    const exported = lifecycles.filter((name) => name in plugin);
    expect(exported).toEqual(["prepare"]);
  });

  it("treats a clean run as success", () => {
    expect(plugin.verdict(0)).toEqual({ fail: false });
  });

  it("does not abort the release over a finding it cannot fix", () => {
    // Exit 1 is `cite update`'s "work left undone": the moved pins were still
    // rewritten, and a changed claim is a docs bug the pull request gate
    // already reports. Failing here would block a publish over something main
    // was merged with.
    const v = plugin.verdict(1);
    expect(v.fail).toBe(false);
    expect(v.message).toBeTypeOf("string");
    expect(v.message).toMatch(/cite check/);
  });

  it("fails the release when the update could not run", () => {
    // Exit 2 is operational: no config, no git history, no build. Nothing was
    // re-anchored, so the release commit would carry stale pins. This runs in
    // `prepare`, before `publish`, so failing publishes nothing.
    const v = plugin.verdict(2);
    expect(v.fail).toBe(true);
    expect(v.message).toBeTypeOf("string");
  });

  it("fails on a status it does not recognise", () => {
    // A signal leaves `status` null; anything else is a crash.
    expect(plugin.verdict(null).fail).toBe(true);
    expect(plugin.verdict(137).fail).toBe(true);
  });

  it("bounds how long the update may run", () => {
    // A release step that hangs is worse than one that fails: by this point
    // the changelog is written and the version bumped, and a hang is neither
    // visible nor repeatable. `cite update` talks to git, so a stale index
    // lock is how it stops making progress.
    //
    // The measured cost over this corpus of 4,143 citations is 2.5s quiet and
    // 5.0s rewriting two pins. The bound is an order of magnitude above that,
    // and small enough to leave the release job's budget as it was.
    expect(plugin.TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(plugin.TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });

  it("says plainly that a timed-out update committed nothing", () => {
    const v = plugin.verdict(null, true);
    expect(v.fail).toBe(true);
    expect(v.message).toMatch(/did not finish/);
    expect(v.message).toMatch(/nothing was committed/i);
  });
});

describe("what the release log says", () => {
  // The step runs on every release and moves nothing on most of them, so the
  // quiet path is the common one. Reporting what happened, rather than what
  // the step is for, is what makes the log worth scanning afterwards.
  const NOTICE = "Using manni.config.yaml (.)";
  const SUMMARY = "2 citations rewritten in 2 files, 0 skipped";

  it("says nothing moved when nothing moved", () => {
    const quiet = "0 citations rewritten in 0 files, 0 skipped";
    const line = plugin.summarize([NOTICE, quiet].join("\n"));
    expect(line).toMatch(/no citation moved/i);
    expect(line).not.toMatch(/re-anchored/i);
  });

  it("repeats the command's own summary when citations moved", () => {
    const moved =
      "docs/a.mdx: some-id source CHANGELOG.md:650-653 -> CHANGELOG.md:657-660 (moved)";
    // The detail is already in the subprocess output, so the step counts
    // nothing of its own.
    expect(plugin.summarize([NOTICE, moved, SUMMARY].join("\n"))).toBe(SUMMARY);
  });

  it("reports a run that skipped something even with nothing rewritten", () => {
    const skipped = "0 citations rewritten in 0 files, 3 skipped";
    expect(plugin.summarize([NOTICE, skipped].join("\n"))).toBe(skipped);
  });

  it("does not invent a summary when there is no output", () => {
    expect(plugin.summarize("")).toBeTypeOf("string");
    expect(plugin.summarize("")).not.toBe("");
  });
});
