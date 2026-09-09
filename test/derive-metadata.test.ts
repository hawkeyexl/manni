/**
 * `deriveMetadata` — the orchestrator that consults git, CODEOWNERS and the
 * review record on GitHub or GitLab for every requested field and resolves
 * each field's precedence.
 *
 * The repository is built at runtime with pinned dates and identities. The
 * review record is a hand-written `ReviewClient` injected through
 * `ctx.reviews`, which both keeps the network out and lets a case assert the
 * host was never asked at all. Its `detect()` answer is what tells the
 * orchestrator whether the repository is on GitHub or GitLab, so a case can
 * point the same fake at either host, or at no origin remote.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIELD_SOURCES,
  assertSourcesAvailable,
  consultedSources,
  deriveMetadata,
} from "../src/meta/core/derive/index.js";
import {
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  type DeriveContext,
  type DeriveInput,
  type MergedChange,
  type RemoteIdentity,
  type ReviewClient,
} from "../src/meta/core/derive/types.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { DocmetaError } from "../src/meta/types.js";
import { commit, makeTempRepo, removeTempRepo, writeFile } from "./helpers/temp-repo.js";

const D1 = "2026-01-10T09:00:00+00:00";
const D2 = "2026-02-20T09:00:00+00:00";
const NOW = new Date(2026, 8, 7, 12, 0, 0);

const ON_GITHUB: RemoteIdentity = { kind: "github", host: "github.com", project: "acme/docs" };
const ON_GITLAB: RemoteIdentity = { kind: "gitlab", host: "gitlab.com", project: "acme/docs" };

const doc = (fm: string, body: string): string => `---\n${fm}\n---\n\n${body}\n`;

function input(dir: string, rel: string): DeriveInput {
  const absPath = join(dir, ...rel.split("/"));
  const content = readFileSync(absPath, "utf8");
  return { label: rel, absPath, content, extracted: markdownExtractor.extract(content, absPath) };
}

/**
 * A review client that approves everything, and remembers what it was asked.
 * `identity` is what `detect()` answers: GitHub by default, GitLab for the
 * mirror cases, `null` for a repository with no origin remote.
 */
function fakeReviews(
  change: MergedChange | null = MERGED,
  identity: RemoteIdentity | null = ON_GITHUB,
): ReviewClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    detect: () => {
      calls.push("detect");
      return Promise.resolve(identity);
    },
    status: () => {
      calls.push("status");
      return Promise.resolve({ available: true });
    },
    mergedChangeFor: (sha) => {
      calls.push(`mergedChangeFor ${sha}`);
      return Promise.resolve(change);
    },
  };
}

const MERGED: MergedChange = {
  id: 18,
  mergedAt: "2026-02-21T10:00:00Z",
  approvals: [
    { login: "maya", submittedAt: "2026-02-20T15:00:00Z" },
    { login: "devin", submittedAt: "2026-02-21T09:30:00Z" },
  ],
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

/** Two pages under `docs/`, one edited and reviewed, plus a CODEOWNERS file. */
function repo(): { dir: string; first: string; second: string } {
  const dir = makeTempRepo({
    files: {
      ".github/CODEOWNERS": "docs/ @platform-docs @maya\n",
      "docs/a.md": doc("title: A", "one"),
      "docs/b.md": doc("title: B", "one"),
    },
  });
  dirs.push(dir);
  const first = commit(dir, "add", { authorDate: D1, author: { name: "Ada", email: "ada@example.com" } });
  writeFile(dir, "docs/a.md", doc("title: A", "two"));
  const second = commit(dir, "edit a", {
    authorDate: D2,
    author: { name: "Bob", email: "bob@example.com" },
    trailers: ["Reviewed-by: Rae <rae@example.com>"],
  });
  return { dir, first, second };
}

function ctx(dir: string, over: Partial<DeriveContext> = {}): DeriveContext {
  return {
    cwd: dir,
    base: dir,
    sources: DERIVE_SOURCES,
    fields: DERIVABLE_FIELDS,
    cache: false,
    now: () => NOW,
    ...over,
  };
}

describe("consultedSources", () => {
  it("consults only the sources some requested field can come from", () => {
    expect(consultedSources(["owner"], DERIVE_SOURCES)).toEqual(["codeowners"]);
    expect(consultedSources(["created", "owner"], DERIVE_SOURCES)).toEqual(["git", "codeowners"]);
    expect(consultedSources(["reviewed-by"], DERIVE_SOURCES)).toEqual(["git", "github", "gitlab"]);
  });

  it("is narrowed by the run's source list, in that list's order", () => {
    expect(consultedSources(DERIVABLE_FIELDS, ["git"])).toEqual(["git"]);
    expect(consultedSources(DERIVABLE_FIELDS, ["github", "git"])).toEqual(["github", "git"]);
    expect(consultedSources(DERIVABLE_FIELDS, ["gitlab", "git"])).toEqual(["gitlab", "git"]);
    expect(consultedSources(["owner"], ["git", "github", "gitlab"])).toEqual([]);
  });

  it("FIELD_SOURCES lists GitHub and GitLab ahead of git for the review fields only", () => {
    expect(FIELD_SOURCES["reviewed-by"]).toEqual(["github", "gitlab", "git"]);
    expect(FIELD_SOURCES["last-reviewed"]).toEqual(["github", "gitlab", "git"]);
    expect(FIELD_SOURCES.owner).toEqual(["codeowners"]);
    expect(FIELD_SOURCES.created).toEqual(["git"]);
  });
});

describe("deriveMetadata", () => {
  it("resolves all six fields, each from its source", async () => {
    const { dir, first, second } = repo();
    const reviews = fakeReviews();
    const result = await deriveMetadata([input(dir, "docs/a.md"), input(dir, "docs/b.md")], ctx(dir, { reviews }));

    // Both review sources were allowed; the origin is GitHub, so only
    // `github` was consulted and only `github` is reported.
    expect(result.sources).toEqual({
      git: { available: true },
      codeowners: { available: true },
      github: { available: true },
    });
    const a = result.records.get("docs/a.md");
    expect(a?.file).toBe("docs/a.md");
    expect(a?.fields).toEqual({
      created: { value: "2026-01-10", source: "git", evidence: `added in ${first.slice(0, 7)} (2026-01-10)` },
      "last-updated": { value: "2026-02-20", source: "git", evidence: `body changed in ${second.slice(0, 7)} (2026-02-20)` },
      authors: { value: ["Ada", "Bob"], source: "git", evidence: "2 body-changing commits" },
      owner: { value: ["@platform-docs", "@maya"], source: "codeowners", evidence: ".github/CODEOWNERS:1" },
      "reviewed-by": { value: ["maya", "devin"], source: "github", evidence: "github PR #18" },
      "last-reviewed": { value: "2026-02-21", source: "github", evidence: "github PR #18" },
    });
    // b.md was never edited after its first commit, and that commit is the
    // one the host is asked about.
    const b = result.records.get("docs/b.md");
    expect(b?.fields.created).toMatchObject({ value: "2026-01-10" });
    expect(b?.fields["reviewed-by"]).toMatchObject({ source: "github" });
    expect(reviews.calls.filter((c) => c.startsWith("mergedChangeFor"))).toEqual([
      `mergedChangeFor ${second}`,
      `mergedChangeFor ${first}`,
    ]);
  });

  it("names gitlab as the source when the origin is GitLab", async () => {
    const { dir } = repo();
    const reviews = fakeReviews(MERGED, ON_GITLAB);
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews, fields: ["reviewed-by", "last-reviewed"] }),
    );
    expect(result.sources).toEqual({ git: { available: true }, gitlab: { available: true } });
    expect(result.sources).not.toHaveProperty("github");
    const fields = result.records.get("docs/a.md")?.fields;
    expect(fields?.["reviewed-by"]).toEqual({
      value: ["maya", "devin"],
      source: "gitlab",
      evidence: "gitlab MR !18",
    });
    expect(fields?.["last-reviewed"]).toMatchObject({ value: "2026-02-21", source: "gitlab" });
  });

  it("consults only the sources the requested fields need", async () => {
    const { dir } = repo();
    const reviews = fakeReviews();
    const result = await deriveMetadata([input(dir, "docs/a.md")], ctx(dir, { reviews, fields: ["owner"] }));
    expect(result.sources).toEqual({ codeowners: { available: true } });
    expect(result.records.get("docs/a.md")?.fields).toEqual({
      owner: { value: ["@platform-docs", "@maya"], source: "codeowners", evidence: ".github/CODEOWNERS:1" },
    });
    expect(reviews.calls).toEqual([]);
  });

  it("never calls the host when the sources list leaves both review sources out", async () => {
    const { dir, second } = repo();
    const reviews = fakeReviews();
    const result = await deriveMetadata([input(dir, "docs/a.md")], ctx(dir, { reviews, sources: ["git"] }));
    expect(result.sources).toEqual({ git: { available: true } });
    expect(reviews.calls).toEqual([]);
    const fields = result.records.get("docs/a.md")?.fields;
    // With GitHub and GitLab out, the trailer is the review evidence.
    expect(fields?.["reviewed-by"]).toEqual({
      value: ["Rae"],
      source: "git",
      evidence: `Reviewed-by trailer in ${second.slice(0, 7)}`,
    });
    expect(fields?.["last-reviewed"]).toMatchObject({ value: "2026-02-20", source: "git" });
    // codeowners was not consulted, so owner has no answer at all.
    expect(fields?.owner).toBeNull();
  });

  it("prefers the host's approvals over a Reviewed-by trailer", async () => {
    const { dir } = repo();
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews: fakeReviews(), fields: ["reviewed-by", "last-reviewed"] }),
    );
    const fields = result.records.get("docs/a.md")?.fields;
    expect(fields?.["reviewed-by"]).toMatchObject({ value: ["maya", "devin"], source: "github" });
    expect(fields?.["last-reviewed"]).toMatchObject({ value: "2026-02-21", source: "github" });
  });

  it("falls back to the trailer when the host has no merged change", async () => {
    const { dir, second } = repo();
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews: fakeReviews(null), fields: ["reviewed-by"] }),
    );
    expect(result.records.get("docs/a.md")?.fields["reviewed-by"]).toEqual({
      value: ["Rae"],
      source: "git",
      evidence: `Reviewed-by trailer in ${second.slice(0, 7)}`,
    });
  });

  it("reports a review source unavailable without git, and never calls the host", async () => {
    const { dir } = repo();
    const reviews = fakeReviews();
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews, sources: ["github"], fields: ["reviewed-by"] }),
    );
    expect(result.sources).toEqual({
      github: {
        available: false,
        reason:
          "the github source needs the git source to find each document's commits; add git to sources",
      },
    });
    expect(reviews.calls).toEqual([]);
    expect(result.records.get("docs/a.md")?.fields["reviewed-by"]).toBeNull();
  });

  it("names the requested source when gitlab is the one missing git", async () => {
    const { dir } = repo();
    const reviews = fakeReviews(MERGED, ON_GITLAB);
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews, sources: ["gitlab"], fields: ["reviewed-by"] }),
    );
    expect(result.sources.gitlab?.reason).toBe(
      "the gitlab source needs the git source to find each document's commits; add git to sources",
    );
    expect(result.sources).not.toHaveProperty("github");
    expect(reviews.calls).toEqual([]);
  });

  it("reports gitlab unavailable when the origin is GitHub and only gitlab was requested", async () => {
    const { dir } = repo();
    const reviews = fakeReviews();
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews, sources: ["git", "gitlab"], fields: ["reviewed-by"] }),
    );
    expect(result.sources).toEqual({
      git: { available: true },
      gitlab: {
        available: false,
        reason:
          "the origin remote is github.com, which is GitHub; add github to sources, or drop reviewed-by and last-reviewed from the managed fields",
      },
    });
    // Detected, never asked. git still answers from the trailer; the caller
    // decides, through assertSourcesAvailable, that an unavailable source
    // fails the run.
    expect(reviews.calls).toEqual(["detect"]);
    expect(result.records.get("docs/a.md")?.fields["reviewed-by"]).toMatchObject({ source: "git" });
  });

  it("reports github unavailable when the origin is GitLab and only github was requested", async () => {
    const { dir } = repo();
    const reviews = fakeReviews(MERGED, ON_GITLAB);
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews, sources: ["git", "github"], fields: ["reviewed-by"] }),
    );
    expect(result.sources).toEqual({
      git: { available: true },
      github: {
        available: false,
        reason:
          "the origin remote is gitlab.com, which is GitLab; add gitlab to sources, or drop reviewed-by and last-reviewed from the managed fields",
      },
    });
    expect(reviews.calls).toEqual(["detect"]);
  });

  it("reports every requested review source unavailable when there is no origin remote", async () => {
    const { dir } = repo();
    const reviews = fakeReviews(MERGED, null);
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews, fields: ["reviewed-by"] }),
    );
    expect(result.sources).toEqual({
      git: { available: true },
      github: { available: false, reason: "no origin remote to tell GitHub from GitLab" },
      gitlab: { available: false, reason: "no origin remote to tell GitHub from GitLab" },
    });
    // After a null detect the orchestrator asks the client's status for the
    // reason, since a bare host and a missing origin read differently.
    expect(reviews.calls).toEqual(["detect", "status"]);
    expect(result.records.get("docs/a.md")?.fields["reviewed-by"]).toMatchObject({ source: "git" });
  });

  it("reports only the requested review source when there is no origin remote", async () => {
    const { dir } = repo();
    const reviews = fakeReviews(MERGED, null);
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { reviews, sources: ["git", "gitlab"], fields: ["reviewed-by"] }),
    );
    expect(result.sources).toEqual({
      git: { available: true },
      gitlab: { available: false, reason: "no origin remote to tell GitHub from GitLab" },
    });
  });

  it("gives a document outside any repository all-null fields", async () => {
    const { dir } = repo();
    const outside = makeTempRepo({
      files: { "loose.md": doc("title: L", "one") },
      init: false,
    });
    dirs.push(outside);
    const result = await deriveMetadata(
      [input(dir, "docs/a.md"), input(outside, "loose.md")],
      ctx(dir, { reviews: fakeReviews() }),
    );
    expect(result.sources.git).toEqual({ available: true });
    const loose = result.records.get("loose.md");
    expect(loose?.fields).toEqual({
      created: null,
      "last-updated": null,
      authors: null,
      owner: null,
      "reviewed-by": null,
      "last-reviewed": null,
    });
    expect(result.records.get("docs/a.md")?.fields.created).not.toBeNull();
  });

  it("assertSourcesAvailable throws exit-2 with the caller's hint appended", () => {
    expect(() => {
      assertSourcesAvailable({ git: { available: true }, github: { available: true } });
    }).not.toThrow();
    expect(() => {
      assertSourcesAvailable(
        { git: { available: false, reason: "this checkout is shallow" } },
        "narrow --sources or --fields",
      );
    }).toThrow(
      new DocmetaError(
        "git source unavailable: this checkout is shallow; narrow --sources or --fields",
      ),
    );
    expect(() => {
      assertSourcesAvailable({ gitlab: { available: false } });
    }).toThrow(
      new DocmetaError("gitlab source unavailable: it could not answer"),
    );
  });
});
