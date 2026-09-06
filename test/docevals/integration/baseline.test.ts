/**
 * The baseline ratchet, end to end through the engine (ADR 01017).
 *
 * `test/unit/baseline.test.ts` pins the fingerprint and the file format. This
 * pins the thing a user actually experiences: record today's findings, and a
 * run that was red goes green — until something new appears.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { DEFAULT_BASELINE_PATH } from "../../../src/docevals/core/baseline.js";

/**
 * A page that is stale by a century, checked by a freshness eval at error
 * severity — a real finding, from a real grader, with no provider and no
 * subprocess.
 */
function scaffold(extraConfig: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-ratchet-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "legacy.md"),
    [
      "---",
      "title: Legacy",
      "last-reviewed: 1999-01-01",
      "evals:",
      "  - use: fresh-enough",
      "---",
      "",
      "# Legacy",
      "",
      "Old content.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      ...extraConfig,
      "  evals:",
      "    fresh-enough:",
      "      assertion: The page was reviewed in the last year.",
      "      grader: tool:freshness",
      "      options:",
      "        field: last-reviewed",
      "        max-age-days: 365",
      "      severity: error",
      "",
    ].join("\n"),
  );
  return root;
}

const run = (root: string, options: Record<string, unknown> = {}) =>
  runEvals({ cwd: root, generate: false, ...options });

describe("the baseline ratchet", () => {
  it("fails without a baseline, and passes once the finding is recorded", async () => {
    const root = scaffold();

    const before = await run(root);
    expect(before.exitCode).toBe(1);
    expect(before.evalResults[0]?.outcome).toBe("fail");

    const recording = await run(root, { writeBaseline: true, toolVersion: "9.9.9" });
    expect(existsSync(join(root, DEFAULT_BASELINE_PATH))).toBe(true);
    expect(recording.baseline?.written?.total).toBe(1);

    // The standard did not change; the backlog is recorded.
    const after = await run(root, { baseline: true });
    expect(after.exitCode).toBe(0);
    expect(after.evalResults[0]?.outcome).toBe("pass");
    expect(after.evalResults[0]?.baselined).toBe(1);
    expect(after.baseline?.suppressed).toBe(1);
  });

  it("still fails on a finding the baseline does not hold", async () => {
    const root = scaffold();
    await run(root, { writeBaseline: true });

    // A second page, stale in exactly the same way — but the baseline is keyed
    // by file, so this one is new.
    writeFileSync(
      join(root, "docs", "fresh-page.md"),
      [
        "---",
        "title: New",
        "last-reviewed: 1999-01-01",
        "evals:",
        "  - use: fresh-enough",
        "---",
        "",
        "New page, old date.",
        "",
      ].join("\n"),
    );

    const after = await run(root, { baseline: true });
    expect(after.exitCode).toBe(1);
    const fresh = after.evalResults.find((r) => r.file.endsWith("fresh-page.md"));
    expect(fresh?.outcome).toBe("fail");
  });

  it("--no-baseline ignores a recorded one", async () => {
    const root = scaffold();
    await run(root, { writeBaseline: true });
    const ignored = await run(root, { baseline: false });
    expect(ignored.exitCode).toBe(1);
    expect(ignored.baseline).toBeUndefined();
  });

  // The trap docmeta names: a repo that points `baseline:` somewhere custom and
  // then runs a bare `--write-baseline` must not record into the default path,
  // where nothing would ever read it and the ratchet would silently do nothing.
  it("a bare --write-baseline records into the configured path", async () => {
    const root = scaffold(["  baseline: state/backlog.json"]);
    const recording = await run(root, { writeBaseline: true });

    expect(existsSync(join(root, "state", "backlog.json"))).toBe(true);
    expect(existsSync(join(root, DEFAULT_BASELINE_PATH))).toBe(false);
    expect(recording.baseline?.path).toBe("state/backlog.json");

    // And the configured path is what a plain run reads back.
    const after = await run(root);
    expect(after.exitCode).toBe(0);
  });

  it("applies a configured baseline with no flag at all", async () => {
    const root = scaffold(["  baseline: .manni-docevals-baseline.json"]);
    await run(root, { writeBaseline: true });
    const after = await run(root);
    expect(after.exitCode).toBe(0);
    expect(after.baseline?.suppressed).toBe(1);
  });

  // The number that makes an over-forgiving re-record visible. Nothing else in
  // a CI log distinguishes "recorded the backlog" from "recorded nothing,
  // because the glob was wrong, and forgave everything".
  it("reports what a re-record dropped", async () => {
    const root = scaffold();
    await run(root, { writeBaseline: true });

    const narrowed = await run(root, {
      writeBaseline: true,
      globs: ["docs/does-not-match-*.md"],
    }).catch((e: unknown) => e);

    // An empty input set is an operational error before it can silently
    // re-record an empty baseline — which is the stronger guarantee.
    expect(narrowed).toBeInstanceOf(Error);
    expect(readFileSync(join(root, DEFAULT_BASELINE_PATH), "utf8")).toContain(
      "legacy.md",
    );
  });

  it("rejects a corrupt baseline rather than ignoring it", async () => {
    const root = scaffold();
    writeFileSync(join(root, DEFAULT_BASELINE_PATH), "{not json");
    await expect(run(root, { baseline: true })).rejects.toThrow(/invalid JSON/);
  });
});

describe("--write-baseline is a recording action, not a gate", () => {
  // Recording today's findings *is* declaring them accepted, so the recording
  // run has nothing new left to fail on. Exiting 1 here would make the command
  // one you always wrap in `|| true`, and that habit is how the exit code that
  // matters on the *next* run gets discarded too.
  it("exits 0 on the run that records the backlog", async () => {
    const root = scaffold();
    const recording = await run(root, { writeBaseline: true });
    expect(recording.baseline?.written?.total).toBe(1);
    expect(recording.exitCode).toBe(0);
    // scaffold() sets no `baseline:`, so this run wrote a file an ordinary run
    // will not read — the trap the warning exists for.
    expect(
      recording.problems.some((p) => p.message.includes("will not read this file")),
    ).toBe(true);
  });

  it("does not forgive anything it did not record", async () => {
    const root = scaffold();
    await run(root, { writeBaseline: true });
    writeFileSync(
      join(root, "docs", "second.md"),
      ["---", "title: Second", "last-reviewed: 1999-01-01", "evals:", "  - use: fresh-enough", "---", "", "New.", ""].join("\n"),
    );
    // The next ordinary run sees the new page's finding as new.
    expect((await run(root)).exitCode).toBe(1);
  });
});

describe("baseline: paths, filters, and recovery", () => {
  // A re-record rebuilds the file from this run's findings, so recording from
  // a filtered run silently dropped every fingerprint the filter excluded.
  it("refuses to record from a filtered run", async () => {
    const root = scaffold();
    await expect(
      run(root, { writeBaseline: true, evalNames: ["fresh-enough"] }),
    ).rejects.toThrow(/cannot be combined with --eval, --suite or --since/);
    // `--suite` is symmetric; the scaffold defines no suites, so a suite name
    // would be rejected by the earlier undefined-suite guard instead.
    // `--since` narrows the corpus the same way, and is refused for the same
    // reason (ADR 01040) — `test/unit/since.test.ts` also pins that it is
    // refused before git is spawned.
    await expect(run(root, { writeBaseline: true, since: "HEAD" })).rejects.toThrow(
      /cannot be combined with --eval, --suite or --since/,
    );
  });

  // Sharing one resolved path made this read old.json and then overwrite it,
  // never creating new.json.
  it("reads and writes the two paths it was given", async () => {
    const root = scaffold();
    await run(root, { writeBaseline: "old.json" });
    const before = readFileSync(join(root, "old.json"), "utf8");

    await run(root, { baseline: "old.json", writeBaseline: "new.json" });
    expect(existsSync(join(root, "new.json"))).toBe(true);
    expect(readFileSync(join(root, "old.json"), "utf8")).toBe(before);
  });

  // The parse error's own message recommends `--write-baseline`; that command
  // took the same read path and threw the identical error.
  it("lets --write-baseline recover a corrupt baseline", async () => {
    const root = scaffold(["  baseline: .manni-docevals-baseline.json"]);
    writeFileSync(join(root, DEFAULT_BASELINE_PATH), '{"version":99,"entries":{}}');

    await expect(run(root, { baseline: true })).rejects.toThrow(/unsupported version/);
    const repaired = await run(root, { writeBaseline: true });
    expect(repaired.baseline?.written?.total).toBe(1);
    expect(repaired.problems.some((p) => p.message.includes("re-recording over it"))).toBe(true);
    expect((await run(root)).exitCode).toBe(0);
  });

  // Writing somewhere the config does not name is the same
  // silent-nothing-happens failure as writing to the wrong path.
  it("warns when the written path is not the one an ordinary run reads", async () => {
    const root = scaffold(["  baseline: .manni-docevals-baseline.json"]);
    const off = await run(root, { writeBaseline: "elsewhere.json" });
    expect(off.problems.some((p) => p.message.includes("will not read this file"))).toBe(true);
  });
});

describe("baseline: the removed count must be measured against what is overwritten", () => {
  // `removed` is the only signal that an over-narrow re-record forgave
  // findings. Reading `previous` from the apply path meant --no-baseline made
  // it structurally zero, and a differing --baseline made it wrong.
  it("reports removed under --no-baseline --write-baseline", async () => {
    const root = scaffold(["  baseline: .manni-docevals-baseline.json"]);
    await run(root, { writeBaseline: true });

    // Fix the finding, then re-record while ignoring the old baseline.
    writeFileSync(
      join(root, "docs", "legacy.md"),
      readFileSync(join(root, "docs", "legacy.md"), "utf8").replace(
        "last-reviewed: 1999-01-01",
        "last-reviewed: 2026-08-01",
      ),
    );
    const re = await run(root, { baseline: false, writeBaseline: true });
    expect(re.baseline?.written?.removed).toBe(1);
  });

  it("diffs against the file it overwrites, not the one it read", async () => {
    const root = scaffold(["  baseline: team.json"]);
    await run(root, { writeBaseline: true });            // team.json: 1 entry
    writeFileSync(join(root, "old.json"), '{"version":1,"generatedWith":"t","entries":{}}');

    // Reads old.json (empty), overwrites team.json (1 entry) with 1 entry.
    const re = await run(root, { baseline: "old.json", writeBaseline: true });
    expect(re.baseline?.written?.removed).toBe(0);
    expect(re.baseline?.written?.added).toBe(0);
  });

  // `--write-baseline snapshot.json` in a repo with no `baseline:` key must not
  // quietly subtract a default file the user never named.
  it("does not read an unnamed default when only a write path is given", async () => {
    const root = scaffold();
    writeFileSync(
      join(root, DEFAULT_BASELINE_PATH),
      '{"version":1,"generatedWith":"t","entries":{"docs/legacy.md":["ffffffffffffffff"]}}',
    );
    const re = await run(root, { writeBaseline: "snapshot.json" });
    expect(existsSync(join(root, "snapshot.json"))).toBe(true);
    expect(re.baseline?.suppressed).toBe(0);
  });
});
