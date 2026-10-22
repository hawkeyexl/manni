/**
 * Proposal 0100: an entry's `source.repo` names the checkout its file lives
 * in. Each checkout is opened only when an entry in the run names it, and
 * every read for that entry stays inside it.
 *
 * Three sibling checkouts are built from real commits at test time
 * (`fixtures/repos-repo.ts`), because only git can say what a checkout
 * tracks and what its history holds.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCheck } from "../../src/cite/commands/check.js";
import { GIT_UNAVAILABLE_HISTORY, SOURCE_HISTORY_UNAVAILABLE, gitClient, noGit } from "../../src/cite/core/git.js";
import { hashRange } from "../../src/cite/core/hash.js";
import { mintSource } from "../../src/cite/core/mint.js";
import { encryptSourcePath, sourceIndexFor } from "../../src/cite/core/sources.js";
import { entryObject } from "../../src/cite/core/write.js";
import { CiteError } from "../../src/cite/errors.js";
import { renderCheckJson } from "../../src/cite/reporters/json.js";
import { renderCheckPretty } from "../../src/cite/reporters/pretty.js";
import type { CheckOptions, CheckRun, Checkout, SourceEnd } from "../../src/cite/types.js";
import { gitAvailable, removeTempRepo } from "../helpers/temp-repo.js";
import {
  PAGE,
  SDK_CLIENT,
  SDK_CLIENT_TEXT,
  citedPage,
  editLine,
  reposRepo,
  type ReposRepo,
} from "./fixtures/repos-repo.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempRepo(dir);
});

function made(opts: Parameters<typeof reposRepo>[0] = {}): ReposRepo {
  const repos = reposRepo(opts);
  dirs.push(repos.dir);
  return repos;
}

const KEY = "repos-key-0123456789abcdef0123456789ab";

async function check(
  r: ReposRepo,
  over: Partial<CheckOptions> = {},
): Promise<{ run: CheckRun; notices: string[] }> {
  const notices: string[] = [];
  const run = await runCheck({
    cwd: r.docs,
    inputs: [PAGE],
    noConfig: true,
    env: {},
    repos: { api: r.api, sdk: r.sdk },
    onNotice: (notice) => notices.push(notice),
    ...over,
  });
  return { run, notices };
}

function sources(run: CheckRun, page = 0): SourceEnd[] {
  return (run.pages[page]?.citations ?? []).map((c) => c.source);
}

function sourceOf(run: CheckRun, id: string): SourceEnd | undefined {
  return run.pages[0]?.citations.find((c) => c.citation.id === id)?.source;
}

function exitOf(run: CheckRun): number {
  return run.results.some((result) => !result.ok) ? 1 : 0;
}

describe.skipIf(!gitAvailable())("cite check across checkouts (0100)", () => {
  it("resolves each entry in the checkout its repo names", async () => {
    const r = made();
    const { run } = await check(r);
    expect(sources(run).map((s) => [s.src, s.repo, s.status])).toEqual([
      ["api:lib/limits.ts:2", "api", "current"],
      ["sdk:src/client.ts:2", "sdk", "current"],
      ["api:README.md:3", "api", "current"],
    ]);
    expect(exitOf(run)).toBe(0);
  });

  it("reads cite.repos from manni.config.yaml, relative to the config", async () => {
    const r = made();
    writeFileSync(join(r.docs, "manni.config.yaml"), "cite:\n  repos:\n    api: ../api\n    sdk: ../sdk\n");
    const { run } = await check(r, { noConfig: false, repos: undefined });
    expect(sources(run).map((s) => s.status)).toEqual(["current", "current", "current"]);
  });

  it("a commit in one checkout changes only the entry that cites it", async () => {
    const r = made();
    editLine(r.sdk, SDK_CLIENT, SDK_CLIENT_TEXT, 2, "  return retry(() => fetch(url), { attempts: 5 });");
    const { run } = await check(r);
    expect(sourceOf(run, "timeout")?.status).toBe("current");
    expect(sourceOf(run, "node")?.status).toBe("current");
    const retries = sourceOf(run, "retries");
    expect(retries?.status).toBe("changed");
    expect(retries?.baselineSha).toBe(r.minted.sdk);
    const findings = run.pages[0]?.findings ?? [];
    expect(findings.map((f) => [f.rule, f.src])).toEqual([["source-changed", "sdk:src/client.ts:2"]]);
    expect(findings[0]?.message).toMatch(new RegExp(`^changed since ${r.minted.sdk.slice(0, 7)}, 1 commit\\.`));
  });

  it("a file two checkouts both hold resolves in the one the entry names", async () => {
    const r = made();
    // Line 3 of the sdk README says Node 22, the docs one Node 20: only api's holds the pin.
    expect(sourceOf((await check(r)).run, "node")?.status).toBe("current");
    const swapped = await check(r, { repos: { api: r.sdk, sdk: r.sdk } });
    expect(sourceOf(swapped.run, "node")?.status).not.toBe("current");
  });

  it("an entry naming an undeclared repo is source-missing, and says how to declare it", async () => {
    const r = made();
    const { run } = await check(r, { repos: { api: r.api } });
    const retries = sourceOf(run, "retries");
    expect(retries).toMatchObject({
      src: "sdk:src/client.ts:2",
      repo: "sdk",
      status: "missing",
      missingReason: "unknown-repo",
    });
    const finding = run.pages[0]?.findings.find((f) => f.id === "retries");
    expect(finding?.rule).toBe("source-missing");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toBe(
      "missing (no repo named sdk is declared). Declare sdk under cite.repos in manni.config.yaml, or pass --repo sdk=<dir>.",
    );
    expect(exitOf(run)).toBe(1);
  });

  it("never opens a declared checkout no entry names", async () => {
    const r = made();
    const { run } = await check(r, { repos: { api: r.api, sdk: r.sdk, ghost: join(r.dir, "ghost") } });
    expect(sources(run).every((s) => s.status === "current")).toBe(true);
  });

  it("opens no checkout at all with the sources off", async () => {
    const r = made();
    const { run } = await check(r, { checkSources: false, repos: { api: join(r.dir, "no-api"), sdk: join(r.dir, "no-sdk") } });
    expect(sources(run).map((s) => [s.status, s.repo])).toEqual([
      ["skipped", "api"],
      ["skipped", "sdk"],
      ["skipped", "api"],
    ]);
  });

  it("a cited checkout whose directory is missing stops the run", async () => {
    const r = made();
    const gone = join(r.dir, "nope");
    const refused = await check(r, { repos: { api: r.api, sdk: gone } }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(CiteError);
    expect((refused as CiteError).message).toBe(
      `Repo directory not found: ${gone} (sdk). Fix --repo sdk=<dir>, or cite.repos.sdk in manni.config.yaml.`,
    );
  });

  it("says a checkout without git once, prefixed, however many pages cite it; the root's stays bare", async () => {
    const r = made({ sdkGit: false });
    // Changed, so the sdk entry wants history its checkout cannot give.
    writeFileSync(join(r.sdk, SDK_CLIENT), SDK_CLIENT_TEXT.replace("attempts: 3", "attempts: 5"));
    copyFileSync(join(r.docs, PAGE), join(r.docs, "pages/more.md"));
    const { run, notices } = await check(r, { inputs: ["pages"], showDiff: true, gitClient: noGit() });
    expect(run.pages.length).toBeGreaterThan(1);
    expect(notices.filter((n) => n === `sdk: ${GIT_UNAVAILABLE_HISTORY}`)).toHaveLength(1);
    expect(notices.filter((n) => n === GIT_UNAVAILABLE_HISTORY)).toHaveLength(1);
    expect(notices.some((n) => n.startsWith("api: "))).toBe(false);
  });

  it("says a shallow checkout once, prefixed", async () => {
    const r = made();
    editLine(r.sdk, SDK_CLIENT, SDK_CLIENT_TEXT, 2, "  return retry(() => fetch(url), { attempts: 5 });");
    const shallow = join(r.dir, "sdk-shallow");
    execFileSync("git", ["clone", "-q", "--depth", "1", pathToFileURL(r.sdk).href, shallow], { stdio: "ignore" });
    copyFileSync(join(r.docs, PAGE), join(r.docs, "pages/more.md"));
    const { run, notices } = await check(r, { inputs: ["pages"], repos: { api: r.api, sdk: shallow } });
    expect(sourceOf(run, "retries")?.historyAvailable).toBe(false);
    expect(notices.filter((n) => n === `sdk: ${SOURCE_HISTORY_UNAVAILABLE}`)).toHaveLength(1);
    expect(notices).not.toContain(SOURCE_HISTORY_UNAVAILABLE);
  });

  it("-f json carries repo after src, and the prefixed src", async () => {
    const r = made();
    const { run } = await check(r);
    const json = JSON.parse(renderCheckJson(run)) as {
      pages: { citations: { source: Record<string, unknown> }[] }[];
    };
    const source = json.pages[0]?.citations[1]?.source;
    expect(source?.src).toBe("sdk:src/client.ts:2");
    expect(source?.repo).toBe("sdk");
    expect(Object.keys(source ?? {}).slice(0, 3)).toEqual(["src", "repo", "status"]);
  });

  it("an encrypted source in a repo: untracked, reveal, and an undeclared repo", async () => {
    const r = made();
    const token = encryptSourcePath(SDK_CLIENT, KEY);
    const gone = encryptSourcePath("src/gone.ts", KEY);
    const keyed = hashRange(SDK_CLIENT_TEXT, { start: 2, end: 2 }, KEY);
    writeFileSync(
      join(r.docs, "pages/secret.md"),
      citedPage([
        { id: "kept", sentence: "It retries.", repo: "sdk", file: token, lines: 2, integrity: keyed },
        { id: "gone", sentence: "It is gone.", repo: "sdk", file: gone, lines: 2, integrity: keyed },
      ]),
    );
    const env = { MANNI_ENCRYPTION_KEY: KEY };
    const { run } = await check(r, { inputs: ["pages/secret.md"], env });
    expect(sources(run).map((s) => s.status)).toEqual(["current", "missing"]);
    expect(run.pages[0]?.findings.map((f) => f.message)).toEqual([
      "missing (no tracked file matches in sdk; wrong cite.repos.sdk?). Point cite.repos.sdk at the sdk checkout, or re-add the citation against the new path.",
    ]);
    const pretty = renderCheckPretty(run, { color: false, reveal: true });
    expect(pretty).toContain(`sdk:${token.slice(0, 5)}…:2 (src/client.ts) current`);
    expect(pretty).not.toContain("gone.ts");

    const undeclared = await check(r, { inputs: ["pages/secret.md"], env, repos: {} });
    expect(undeclared.run.pages[0]?.findings.map((f) => f.message)).toEqual([
      "missing (no repo named sdk is declared). Declare sdk under cite.repos in manni.config.yaml, or pass --repo sdk=<dir>.",
      "missing (no repo named sdk is declared). Declare sdk under cite.repos in manni.config.yaml, or pass --repo sdk=<dir>.",
    ]);
  });

  describe("minting in a repo", () => {
    async function sdkCheckout(r: ReposRepo): Promise<Checkout> {
      const git = gitClient(r.sdk);
      return { root: r.sdk, index: await sourceIndexFor(r.sdk, git), git, repo: "sdk" };
    }
    const at2 = (path: string): { repo: string; path: string; encrypted: boolean; start: number; end: number } => ({
      repo: "sdk",
      path,
      encrypted: path.startsWith("~"),
      start: 2,
      end: 2,
    });

    it("reads the range in its checkout, records that checkout's HEAD, and writes repo first", async () => {
      const r = made();
      const minted = await mintSource(at2(SDK_CLIENT), await sdkCheckout(r), {});
      expect(minted.source).toEqual({
        repo: "sdk",
        file: SDK_CLIENT,
        lines: 2,
        integrity: hashRange(SDK_CLIENT_TEXT, { start: 2, end: 2 }),
        "commit-sha": r.minted.sdk,
      });
      expect(Object.keys(minted.source)[0]).toBe("repo");
      expect(Object.keys(entryObject(minted).source as object).slice(0, 2)).toEqual(["repo", "file"]);
    });

    it("names the repo when the checkout does not track the path", async () => {
      const r = made();
      const checkout = await sdkCheckout(r);
      await expect(mintSource(at2("lib/limits.ts"), checkout, {})).rejects.toThrow(
        "Source not found: lib/limits.ts is not a tracked file in sdk.",
      );
      const token = encryptSourcePath("lib/limits.ts", KEY);
      await expect(mintSource(at2(token), checkout, { key: KEY })).rejects.toThrow(
        `No tracked file matches ${token} in sdk (wrong cite.repos.sdk?).`,
      );
    });
  });
});
