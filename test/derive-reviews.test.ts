/**
 * The review sources: `reviewed-by` and `last-reviewed` from the PR/MR that
 * merged a commit, reached through `gh` / `glab`.
 *
 * Nothing here touches GitHub or GitLab. The clients spawn
 * `test/helpers/fake-review-cli-bin.mjs` through `bin: process.execPath`, so the
 * process seam is exercised for real — argv, exit codes, stdout parsing,
 * timeouts — against canned answers, and the exact command line is asserted
 * from the fake's call log.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitHubClient,
  GitLabClient,
  createReviewClient,
  deriveFromReviews,
  identityFromOrigin,
  parseOriginUrl,
  type ReviewClient,
  type RemoteIdentity,
  type MergedChange,
} from "../src/meta/core/derive/reviews.js";
import { REVIEW_CACHE_DIR, ReviewCache, cachedClient } from "../src/meta/core/derive/cache.js";
import { DocmetaError } from "../src/meta/types.js";
import {
  FAKE_REVIEW_CLI_BIN,
  fakeReviewCli,
  type FakeReviewCli,
  type FakeResponse,
} from "./helpers/fake-review-cli.js";
import { DOC, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

// Every case here spawns git, the built bin, or a fake CLI, and a Windows
// runner under load takes longer than vitest's 5 s default for a single
// spawn chain. The whole file gets the budget the bin-spawning suites use.
vi.setConfig({ testTimeout: 60_000 });

const GITHUB: RemoteIdentity = { kind: "github", host: "github.com", project: "acme/docs" };
const GITLAB: RemoteIdentity = { kind: "gitlab", host: "gitlab.com", project: "group/sub/docs" };
const SHA = "424f71a0c3d2e1f0b9a8c7d6e5f4a3b2c1d0e9f8";

const AUTH_OK: FakeResponse = { includes: ["auth", "status"], exit: 0 };

const REVIEWS = [
  { user: { login: "maya" }, state: "COMMENTED", submitted_at: "2026-03-01T09:00:00Z" },
  { user: { login: "maya" }, state: "APPROVED", submitted_at: "2026-03-01T10:00:00Z" },
  { user: { login: "claude[bot]" }, state: "APPROVED", submitted_at: "2026-03-01T11:00:00Z" },
  { user: { login: "devin" }, state: "CHANGES_REQUESTED", submitted_at: "2026-03-01T12:00:00Z" },
  { user: { login: "devin" }, state: "APPROVED", submitted_at: "2026-03-02T08:30:00Z" },
  // Same reviewer as `claude[bot]` under the other spelling: one login, latest wins.
  { user: { login: "claude" }, state: "APPROVED", submitted_at: "2026-03-02T09:00:00Z" },
];

const PR_18 = { number: 18, state: "closed", merged_at: "2026-03-02T10:00:00Z" };

function ghScenario(...extra: FakeResponse[]): FakeResponse[] {
  return [
    AUTH_OK,
    { includes: ["api", `repos/acme/docs/commits/${SHA}/pulls`], stdout: [PR_18] },
    { includes: ["api", "repos/acme/docs/pulls/18/reviews?per_page=100"], stdout: REVIEWS },
    ...extra,
  ];
}

let fake: FakeReviewCli | undefined;
afterEach(() => {
  fake?.cleanup();
  fake = undefined;
});

describe("parseOriginUrl", () => {
  it("reads the scp-like ssh form", () => {
    expect(parseOriginUrl("git@github.com:acme/docs.git")).toEqual({
      host: "github.com",
      project: "acme/docs",
    });
  });

  it("reads the https form", () => {
    expect(parseOriginUrl("https://github.com/acme/docs.git")).toEqual({
      host: "github.com",
      project: "acme/docs",
    });
    expect(parseOriginUrl("https://user@ghe.example.com/acme/docs")).toEqual({
      host: "ghe.example.com",
      project: "acme/docs",
    });
  });

  it("reads the ssh:// form, with and without a port", () => {
    expect(parseOriginUrl("ssh://git@gitlab.example.com/group/sub/docs")).toEqual({
      host: "gitlab.example.com",
      project: "group/sub/docs",
    });
    expect(parseOriginUrl("ssh://git@gitlab.example.com:2222/group/docs.git")).toEqual({
      host: "gitlab.example.com",
      project: "group/docs",
    });
  });

  it("rejects what is not a remote URL", () => {
    expect(parseOriginUrl("")).toBeNull();
    expect(parseOriginUrl("/srv/git/docs.git")).toBeNull();
    expect(parseOriginUrl("./mirrors/docs.git")).toBeNull();
    expect(parseOriginUrl("../mirrors/docs.git")).toBeNull();
    expect(parseOriginUrl("\\\\fileserver\\git\\docs.git")).toBeNull();
    expect(parseOriginUrl("https://github.com/")).toBeNull();
  });

  it("does not read a Windows drive letter as an scp host", () => {
    expect(parseOriginUrl("C:/mirrors/docs-repo.git")).toBeNull();
    expect(parseOriginUrl("C:\\mirrors\\repo.git")).toBeNull();
    expect(parseOriginUrl("c:/mirrors/repo.git")).toBeNull();
    // The real spellings are untouched.
    expect(parseOriginUrl("git@github.com:o/r.git")).toEqual({ host: "github.com", project: "o/r" });
    expect(parseOriginUrl("https://github.com/o/r.git")).toEqual({ host: "github.com", project: "o/r" });
    expect(parseOriginUrl("ssh://git@host/o/r")).toEqual({ host: "host", project: "o/r" });
  });
});

describe("identityFromOrigin", () => {
  it("maps github.com to github and a gitlab host to gitlab", () => {
    expect(identityFromOrigin("github.com", "acme/docs")).toEqual(GITHUB);
    expect(identityFromOrigin("gitlab.com", "group/sub/docs")).toEqual(GITLAB);
    expect(identityFromOrigin("gitlab.example.com", "g/p")?.kind).toBe("gitlab");
  });

  it("reads the platform from a host that names it, whatever the domain", () => {
    expect(identityFromOrigin("github.example.com", "acme/docs")?.kind).toBe("github");
    expect(identityFromOrigin("GitLab.corp.example", "g/p")?.kind).toBe("gitlab");
  });

  it("never assumes a platform for a host that names neither", () => {
    // `github` applies to GitHub and `gitlab` to GitLab; a bare host is
    // decided by the one source the config requested, and by nothing else.
    expect(identityFromOrigin("git.example.com", "acme/docs")).toBeNull();
    expect(identityFromOrigin("git.example.com", "acme/docs", ["github", "gitlab"])).toBeNull();
    expect(identityFromOrigin("git.example.com", "acme/docs", ["github"])).toEqual({
      kind: "github",
      host: "git.example.com",
      project: "acme/docs",
    });
    expect(identityFromOrigin("git.example.com", "acme/docs", ["gitlab"])?.kind).toBe("gitlab");
  });
});

describe("GitHubClient", () => {
  it("finds the merged PR and its approvals, deduped by login and ordered", async () => {
    fake = fakeReviewCli(ghScenario());
    const client = new GitHubClient(GITHUB, fake.spawn);
    expect(await client.detect()).toEqual(GITHUB);
    expect(await client.status()).toEqual({ available: true });

    const change = await client.mergedChangeFor(SHA);
    expect(change).toEqual({
      id: 18,
      mergedAt: "2026-03-02T10:00:00Z",
      approvals: [
        { login: "maya", submittedAt: "2026-03-01T10:00:00Z" },
        { login: "devin", submittedAt: "2026-03-02T08:30:00Z" },
        { login: "claude", submittedAt: "2026-03-02T09:00:00Z" },
      ],
    });

    expect(fake.calls()).toEqual([
      ["auth", "status", "--hostname", "github.com"],
      ["api", "--hostname", "github.com", `repos/acme/docs/commits/${SHA}/pulls`],
      ["api", "--hostname", "github.com", "repos/acme/docs/pulls/18/reviews?per_page=100&page=1"],
    ]);
  });

  it("walks every page of reviews, since the endpoint lists oldest first", async () => {
    // A full first page means a second page may hold the latest approval.
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      user: { login: "maya" },
      state: "COMMENTED",
      submitted_at: `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00Z`,
    }));
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: [PR_18] },
      // page=2 first: the fake matches the first scenario whose tokens all appear.
      {
        includes: ["api", "reviews?per_page=100&page=2"],
        stdout: [{ user: { login: "devin" }, state: "APPROVED", submitted_at: "2026-03-02T08:30:00Z" }],
      },
      { includes: ["api", "reviews?per_page=100&page=1"], stdout: firstPage },
    ]);
    const change = await new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA);
    expect(change?.approvals).toEqual([{ login: "devin", submittedAt: "2026-03-02T08:30:00Z" }]);
    expect(fake.calls().filter((c) => c.some((a) => a.includes("reviews")))).toHaveLength(2);
  });

  it("keeps the REST spelling of a bot when it is the latest approval", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: [PR_18] },
      {
        includes: ["api", "reviews"],
        stdout: [
          { user: { login: "claude" }, state: "APPROVED", submitted_at: "2026-03-01T09:00:00Z" },
          { user: { login: "claude[bot]" }, state: "APPROVED", submitted_at: "2026-03-01T10:00:00Z" },
        ],
      },
    ]);
    const change = await new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA);
    expect(change?.approvals).toEqual([
      { login: "claude[bot]", submittedAt: "2026-03-01T10:00:00Z" },
    ]);
  });

  it("answers null for an open PR", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      {
        includes: ["api", `commits/${SHA}/pulls`],
        stdout: [{ number: 19, state: "open", merged_at: null }],
      },
    ]);
    expect(await new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA)).toBeNull();
    expect(fake.calls().some((c) => c.includes("pr"))).toBe(false);
  });

  it("falls back to pr list --search when the commits endpoint is empty", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: [] },
      {
        includes: ["pr", "list", "--search", SHA],
        stdout: [{ number: 18, mergedAt: "2026-03-02T10:00:00Z" }],
      },
      { includes: ["api", "repos/acme/docs/pulls/18/reviews?per_page=100"], stdout: REVIEWS },
    ]);
    const change = await new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA);
    expect(change?.id).toBe(18);
    expect(change?.mergedAt).toBe("2026-03-02T10:00:00Z");
    expect(fake.calls()[1]).toEqual([
      "pr", "list", "--search", SHA, "--state", "merged",
      "--json", "number,mergedAt", "-R", "github.com/acme/docs",
    ]);
  });

  it("answers null when neither lookup knows the commit", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: [] },
      { includes: ["pr", "list"], stdout: [] },
    ]);
    expect(await new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA)).toBeNull();
  });

  it("fetches the PR when the list item does not say whether it merged", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: [{ number: 18 }] },
      // Reviews first: `pulls/18` is a prefix of the reviews path, and the
      // fake takes the first response whose fragments all match.
      { includes: ["api", "repos/acme/docs/pulls/18/reviews?per_page=100"], stdout: REVIEWS },
      { includes: ["api", "repos/acme/docs/pulls/18"], stdout: PR_18 },
    ]);
    const change = await new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA);
    expect(change?.mergedAt).toBe("2026-03-02T10:00:00Z");
    expect(fake.calls().map((c) => c.at(-1))).toEqual([
      `repos/acme/docs/commits/${SHA}/pulls`,
      "repos/acme/docs/pulls/18",
      "repos/acme/docs/pulls/18/reviews?per_page=100&page=1",
    ]);
  });

  it("treats a 404 from the host as no change, not as a failure", async () => {
    // A squashed-away sha is exactly what the commits endpoint rejects, so a
    // not-found there still goes on to the search; only then is it null.
    fake = fakeReviewCli([
      AUTH_OK,
      {
        includes: ["api", `commits/${SHA}/pulls`],
        exit: 1,
        stderr: "gh: Not Found (HTTP 404)\n",
      },
      { includes: ["pr", "list"], stdout: [] },
    ]);
    expect(await new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA)).toBeNull();
    expect(fake.calls().map((c) => c[0])).toEqual(["api", "pr"]);
  });

  it("reports an unauthenticated gh with the fix", async () => {
    fake = fakeReviewCli([
      { includes: ["auth", "status"], exit: 1, stdout: "You are not logged into any GitHub hosts.\n" },
    ]);
    const status = await new GitHubClient(GITHUB, fake.spawn).status();
    expect(status.available).toBe(false);
    expect(status.reason).toBe("gh is not authenticated for github.com; run gh auth login");
  });

  it("reports a missing binary with the fix", async () => {
    fake = fakeReviewCli([AUTH_OK]);
    const client = new GitHubClient(GITHUB, {
      ...fake.spawn,
      bin: join(fake.dir, "no-such-gh"),
      prefixArgs: [],
    });
    const status = await client.status();
    expect(status.available).toBe(false);
    expect(status.reason).toBe(
      "gh is not on PATH (origin is github.com); install gh and run gh auth login",
    );
  });

  it("reports a missing origin without blaming gh", async () => {
    fake = fakeReviewCli([AUTH_OK]);
    const client = new GitHubClient(null, fake.spawn);
    expect(await client.detect()).toBeNull();
    expect(await client.status()).toEqual({
      available: false,
      reason: "no origin remote to tell GitHub from GitLab",
    });
    expect(await client.mergedChangeFor(SHA)).toBeNull();
    expect(fake.calls()).toEqual([]);
  });

  it("throws a DocmetaError naming the command when a call fails", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: [PR_18] },
      {
        includes: ["api", "reviews"],
        exit: 1,
        stderr: "gh: API rate limit exceeded (HTTP 403)\n",
      },
    ]);
    const client = new GitHubClient(GITHUB, fake.spawn);
    await expect(client.mergedChangeFor(SHA)).rejects.toThrow(DocmetaError);
    await expect(client.mergedChangeFor(SHA)).rejects.toThrow(
      /gh api --hostname github\.com repos\/acme\/docs\/pulls\/18\/reviews\?per_page=100&page=1 failed \(exit 1\): gh: API rate limit exceeded/,
    );
  });

  it("throws on a malformed answer rather than reading it as no approvals", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: "not json" },
    ]);
    await expect(new GitHubClient(GITHUB, fake.spawn).mergedChangeFor(SHA)).rejects.toThrow(
      /did not return JSON/,
    );
  });

  it("throws on a timeout", async () => {
    fake = fakeReviewCli(
      [AUTH_OK, { includes: ["api", `commits/${SHA}/pulls`], stdout: [PR_18], sleepMs: 5_000 }],
      { timeoutMs: 200 },
    );
    const client = new GitHubClient(GITHUB, fake.spawn);
    await expect(client.mergedChangeFor(SHA)).rejects.toThrow(DocmetaError);
    await expect(client.mergedChangeFor(SHA)).rejects.toThrow(/timed out after 200ms/);
  });
});

describe("GitLabClient", () => {
  const MR_SCENARIO: FakeResponse[] = [
    AUTH_OK,
    {
      includes: ["api", `projects/:fullpath/repository/commits/${SHA}/merge_requests`],
      stdout: [
        { iid: 7, state: "closed", merged_at: null },
        { iid: 18, state: "merged", merged_at: "2026-03-02T10:00:00.000Z" },
      ],
    },
    {
      includes: ["api", "projects/:fullpath/merge_requests/18/approvals"],
      stdout: { approved_by: [{ user: { username: "maya" } }, { user: { username: "devin" } }] },
    },
  ];

  it("finds the merged MR and stamps its approvals with the merge time", async () => {
    fake = fakeReviewCli(MR_SCENARIO);
    const client = new GitLabClient(GITLAB, fake.spawn);
    expect(await client.status()).toEqual({ available: true });
    expect(await client.mergedChangeFor(SHA)).toEqual({
      id: 18,
      mergedAt: "2026-03-02T10:00:00.000Z",
      approvals: [
        { login: "maya", submittedAt: "2026-03-02T10:00:00.000Z" },
        { login: "devin", submittedAt: "2026-03-02T10:00:00.000Z" },
      ],
    });
    expect(fake.calls()).toEqual([
      ["auth", "status", "--hostname", "gitlab.com"],
      ["api", "--hostname", "gitlab.com", `projects/:fullpath/repository/commits/${SHA}/merge_requests`],
      ["api", "--hostname", "gitlab.com", "projects/:fullpath/merge_requests/18/approvals"],
    ]);
  });

  it("answers null when no MR merged the commit", async () => {
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", "merge_requests"], stdout: [{ iid: 7, state: "opened", merged_at: null }] },
    ]);
    expect(await new GitLabClient(GITLAB, fake.spawn).mergedChangeFor(SHA)).toBeNull();
  });

  it("names glab in its status reasons", async () => {
    fake = fakeReviewCli([{ includes: ["auth", "status"], exit: 1 }]);
    expect((await new GitLabClient(GITLAB, fake.spawn).status()).reason).toBe(
      "glab is not authenticated for gitlab.com; run glab auth login",
    );
    const missing = new GitLabClient(GITLAB, {
      ...fake.spawn,
      bin: join(fake.dir, "no-such-glab"),
      prefixArgs: [],
    });
    expect((await missing.status()).reason).toBe(
      "glab is not on PATH (origin is gitlab.com); install glab and run glab auth login",
    );
  });
});

describe("ReviewCache", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const CHANGE: MergedChange = {
    id: 18,
    mergedAt: "2026-03-02T10:00:00Z",
    approvals: [{ login: "maya", submittedAt: "2026-03-01T10:00:00Z" }],
  };

  it("lives under .manni/meta/review-cache", () => {
    expect(REVIEW_CACHE_DIR).toBe(".manni/meta/review-cache");
  });

  it("round-trips a merged change under a digest-named file", () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    const cache = new ReviewCache(join(dir, "cache"), true);
    const key = `github.com/acme/docs/${SHA}`;
    expect(cache.get(key)).toBeUndefined();
    cache.set(key, CHANGE);
    expect(cache.get(key)).toEqual(CHANGE);
    const files = readdirSync(join(dir, "cache"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  it("treats a malformed entry as a miss", () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    const cache = new ReviewCache(join(dir, "cache"), true);
    const key = "github.com/acme/docs/deadbeef";
    cache.set(key, CHANGE);
    const [file] = readdirSync(join(dir, "cache"));
    if (file === undefined) throw new Error("no entry written");
    writeFileSync(join(dir, "cache", file), "{ not json", "utf8");
    expect(cache.get(key)).toBeUndefined();
    writeFileSync(join(dir, "cache", file), JSON.stringify({ key, change: { id: "x" } }), "utf8");
    expect(cache.get(key)).toBeUndefined();
  });

  it("does nothing when disabled", () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    const cache = new ReviewCache(join(dir, "cache"), false);
    cache.set("k", CHANGE);
    expect(cache.get("k")).toBeUndefined();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("swallows a write it cannot make", () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    // A file where the cache directory should be: mkdir fails.
    writeFileSync(join(dir, "cache"), "", "utf8");
    const cache = new ReviewCache(join(dir, "cache"), true);
    expect(() => { cache.set("k", CHANGE); }).not.toThrow();
    expect(cache.get("k")).toBeUndefined();
  });
});

describe("cachedClient", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("serves a merged answer from disk without spawning again", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    fake = fakeReviewCli(ghScenario());
    const cache = new ReviewCache(join(dir, REVIEW_CACHE_DIR), true);
    const client = cachedClient(new GitHubClient(GITHUB, fake.spawn), cache, GITHUB);

    const first = await client.mergedChangeFor(SHA);
    const spawnsAfterFirst = fake.calls().length;
    expect(spawnsAfterFirst).toBe(2);

    // A fresh client over the same directory, as the next run would build.
    const again = cachedClient(
      new GitHubClient(GITHUB, fake.spawn),
      new ReviewCache(join(dir, REVIEW_CACHE_DIR), true),
      GITHUB,
    );
    expect(await again.mergedChangeFor(SHA)).toEqual(first);
    expect(fake.calls().length).toBe(spawnsAfterFirst);

    const entry = readdirSync(join(dir, REVIEW_CACHE_DIR));
    expect(entry).toHaveLength(1);
    const raw = JSON.parse(readFileSync(join(dir, REVIEW_CACHE_DIR, entry[0] ?? ""), "utf8"));
    expect(raw.key).toBe(`github.com/acme/docs/${SHA}`);
  });

  it("spawns again when the cache is off", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    fake = fakeReviewCli(ghScenario());
    const cache = new ReviewCache(join(dir, REVIEW_CACHE_DIR), false);
    const client = cachedClient(new GitHubClient(GITHUB, fake.spawn), cache, GITHUB);
    await client.mergedChangeFor(SHA);
    await client.mergedChangeFor(SHA);
    expect(fake.calls()).toHaveLength(4);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("never caches a null answer, because an open PR may merge later", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    fake = fakeReviewCli([
      AUTH_OK,
      { includes: ["api", `commits/${SHA}/pulls`], stdout: [{ number: 19, merged_at: null }] },
    ]);
    const cache = new ReviewCache(join(dir, REVIEW_CACHE_DIR), true);
    const client = cachedClient(new GitHubClient(GITHUB, fake.spawn), cache, GITHUB);
    expect(await client.mergedChangeFor(SHA)).toBeNull();
    expect(await client.mergedChangeFor(SHA)).toBeNull();
    expect(fake.calls()).toHaveLength(2);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("passes status and detect through, and bypasses the cache with no identity", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "manni-review-cache-")));
    fake = fakeReviewCli([AUTH_OK]);
    const cache = new ReviewCache(join(dir, REVIEW_CACHE_DIR), true);
    const client = cachedClient(new GitHubClient(null, fake.spawn), cache, null);
    expect(await client.detect()).toBeNull();
    expect((await client.status()).available).toBe(false);
    expect(await client.mergedChangeFor(SHA)).toBeNull();
  });
});

describe("createReviewClient", () => {
  let repo: string | undefined;
  afterEach(() => {
    removeTempRepo(repo);
    repo = undefined;
  });

  it("reads the origin, picks the CLI, and caches under the root", async () => {
    repo = makeTempRepo({ files: { "a.md": DOC } });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/docs.git"], {
      cwd: repo,
      stdio: "ignore",
    });
    fake = fakeReviewCli(ghScenario());
    const client = await createReviewClient(repo, {
      cwd: repo,
      cache: true,
      cacheDir: REVIEW_CACHE_DIR,
      spawn: fake.spawn,
    });
    expect(await client.detect()).toEqual(GITHUB);
    expect(await client.status()).toEqual({ available: true });
    expect((await client.mergedChangeFor(SHA))?.id).toBe(18);
    expect(readdirSync(join(repo, REVIEW_CACHE_DIR))).toHaveLength(1);
  });

  it("picks glab for a gitlab origin", async () => {
    repo = makeTempRepo({ files: { "a.md": DOC } });
    execFileSync("git", ["remote", "add", "origin", "https://gitlab.com/group/sub/docs.git"], {
      cwd: repo,
      stdio: "ignore",
    });
    fake = fakeReviewCli([{ includes: ["auth", "status"], exit: 1 }]);
    const client = await createReviewClient(repo, {
      cwd: repo,
      cache: false,
      cacheDir: REVIEW_CACHE_DIR,
      spawn: fake.spawn,
    });
    expect(await client.detect()).toEqual(GITLAB);
    expect((await client.status()).reason).toContain("glab auth login");
  });

  it("refuses a host that names neither platform unless the config names one", async () => {
    // `github` applies to GitHub and `gitlab` to GitLab, never one for the
    // other; a bare host is the operator's to name, through the one source
    // the config requests.
    repo = makeTempRepo({ files: { "a.md": DOC } });
    execFileSync("git", ["remote", "add", "origin", "https://git.example.com/acme/docs.git"], {
      cwd: repo,
      stdio: "ignore",
    });
    fake = fakeReviewCli([{ includes: ["auth", "status"], exit: 1 }]);
    const base = { cwd: repo, cache: false, cacheDir: REVIEW_CACHE_DIR, spawn: fake.spawn };

    const undecided = await createReviewClient(repo, { ...base, requested: ["github", "gitlab"] });
    expect(await undecided.detect()).toBeNull();
    expect((await undecided.status()).reason).toContain("names neither GitHub nor GitLab");
    expect(await undecided.mergedChangeFor(SHA)).toBeNull();
    expect(fake.calls()).toEqual([]);

    const named = await createReviewClient(repo, { ...base, requested: ["gitlab"] });
    expect((await named.detect())?.kind).toBe("gitlab");
    expect((await named.status()).reason).toContain("glab auth login");
  });

  it("spawns the CLI in the repository root, not the caller's cwd", async () => {
    // glab substitutes `:fullpath` from the current repository and gh detects
    // the repository the same way, so the child must run from the checkout
    // the client was created for, wherever manni itself was started.
    repo = makeTempRepo({ files: { "a.md": DOC } });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/docs.git"], {
      cwd: repo,
      stdio: "ignore",
    });
    fake = fakeReviewCli(ghScenario());
    const client = await createReviewClient(repo, {
      cwd: fake.dir,
      cache: false,
      cacheDir: REVIEW_CACHE_DIR,
      spawn: { bin: process.execPath, prefixArgs: [FAKE_REVIEW_CLI_BIN] },
    });
    expect(await client.status()).toEqual({ available: true });
    expect((await client.mergedChangeFor(SHA))?.id).toBe(18);
    expect(fake.cwds()).toEqual([repo, repo, repo]);
  });

  it("reports a repository with no origin, and never spawns the CLI", async () => {
    repo = makeTempRepo({ files: { "a.md": DOC } });
    fake = fakeReviewCli([AUTH_OK]);
    const client = await createReviewClient(repo, {
      cwd: repo,
      cache: true,
      cacheDir: REVIEW_CACHE_DIR,
      spawn: fake.spawn,
    });
    expect(await client.detect()).toBeNull();
    expect(await client.status()).toEqual({
      available: false,
      reason: "no origin remote to tell GitHub from GitLab",
    });
    expect(fake.calls()).toEqual([]);
  });
});

/** A `ReviewClient` with canned answers, for the pure half of the source. */
function canned(
  identity: RemoteIdentity | null,
  changes: Record<string, MergedChange | null>,
  available = true,
): ReviewClient & { looked: string[] } {
  const looked: string[] = [];
  return {
    looked,
    detect: () => Promise.resolve(identity),
    status: () =>
      Promise.resolve(available ? { available } : { available, reason: "gh is not on PATH" }),
    mergedChangeFor(sha) {
      looked.push(sha);
      return Promise.resolve(changes[sha] ?? null);
    },
  };
}

describe("deriveFromReviews", () => {
  const CHANGE: MergedChange = {
    id: 18,
    mergedAt: "2026-03-02T10:00:00Z",
    approvals: [
      { login: "devin", submittedAt: "2026-03-02T23:30:00Z" },
      { login: "maya", submittedAt: "2026-03-01T10:00:00Z" },
    ],
  };

  it("derives both fields from a GitHub PR, reviewers in approval order", async () => {
    const client = canned(GITHUB, { [SHA]: CHANGE });
    const result = await deriveFromReviews([{ label: "docs/a.md", sha: SHA }], client);
    expect(result.status).toEqual({ available: true });
    expect(result.records.get("docs/a.md")).toEqual({
      "reviewed-by": { value: ["maya", "devin"], source: "github", evidence: "github PR #18" },
      "last-reviewed": { value: "2026-03-02", source: "github", evidence: "github PR #18" },
    });
  });

  it("uses the UTC date of the latest approval", async () => {
    const change: MergedChange = {
      ...CHANGE,
      approvals: [{ login: "maya", submittedAt: "2026-03-01T23:30:00-05:00" }],
    };
    const result = await deriveFromReviews([{ label: "a.md", sha: SHA }], canned(GITHUB, { [SHA]: change }));
    expect(result.records.get("a.md")?.["last-reviewed"]?.value).toBe("2026-03-02");
  });

  it("says where a GitLab date comes from", async () => {
    const change: MergedChange = {
      id: 18,
      mergedAt: "2026-03-02T10:00:00Z",
      approvals: [{ login: "maya", submittedAt: "2026-03-02T10:00:00Z" }],
    };
    const result = await deriveFromReviews([{ label: "a.md", sha: SHA }], canned(GITLAB, { [SHA]: change }));
    expect(result.records.get("a.md")).toEqual({
      "reviewed-by": { value: ["maya"], source: "gitlab", evidence: "gitlab MR !18" },
      "last-reviewed": {
        value: "2026-03-02",
        source: "gitlab",
        evidence: "gitlab MR !18 (merge date; GitLab records no approval time)",
      },
    });
  });

  it("derives null for a working-tree document, and never asks the host", async () => {
    const client = canned(GITHUB, { [SHA]: CHANGE });
    const result = await deriveFromReviews([{ label: "new.md", sha: null }], client);
    expect(result.records.get("new.md")).toEqual({ "reviewed-by": null, "last-reviewed": null });
    expect(client.looked).toEqual([]);
  });

  it("derives null when no PR merged the commit or it had no approvals", async () => {
    const client = canned(GITHUB, {
      aaa: null,
      bbb: { id: 3, mergedAt: "2026-01-01T00:00:00Z", approvals: [] },
    });
    const result = await deriveFromReviews(
      [{ label: "a.md", sha: "aaa" }, { label: "b.md", sha: "bbb" }],
      client,
    );
    expect(result.records.get("a.md")).toEqual({ "reviewed-by": null, "last-reviewed": null });
    expect(result.records.get("b.md")).toEqual({ "reviewed-by": null, "last-reviewed": null });
  });

  it("asks the host once per sha, however many documents share it", async () => {
    const client = canned(GITHUB, { [SHA]: CHANGE });
    await deriveFromReviews(
      [{ label: "a.md", sha: SHA }, { label: "b.md", sha: SHA }, { label: "c.md", sha: SHA }],
      client,
    );
    expect(client.looked).toEqual([SHA]);
  });

  it("reports an unavailable client without calling it", async () => {
    const client = canned(GITHUB, { [SHA]: CHANGE }, false);
    const result = await deriveFromReviews([{ label: "a.md", sha: SHA }], client);
    expect(result.status).toEqual({ available: false, reason: "gh is not on PATH" });
    expect(result.records.size).toBe(0);
    expect(client.looked).toEqual([]);
  });

  it("runs end to end through the gh client", async () => {
    fake = fakeReviewCli(ghScenario());
    const result = await deriveFromReviews(
      [{ label: "a.md", sha: SHA }],
      new GitHubClient(GITHUB, fake.spawn),
    );
    expect(result.records.get("a.md")).toEqual({
      "reviewed-by": { value: ["maya", "devin", "claude"], source: "github", evidence: "github PR #18" },
      "last-reviewed": { value: "2026-03-02", source: "github", evidence: "github PR #18" },
    });
  });
});
