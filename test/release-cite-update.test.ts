/**
 * Guard for the release plugin `scripts/release-cite-update.mjs`.
 *
 * The bug it exists for: two pages cite `CHANGELOG.md`, and semantic-release
 * prepends to that file on every release. So every release moved both pins,
 * and every branch open at the time went red on the next push with an
 * identical four-line diff to make. Six of roughly fifteen CI failures on one
 * day were a branch being behind rather than wrong.
 *
 * The plugin re-anchors those pins inside the release, between the changelog
 * write and the release commit, so the commit carries them and no branch ever
 * sees the drift.
 *
 * `verdict` is tested rather than the spawn, because the exit code is the whole
 * of the policy: `cite update` writing nothing is the common case and must not
 * be an error, an unresolved finding must not abort a publish, and a run that
 * could not happen at all must.
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
  verdict: (status: number | null) => Verdict;
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
});
