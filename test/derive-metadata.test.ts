/**
 * `deriveMetadata` — the orchestrator that consults git, CODEOWNERS and the
 * forge for every requested field and resolves each field's precedence.
 *
 * The repository is built at runtime with pinned dates and identities. The
 * forge is a hand-written `ForgeClient` injected through `ctx.forge`, which
 * both keeps the network out and lets a case assert the forge was never
 * asked at all.
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
  type ForgeClient,
  type MergedChange,
} from "../src/meta/core/derive/types.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import { DocmetaError } from "../src/meta/types.js";
import { commit, makeTempRepo, removeTempRepo, writeFile } from "./helpers/temp-repo.js";

const D1 = "2026-01-10T09:00:00+00:00";
const D2 = "2026-02-20T09:00:00+00:00";
const NOW = new Date(2026, 8, 7, 12, 0, 0);

const doc = (fm: string, body: string): string => `---\n${fm}\n---\n\n${body}\n`;

function input(dir: string, rel: string): DeriveInput {
  const absPath = join(dir, ...rel.split("/"));
  const content = readFileSync(absPath, "utf8");
  return { label: rel, absPath, content, extracted: markdownExtractor.extract(content, absPath) };
}

/** A forge that approves everything, and remembers what it was asked. */
function fakeForge(change: MergedChange | null = MERGED): ForgeClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    detect: () => {
      calls.push("detect");
      return Promise.resolve({ kind: "github" as const, host: "github.com", project: "acme/docs" });
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
    expect(consultedSources(["reviewed-by"], DERIVE_SOURCES)).toEqual(["git", "forge"]);
  });

  it("is narrowed by the run's source list, in that list's order", () => {
    expect(consultedSources(DERIVABLE_FIELDS, ["git"])).toEqual(["git"]);
    expect(consultedSources(DERIVABLE_FIELDS, ["forge", "git"])).toEqual(["forge", "git"]);
    expect(consultedSources(["owner"], ["git", "forge"])).toEqual([]);
  });

  it("FIELD_SOURCES lists the forge ahead of git for the review fields only", () => {
    expect(FIELD_SOURCES["reviewed-by"]).toEqual(["forge", "git"]);
    expect(FIELD_SOURCES["last-reviewed"]).toEqual(["forge", "git"]);
    expect(FIELD_SOURCES.owner).toEqual(["codeowners"]);
    expect(FIELD_SOURCES.created).toEqual(["git"]);
  });
});

describe("deriveMetadata", () => {
  it("resolves all six fields, each from its source", async () => {
    const { dir, first, second } = repo();
    const forge = fakeForge();
    const result = await deriveMetadata([input(dir, "docs/a.md"), input(dir, "docs/b.md")], ctx(dir, { forge }));

    expect(result.sources).toEqual({
      git: { available: true },
      codeowners: { available: true },
      forge: { available: true },
    });
    const a = result.records.get("docs/a.md");
    expect(a?.file).toBe("docs/a.md");
    expect(a?.fields).toEqual({
      created: { value: "2026-01-10", source: "git", evidence: `added in ${first.slice(0, 7)} (2026-01-10)` },
      "last-updated": { value: "2026-02-20", source: "git", evidence: `body changed in ${second.slice(0, 7)} (2026-02-20)` },
      authors: { value: ["Ada", "Bob"], source: "git", evidence: "2 body-changing commits" },
      owner: { value: ["@platform-docs", "@maya"], source: "codeowners", evidence: ".github/CODEOWNERS:1" },
      "reviewed-by": { value: ["maya", "devin"], source: "forge", evidence: "github PR #18" },
      "last-reviewed": { value: "2026-02-21", source: "forge", evidence: "github PR #18" },
    });
    // b.md was never edited after its first commit, and that commit is the
    // one the forge is asked about.
    const b = result.records.get("docs/b.md");
    expect(b?.fields.created).toMatchObject({ value: "2026-01-10" });
    expect(b?.fields["reviewed-by"]).toMatchObject({ source: "forge" });
    expect(forge.calls.filter((c) => c.startsWith("mergedChangeFor"))).toEqual([
      `mergedChangeFor ${second}`,
      `mergedChangeFor ${first}`,
    ]);
  });

  it("consults only the sources the requested fields need", async () => {
    const { dir } = repo();
    const forge = fakeForge();
    const result = await deriveMetadata([input(dir, "docs/a.md")], ctx(dir, { forge, fields: ["owner"] }));
    expect(result.sources).toEqual({ codeowners: { available: true } });
    expect(result.records.get("docs/a.md")?.fields).toEqual({
      owner: { value: ["@platform-docs", "@maya"], source: "codeowners", evidence: ".github/CODEOWNERS:1" },
    });
    expect(forge.calls).toEqual([]);
  });

  it("never calls the forge when the sources list leaves it out", async () => {
    const { dir, second } = repo();
    const forge = fakeForge();
    const result = await deriveMetadata([input(dir, "docs/a.md")], ctx(dir, { forge, sources: ["git"] }));
    expect(result.sources).toEqual({ git: { available: true } });
    expect(forge.calls).toEqual([]);
    const fields = result.records.get("docs/a.md")?.fields;
    // With the forge out, the trailer is the review evidence.
    expect(fields?.["reviewed-by"]).toEqual({
      value: ["Rae"],
      source: "git",
      evidence: `Reviewed-by trailer in ${second.slice(0, 7)}`,
    });
    expect(fields?.["last-reviewed"]).toMatchObject({ value: "2026-02-20", source: "git" });
    // codeowners was not consulted, so owner has no answer at all.
    expect(fields?.owner).toBeNull();
  });

  it("prefers the forge's approvals over a Reviewed-by trailer", async () => {
    const { dir } = repo();
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { forge: fakeForge(), fields: ["reviewed-by", "last-reviewed"] }),
    );
    const fields = result.records.get("docs/a.md")?.fields;
    expect(fields?.["reviewed-by"]).toMatchObject({ value: ["maya", "devin"], source: "forge" });
    expect(fields?.["last-reviewed"]).toMatchObject({ value: "2026-02-21", source: "forge" });
  });

  it("falls back to the trailer when the forge has no merged change", async () => {
    const { dir, second } = repo();
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { forge: fakeForge(null), fields: ["reviewed-by"] }),
    );
    expect(result.records.get("docs/a.md")?.fields["reviewed-by"]).toEqual({
      value: ["Rae"],
      source: "git",
      evidence: `Reviewed-by trailer in ${second.slice(0, 7)}`,
    });
  });

  it("reports the forge unavailable without git, and never calls it", async () => {
    const { dir } = repo();
    const forge = fakeForge();
    const result = await deriveMetadata(
      [input(dir, "docs/a.md")],
      ctx(dir, { forge, sources: ["forge"], fields: ["reviewed-by"] }),
    );
    expect(result.sources.forge?.available).toBe(false);
    expect(result.sources.forge?.reason).toContain("needs the git source");
    expect(result.sources).not.toHaveProperty("git");
    expect(forge.calls).toEqual([]);
    expect(result.records.get("docs/a.md")?.fields["reviewed-by"]).toBeNull();
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
      ctx(dir, { forge: fakeForge() }),
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
      assertSourcesAvailable({ git: { available: true }, forge: { available: true } });
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
      assertSourcesAvailable({ forge: { available: false } });
    }).toThrow(
      new DocmetaError("forge source unavailable: it could not answer"),
    );
  });
});
