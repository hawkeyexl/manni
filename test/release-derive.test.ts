/**
 * Guard for the release plugin `scripts/release-derive.mjs`.
 *
 * The bug it exists for: the version sync rewrites the install pins in the
 * docs on every release, and that is a body change to each page it touches.
 * The pages' derived stamps (`last-updated`, `provenance`) then disagree with
 * git, and `meta validate` failed on main after 3.0.0 and again after 4.0.0,
 * with every open branch inheriting the red until someone re-derived.
 *
 * The plugin re-stamps inside the release, after the sync and before the
 * release commit, so the commit carries stamps that agree with it.
 *
 * `verdict` and `summarize` are tested rather than the spawn, as for the
 * citation step beside it: the exit code is the whole of the policy, and the
 * log line is the only trace the step leaves.
 */
import { describe, it, expect } from "vitest";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = join(repoRoot, "scripts", "release-derive.mjs");

interface Verdict {
  fail: boolean;
  message?: string;
}

const plugin = (await import(pathToFileURL(pluginPath).href)) as {
  prepare: unknown;
  verdict: (status: number | null, timedOut?: boolean) => Verdict;
  summarize: (stdout: string) => string;
  DERIVE_ARGS: string[];
  TIMEOUT_MS: number;
};

describe("what the release runs", () => {
  it("derives over the configured pages, writing, with no paths of its own", () => {
    // No paths, so the run covers what `derive.collections` names. No
    // `--dry-run` or `--check`: the point is to write the stamps.
    expect(plugin.DERIVE_ARGS).toEqual(["meta", "derive"]);
  });

  it("exports prepare as a semantic-release lifecycle step", () => {
    expect(typeof plugin.prepare).toBe("function");
  });

  it("gives up on a hung run inside the release job's spare minutes", () => {
    expect(plugin.TIMEOUT_MS).toBe(120_000);
  });
});

describe("the verdict on an exit code", () => {
  it("continues on 0", () => {
    expect(plugin.verdict(0)).toEqual({ fail: false });
  });

  it("continues on 1, saying some pages were not stamped", () => {
    const v = plugin.verdict(1);
    expect(v.fail).toBe(false);
    expect(v.message).toMatch(/not stamped/);
    expect(v.message).toMatch(/manni meta validate/);
  });

  it("fails on 2, because nothing was stamped", () => {
    const v = plugin.verdict(2);
    expect(v.fail).toBe(true);
    expect(v.message).toBe("manni meta derive exited 2, so no page was re-stamped.");
  });

  it("fails when the run was stopped or never exited", () => {
    expect(plugin.verdict(null).fail).toBe(true);
    expect(plugin.verdict(null).message).toBe(
      "manni meta derive did not exit on its own, so no page was re-stamped.",
    );
    const timedOut = plugin.verdict(null, true);
    expect(timedOut.fail).toBe(true);
    expect(timedOut.message).toMatch(/did not finish within 120s/);
  });
});

describe("the log line", () => {
  it("says so in words when nothing changed", () => {
    expect(plugin.summarize("Using manni.config.yaml (.)\n\n134 files, 0 changed, 0 fields written\n")).toBe(
      "No page's stamps moved; the docs' derived fields are current",
    );
  });

  it("still reads a quiet run that also reports zero ranges as quiet", () => {
    expect(plugin.summarize("134 files, 0 changed, 0 fields written, 0 ranges written\n")).toBe(
      "No page's stamps moved; the docs' derived fields are current",
    );
  });

  it("passes a run that wrote something through verbatim", () => {
    expect(plugin.summarize("...\n\n134 files, 10 changed, 10 fields written, 2 ranges written\n")).toBe(
      "134 files, 10 changed, 10 fields written, 2 ranges written",
    );
  });

  it("names an empty report", () => {
    expect(plugin.summarize("")).toBe("manni meta derive printed no summary");
  });
});
