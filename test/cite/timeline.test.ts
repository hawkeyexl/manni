/**
 * Proposal 0092: `manni cite history` reads every first-parent commit as it
 * stood and reports each stale window.
 *
 * Every case is a real repository built at test time, because only git can
 * say which commit contains which. The dates are pinned, so durations are
 * exact and two runs agree.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { runHistory } from "../../src/cite/commands/history.js";
import { encryptSourcePath } from "../../src/cite/core/sources.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { renderHistoryJson } from "../../src/cite/reporters/json.js";
import { renderHistoryPretty } from "../../src/cite/reporters/pretty.js";
import { generateEncryptionKey } from "../../src/shared/encryption.js";
import type { HistoryOptions, HistoryRun, StaleWindow } from "../../src/cite/types.js";
import { commit, git, gitAvailable, makeTempRepo, removeTempRepo, writeFile } from "../helpers/temp-repo.js";
import { CONFIG, at, iso, page, pin, source, story as built, type Story } from "./fixtures/history-repo.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempRepo(dir);
});

/** One story for the suite: every case reads it, and the one that writes puts it back. */
let shared: Story | undefined;
function story(): Story {
  return (shared ??= built());
}
afterAll(() => {
  removeTempRepo(shared?.repo);
});

async function history(repo: string, over: Partial<HistoryOptions> = {}): Promise<{ run: HistoryRun; notices: string[] }> {
  const notices: string[] = [];
  const run = await runHistory({
    cwd: repo,
    inputs: ["docs"],
    noConfig: true,
    env: {},
    onNotice: (notice) => notices.push(notice),
    ...over,
  });
  return { run, notices };
}

function windowsOf(run: HistoryRun): Map<string, StaleWindow> {
  return new Map(run.pages.flatMap((p) => p.windows.map((w) => [w.id, w] as const)));
}

// Each case walks a real history, a few seconds each and several times that
// on a loaded Windows runner, so the suite's 30s ceiling is raised a notch.
describe.skipIf(!gitAvailable())("cite history (0092)", { timeout: 90_000 }, () => {
  it("opens, closes and dates each window, with its cause, releases and earlier paths", async () => {
    const { repo, c } = story();
    const { run } = await history(repo);
    const windows = windowsOf(run);

    expect(run.pages.map((p) => p.file)).toEqual(["docs/guide.md"]);
    // A commit-sha alone is no event.
    expect(windows.has("zeta")).toBe(false);
    expect([...windows.keys()].sort()).toEqual(["alpha", "beta", "delta", "epsilon", "gamma"]);

    // Alpha moved at c2 and opened nothing; its text changed at c3.
    expect(windows.get("alpha")).toMatchObject({
      rule: "source-changed",
      severity: "error",
      source: "src/a.ts:10-12",
      opened: { commit: c.c3, bounded: false, subject: "change a, b, c" },
      closed: { commit: c.c4, by: "re-pinned" },
      seconds: 3600,
      releases: ["v1.0.0"],
      formerly: ["docs/page.md"],
    });
    expect(windows.get("beta")?.closed).toMatchObject({ commit: c.c4, by: "source-restored" });

    // A whitespace-only change is a change.
    expect(windows.get("epsilon")).toMatchObject({
      opened: { commit: c.c2 },
      closed: { commit: c.c4, by: "source-restored" },
      seconds: 7200,
      releases: ["v1.0.0"],
    });

    // Gamma crossed the rename, so it carries the old path. The side
    // branch's tag shipped it; the prerelease the trunk never took did not.
    expect(windows.get("gamma")).toMatchObject({
      opened: { commit: c.c3 },
      closed: { commit: c.c6, by: "removed" },
      seconds: 3 * 3600,
      releases: ["v1.0.0", "v1.1.0", "v1.2.0"],
      formerly: ["docs/page.md"],
    });

    // Still open: it runs to HEAD's committer time, and no tag contains it.
    expect(windows.get("delta")).toMatchObject({ opened: { commit: c.c6 }, closed: null, seconds: 2 * 3600, releases: [] });

    expect(run.summary).toMatchObject({
      head: c.c7,
      walked: { commits: 8, from: iso(0), to: iso(7) },
      files: 1,
      citations: 6,
      windows: 5,
      open: 1,
      staleSeconds: (1 + 2 + 1 + 3 + 2) * 3600,
      bySeverity: { notice: 0, warning: 0, error: 5 },
      releases: ["v1.0.0", "v1.1.0", "v1.2.0"],
      skipped: { encrypted: 0 },
    });
  });

  it("prints the same JSON twice", async () => {
    const { repo } = story();
    const first = renderHistoryJson((await history(repo)).run);
    const second = renderHistoryJson((await history(repo)).run);
    expect(second).toBe(first);
  });

  it("agrees with check at HEAD: open windows are check's stale-source findings", async () => {
    const { repo } = story();
    const { run } = await history(repo);
    const open = run.pages.flatMap((p) => p.windows.filter((w) => w.closed === null).map((w) => `${p.file} ${w.id}`));
    const check = await runCheck({ cwd: repo, inputs: ["docs"], noConfig: true, env: {} });
    const stale = new Set(["source-changed", "source-missing", "source-never-true"]);
    const findings = check.pages.flatMap((p) =>
      p.findings.filter((f) => stale.has(f.rule)).map((f) => `${p.file} ${String(f.id)}`),
    );
    expect(open.sort()).toEqual(findings.sort());
    expect(open.length).toBeGreaterThan(0);
  });

  it("prints each window under its page, and the totals", async () => {
    const { repo, c } = story();
    const text = renderHistoryPretty((await history(repo)).run, { color: false });
    const short = (sha: string | undefined): string => (sha ?? "").slice(0, 7);
    expect(text).toContain(
      `docs/guide.md\n  error  epsilon  src/e.ts:2-3  stale 2 hours  v1.0.0\n         ${short(c.c2)}..${short(c.c4)}  source-changed, closed when the source was restored (formerly docs/page.md)`,
    );
    expect(text).toContain("  error  delta  src/d.ts:7-8  stale 2 hours, open  -");
    expect(text).toContain(`${short(c.c6)}..HEAD  source-changed, still open at HEAD`);
    expect(text).toContain("closed when the entry was removed");
    expect(text).toContain("closed by a re-pin");
    expect(text).toMatch(
      /\n\n5 stale windows on 5 citations in 1 page, 1 open\. 9\.0 stale pin-hours\.\n3 releases shipped a stale pin: v1\.0\.0, v1\.1\.0, v1\.2\.0\.\nWalked 8 commits, 2026-01-01 to 2026-01-01\.$/,
    );
  });

  it("walks only the commits --newer-than covers, and marks a window open at the bound", async () => {
    const { repo, c } = story();
    const { run } = await history(repo, { newerThan: "2h" });
    const windows = windowsOf(run);
    expect(run.summary.walked.commits).toBe(3);
    expect(windows.get("delta")).toMatchObject({ opened: { commit: c.c6, bounded: true }, closed: null });
    expect(windows.has("alpha")).toBe(false);
  });

  it("gives each window the severity cite.severity sets, and drops a rule set off", async () => {
    const { repo } = story();
    try {
      writeFile(repo, "manni.config.yaml", `${CONFIG}cite:\n  severity:\n    source-changed: warning\n`);
      const warned = await history(repo, { inputs: [], noConfig: false });
      expect(warned.run.summary.bySeverity).toEqual({ notice: 0, warning: 5, error: 0 });
      writeFile(repo, "manni.config.yaml", `${CONFIG}cite:\n  severity:\n    source-changed: "off"\n`);
      const off = await history(repo, { inputs: [], noConfig: false });
      expect(off.run.summary.windows).toBe(0);
    } finally {
      writeFile(repo, "manni.config.yaml", CONFIG);
    }
  });

  it("refuses a duration it cannot read", async () => {
    const { repo } = story();
    await expect(history(repo, { newerThan: "soon" })).rejects.toThrow(
      '--newer-than must be a duration such as 30m, 24h, 7d or 2w, got "soon"',
    );
  });

  it("reads each commit's own config: citations that move into a sidecar are no event", async () => {
    const text = source("S");
    const repo = makeTempRepo({ files: { "src/s.ts": text } });
    dirs.push(repo);
    const p = pin("sigma", "src/s.ts", text, 4, 5);
    writeFile(repo, "docs/page.md", page([p]));
    commit(repo, "frontmatter", { authorDate: at(0) });
    writeFile(
      repo,
      "manni.config.yaml",
      'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n    externalMetadata:\n      - file: "{page}.citations.yaml"\n        keys: [citations]\n',
    );
    writeFile(repo, "docs/page.md", "---\ntitle: t\n---\nPinned prose.\n");
    writeFile(
      repo,
      "docs/page.citations.yaml",
      `docs/page.md:\n  citations:\n    - id: sigma\n      source:\n        file: src/s.ts\n        lines: 4-5\n        integrity: ${p.integrity}\n`,
    );
    commit(repo, "sidecar", { authorDate: at(1) });
    writeFile(repo, "src/s.ts", source("S", (n) => (n === 4 ? "export const S_4 = 40;" : undefined)));
    const changed = commit(repo, "change s", { authorDate: at(2) });

    const run = await runHistory({ cwd: repo, inputs: [], env: {} });
    const windows = windowsOf(run);
    expect([...windows.keys()]).toEqual(["sigma"]);
    expect(windows.get("sigma")).toMatchObject({ opened: { commit: changed, bounded: false }, closed: null });
    expect(run.summary.walked.commits).toBe(3);
  });

  it("says once when an older config does not load, and marks windows open there bounded", async () => {
    const text = source("O");
    const repo = makeTempRepo({ files: { "src/o.ts": text } });
    dirs.push(repo);
    const p = pin("omega", "src/o.ts", text, 1, 2);
    writeFile(repo, "manni.config.yaml", 'cite:\n  paths: ["docs/**/*.md"]\n');
    writeFile(repo, "docs/page.md", page([p]));
    commit(repo, "old config", { authorDate: at(0) });
    writeFile(repo, "src/o.ts", source("O", (n) => (n === 1 ? "export const O_1 = 10;" : undefined)));
    commit(repo, "change o", { authorDate: at(1) });
    writeFile(repo, "manni.config.yaml", CONFIG);
    const fixed = commit(repo, "new config", { authorDate: at(2) });

    const { run, notices } = await history(repo, { inputs: [], noConfig: false });
    expect(notices.filter((n) => n.startsWith("history before"))).toEqual([
      `history before ${fixed.slice(0, 7)} is unread: its manni.config.yaml does not load under this version. Windows open there are marked bounded.`,
    ]);
    expect(windowsOf(run).get("omega")).toMatchObject({ opened: { commit: fixed, bounded: true }, closed: null });
    expect(run.summary.walked.commits).toBe(1);
  });

  it("skips an encrypted citation without the key, and says so once", async () => {
    const key = generateEncryptionKey();
    const text = source("K");
    const repo = makeTempRepo({ files: { "src/k.ts": text } });
    dirs.push(repo);
    const keyed = {
      id: "kappa",
      file: encryptSourcePath("src/k.ts", key),
      lines: "1-2",
      integrity: hashRange(text, { start: 1, end: 2 }, key),
    };
    writeFile(repo, "docs/page.md", page([keyed, { ...keyed, id: "kappa-two" }]));
    commit(repo, "keyed", { authorDate: at(0) });

    const { run, notices } = await history(repo);
    expect(run.summary.skipped.encrypted).toBe(2);
    expect(run.summary.citations).toBe(0);
    expect(notices).toEqual([
      "2 encrypted citations were skipped: no encryption key. Set MANNI_ENCRYPTION_KEY or encryptionKey: to include them.",
    ]);

    const withKey = await history(repo, { env: { MANNI_ENCRYPTION_KEY: key } });
    expect(withKey.run.summary).toMatchObject({ citations: 2, windows: 0, skipped: { encrypted: 0 } });
  });

  it("refuses stdin, a path outside git and a shallow clone", async () => {
    const { repo } = story();
    await expect(history(repo, { inputs: ["-"] })).rejects.toThrow(
      "cite history reads each page's past from git, and stdin has none. Name the page's path instead of -.",
    );
    const plain = makeTempRepo({ init: false, files: { "docs/page.md": page([]) } });
    dirs.push(plain);
    await expect(history(plain, { root: plain })).rejects.toThrow(
      `cite history reads git, and ${plain} is not inside a git repository.`,
    );
    const shallow = makeTempRepo({ init: false, files: {} });
    dirs.push(shallow);
    git(shallow, ["clone", "-q", "--depth", "1", pathToFileURL(repo).href, "clone"]);
    await expect(history(`${shallow}/clone`)).rejects.toThrow(
      "this clone is shallow, so cite history would start at its oldest commit. Fetch the full history with fetch-depth: 0, or git fetch --unshallow.",
    );
  });
});
