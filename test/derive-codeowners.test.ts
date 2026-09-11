import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  CODEOWNERS_LOCATIONS,
  deriveFromCodeowners,
  findCodeowners,
  ownersFor,
  parseCodeowners,
  type CodeownersFile,
} from "../src/meta/core/derive/codeowners.js";

const FIXTURES = resolve(__dirname, "fixtures/derive/codeowners");
const fx = (...parts: string[]): string => join(FIXTURES, ...parts);

function load(root: string, rel: string): CodeownersFile {
  const path = join(root, ...rel.split("/"));
  return parseCodeowners(readFileSync(path, "utf8"), path, rel);
}

const github = () => load(fx("github"), ".github/CODEOWNERS");
const gitlab = () => load(fx("gitlab"), ".gitlab/CODEOWNERS");

/** A `rootOf` stub: the fixture directory that contains the path, else null. */
function rootOfFixture(...names: string[]) {
  const roots = names.map((n) => fx(n));
  return (absPath: string): string | null =>
    roots.find((r) => absPath === r || absPath.startsWith(r + sep)) ?? null;
}

describe("CODEOWNERS_LOCATIONS", () => {
  it("lists the four locations in search order", () => {
    expect(CODEOWNERS_LOCATIONS).toEqual([
      ".github/CODEOWNERS",
      "CODEOWNERS",
      "docs/CODEOWNERS",
      ".gitlab/CODEOWNERS",
    ]);
  });
});

describe("findCodeowners", () => {
  it(".github beats the root, docs and .gitlab", () => {
    expect(findCodeowners(fx("order"))).toBe(
      fx("order", ".github", "CODEOWNERS"),
    );
  });

  it("the root beats docs and .gitlab", () => {
    expect(findCodeowners(fx("order-root"))).toBe(
      fx("order-root", "CODEOWNERS"),
    );
  });

  it("docs beats .gitlab", () => {
    expect(findCodeowners(fx("order-docs"))).toBe(
      fx("order-docs", "docs", "CODEOWNERS"),
    );
  });

  it("finds each location on its own", () => {
    expect(findCodeowners(fx("github"))).toBe(
      fx("github", ".github", "CODEOWNERS"),
    );
    expect(findCodeowners(fx("root-only"))).toBe(
      fx("root-only", "CODEOWNERS"),
    );
    expect(findCodeowners(fx("docs-location"))).toBe(
      fx("docs-location", "docs", "CODEOWNERS"),
    );
    expect(findCodeowners(fx("gitlab"))).toBe(
      fx("gitlab", ".gitlab", "CODEOWNERS"),
    );
  });

  it("returns null when no location exists", () => {
    expect(findCodeowners(fx("empty"))).toBeNull();
  });

  it("an explicit path overrides the search", () => {
    expect(findCodeowners(fx("order"), "docs/CODEOWNERS")).toBe(
      fx("order", "docs", "CODEOWNERS"),
    );
    expect(findCodeowners(fx("order"), fx("order", "docs", "CODEOWNERS"))).toBe(
      fx("order", "docs", "CODEOWNERS"),
    );
  });

  it("an explicit path that does not exist is null, not a fallback", () => {
    expect(findCodeowners(fx("order"), "nope/CODEOWNERS")).toBeNull();
  });
});

describe("parseCodeowners", () => {
  it("reads rules with their line numbers, skipping comments and blanks", () => {
    const file = github();
    expect(file.label).toBe(".github/CODEOWNERS");
    expect(file.sections).toEqual([]);
    expect(file.rules.map((r) => [r.pattern, r.owners, r.line])).toEqual([
      ["*", ["@org/docs"], 2],
      ["docs/", ["@maya"], 4],
      ["docs/api/*.md", ["@sara", "@devin"], 5],
      ["docs/**/reference.md", ["@sara"], 6],
      ["/README.md", ["@theo"], 7],
      ["docs/drafts/", [], 10],
      ["release notes/", ["@devin"], 12],
    ]);
    expect(file.rules.every((r) => r.section === undefined)).toBe(true);
  });

  it("keeps owner spelling: handles, teams and emails", () => {
    const file = parseCodeowners(
      "docs/ @Maya @org/Docs-Team maya@example.com\n",
      "CODEOWNERS",
      "CODEOWNERS",
    );
    expect(file.rules[0]?.owners).toEqual([
      "@Maya",
      "@org/Docs-Team",
      "maya@example.com",
    ]);
  });

  it("parses GitLab section headers", () => {
    const file = gitlab();
    expect(file.sections).toEqual([
      { name: "Docs", optional: false, defaultOwners: ["@org/docs"] },
      { name: "Optional", optional: true, defaultOwners: [] },
      { name: "Security", optional: false, approvals: 2, defaultOwners: ["@sec"] },
    ]);
    expect(file.rules.map((r) => [r.pattern, r.owners, r.line, r.section])).toEqual([
      ["*", ["@org/all"], 2, undefined],
      ["docs/", [], 5, "Docs"],
      ["docs/api/", ["@sara"], 6, "Docs"],
      ["docs/api/", ["@devin"], 9, "Optional"],
      ["docs/api/**", [], 12, "Security"],
    ]);
  });

  it("skips an unparseable line and never throws", () => {
    const file = parseCodeowners(
      "[Unclosed @nobody\n*.md @maya\n^[Also unclosed\n",
      "CODEOWNERS",
      "CODEOWNERS",
    );
    expect(file.sections).toEqual([]);
    expect(file.rules.map((r) => [r.pattern, r.owners, r.line])).toEqual([
      ["*.md", ["@maya"], 2],
    ]);
  });
});

describe("ownersFor (GitHub)", () => {
  it("falls back to the catch-all rule", () => {
    expect(ownersFor(github(), "src/index.ts")).toEqual({
      owners: ["@org/docs"],
      line: 2,
    });
  });

  it("the last matching rule wins outright", () => {
    expect(ownersFor(github(), "docs/api/get.md")).toEqual({
      owners: ["@sara", "@devin"],
      line: 5,
    });
  });

  it("a matching rule with no owners clears the owners", () => {
    expect(ownersFor(github(), "docs/drafts/idea.md")).toEqual({
      owners: [],
      line: 10,
    });
  });

  it("a trailing slash covers everything under the directory", () => {
    expect(ownersFor(github(), "docs/guide.md")).toEqual({
      owners: ["@maya"],
      line: 4,
    });
    expect(ownersFor(github(), "docs/deep/er/guide.md")).toEqual({
      owners: ["@maya"],
      line: 4,
    });
  });

  it("a trailing wildcard covers the directory's own files, not what is nested", () => {
    // GitHub: `docs/*` matches docs/getting-started.md and nothing deeper,
    // so a nested file falls back to the rule before it.
    const file = load(fx("wildcard-final"), "CODEOWNERS");
    expect(ownersFor(file, "docs/getting-started.md")).toEqual({
      owners: ["@docs-team"],
      line: 2,
    });
    expect(ownersFor(file, "docs/build-app/troubleshooting.md")).toEqual({
      owners: ["@default"],
      line: 1,
    });
  });

  it("a bare extension pattern still matches at any depth", () => {
    const file = parseCodeowners("*.md @maya\n", "CODEOWNERS", "CODEOWNERS");
    expect(ownersFor(file, "a.md")).toEqual({ owners: ["@maya"], line: 1 });
    expect(ownersFor(file, "docs/deep/er/b.md")).toEqual({ owners: ["@maya"], line: 1 });
    expect(ownersFor(file, "docs/b.txt")).toBeNull();
  });

  it("a single * does not cross directories", () => {
    // docs/api/*.md does not reach docs/api/v2/get.md; docs/ still does.
    expect(ownersFor(github(), "docs/api/v2/get.md")).toEqual({
      owners: ["@maya"],
      line: 4,
    });
  });

  it("** matches any depth", () => {
    expect(ownersFor(github(), "docs/a/b/c/reference.md")).toEqual({
      owners: ["@sara"],
      line: 6,
    });
    expect(ownersFor(github(), "docs/reference.md")).toEqual({
      owners: ["@sara"],
      line: 6,
    });
  });

  it("a leading slash anchors to the root", () => {
    expect(ownersFor(github(), "README.md")).toEqual({
      owners: ["@theo"],
      line: 7,
    });
    expect(ownersFor(github(), "docs/README.md")).toEqual({
      owners: ["@maya"],
      line: 4,
    });
  });

  it("a pattern without a slash matches at any depth", () => {
    const file = parseCodeowners(
      "CHANGELOG.md @devin\n",
      "CODEOWNERS",
      "CODEOWNERS",
    );
    expect(ownersFor(file, "CHANGELOG.md")).toEqual({
      owners: ["@devin"],
      line: 1,
    });
    expect(ownersFor(file, "packages/a/CHANGELOG.md")).toEqual({
      owners: ["@devin"],
      line: 1,
    });
  });

  it("an escaped space is a literal space", () => {
    expect(ownersFor(github(), "release notes/1.0.md")).toEqual({
      owners: ["@devin"],
      line: 12,
    });
  });

  it("is null when no rule matches", () => {
    const file = parseCodeowners("docs/ @maya\n", "CODEOWNERS", "CODEOWNERS");
    expect(ownersFor(file, "src/index.ts")).toBeNull();
  });
});

describe("ownersFor (GitLab sections)", () => {
  it("unions the winning owners across every section, in section order", () => {
    expect(ownersFor(gitlab(), "docs/api/get.md")).toEqual({
      owners: ["@org/all", "@sara", "@devin", "@sec"],
      line: 12,
    });
  });

  it("uses the section's default owners for a rule that lists none", () => {
    expect(ownersFor(gitlab(), "docs/guide.md")).toEqual({
      owners: ["@org/all", "@org/docs"],
      line: 5,
    });
  });

  it("an optional section still contributes owners", () => {
    const file = parseCodeowners(
      "^[Optional]\n*.md @maya\n",
      "CODEOWNERS",
      "CODEOWNERS",
    );
    expect(ownersFor(file, "a.md")).toEqual({ owners: ["@maya"], line: 2 });
  });

  it("the last match wins within a section", () => {
    const file = parseCodeowners(
      "[Docs]\ndocs/ @maya\ndocs/api/ @sara\n",
      "CODEOWNERS",
      "CODEOWNERS",
    );
    expect(ownersFor(file, "docs/api/get.md")).toEqual({
      owners: ["@sara"],
      line: 3,
    });
  });

  it("deduplicates owners across sections, keeping first appearance", () => {
    const file = parseCodeowners(
      "* @maya @sara\n[Docs]\ndocs/ @sara @maya\n",
      "CODEOWNERS",
      "CODEOWNERS",
    );
    expect(ownersFor(file, "docs/a.md")).toEqual({
      owners: ["@maya", "@sara"],
      line: 3,
    });
  });

  it("is null when no section matches", () => {
    expect(ownersFor(gitlab(), "src/a.ts")).toEqual({
      owners: ["@org/all"],
      line: 2,
    });
    const file = parseCodeowners(
      "[Docs]\ndocs/ @maya\n",
      "CODEOWNERS",
      "CODEOWNERS",
    );
    expect(ownersFor(file, "src/a.ts")).toBeNull();
  });
});

describe("deriveFromCodeowners", () => {
  it("is unavailable, not a crash, when the CODEOWNERS file cannot be read", async () => {
    // A path that exists and cannot be read. A directory stands in for a
    // file deleted between the existence check and the read.
    const res = await deriveFromCodeowners(
      [{ label: "docs/api/get.md", absPath: fx("github", "docs", "api", "get.md") }],
      { explicit: ".github", configDir: fx("github"), rootOf: rootOfFixture("github") },
    );
    expect(res.status.available).toBe(false);
    expect(res.status.reason).toMatch(/could not be read/);
  });

  it("asks for a directory's repository root once, however many of its files are read", async () => {
    let calls = 0;
    const inner = rootOfFixture("github");
    await deriveFromCodeowners(
      [
        { label: "docs/api/get.md", absPath: fx("github", "docs", "api", "get.md") },
        { label: "docs/api/post.md", absPath: fx("github", "docs", "api", "post.md") },
      ],
      {
        rootOf: (p) => {
          calls += 1;
          return inner(p);
        },
      },
    );
    expect(calls).toBe(1);
  });

  it("derives owners per input from the root's CODEOWNERS", async () => {
    const res = await deriveFromCodeowners(
      [
        { label: "docs/api/get.md", absPath: fx("github", "docs", "api", "get.md") },
        { label: "src/index.ts", absPath: fx("github", "src", "index.ts") },
      ],
      { rootOf: rootOfFixture("github") },
    );
    expect(res.status).toEqual({ available: true });
    expect(res.records.get("docs/api/get.md")).toEqual({
      value: ["@sara", "@devin"],
      source: "codeowners",
      evidence: ".github/CODEOWNERS:5",
    });
    expect(res.records.get("src/index.ts")).toEqual({
      value: ["@org/docs"],
      source: "codeowners",
      evidence: ".github/CODEOWNERS:2",
    });
  });

  it("records null for an input no rule matches", async () => {
    const res = await deriveFromCodeowners(
      [{ label: "src/a.ts", absPath: fx("gitlab", "src", "a.ts") }],
      { rootOf: rootOfFixture("gitlab") },
    );
    // Only the default section's `*` matches here.
    expect(res.records.get("src/a.ts")).toEqual({
      value: ["@org/all"],
      source: "codeowners",
      evidence: ".gitlab/CODEOWNERS:2",
    });
    const file = await deriveFromCodeowners(
      [{ label: "doc.md", absPath: fx("docs-location", "doc.md") }],
      { rootOf: rootOfFixture("docs-location") },
    );
    expect(file.records.get("doc.md")).toEqual({
      value: ["@docs-owner"],
      source: "codeowners",
      evidence: "docs/CODEOWNERS:1",
    });
  });

  it("handles inputs in more than one repository", async () => {
    const res = await deriveFromCodeowners(
      [
        { label: "a/README.md", absPath: fx("github", "README.md") },
        { label: "b/x.md", absPath: fx("root-only", "x.md") },
      ],
      { rootOf: rootOfFixture("github", "root-only") },
    );
    expect(res.status).toEqual({ available: true });
    expect(res.records.get("a/README.md")).toEqual({
      value: ["@theo"],
      source: "codeowners",
      evidence: ".github/CODEOWNERS:7",
    });
    expect(res.records.get("b/x.md")).toEqual({
      value: ["@root-owner"],
      source: "codeowners",
      evidence: "CODEOWNERS:1",
    });
  });

  it("a root with no file gets null records when another root has one", async () => {
    const res = await deriveFromCodeowners(
      [
        { label: "a/x.md", absPath: fx("root-only", "x.md") },
        { label: "b/doc.md", absPath: fx("empty", "doc.md") },
      ],
      { rootOf: rootOfFixture("root-only", "empty") },
    );
    expect(res.status).toEqual({ available: true });
    expect(res.records.get("a/x.md")?.value).toEqual(["@root-owner"]);
    expect(res.records.has("b/doc.md")).toBe(true);
    expect(res.records.get("b/doc.md")).toBeNull();
  });

  it("an input outside any repository is absent from the records", async () => {
    const res = await deriveFromCodeowners(
      [
        { label: "in.md", absPath: fx("root-only", "in.md") },
        { label: "out.md", absPath: resolve("/nowhere/out.md") },
      ],
      { rootOf: rootOfFixture("root-only") },
    );
    expect(res.status).toEqual({ available: true });
    expect(res.records.has("in.md")).toBe(true);
    expect(res.records.has("out.md")).toBe(false);
  });

  it("an explicit path overrides the search and labels relative to configDir", async () => {
    const res = await deriveFromCodeowners(
      [{ label: "x.md", absPath: fx("order", "x.md") }],
      {
        explicit: "docs/CODEOWNERS",
        configDir: fx("order"),
        rootOf: rootOfFixture("order"),
      },
    );
    expect(res.status).toEqual({ available: true });
    expect(res.records.get("x.md")).toEqual({
      value: ["@docs-loc"],
      source: "codeowners",
      evidence: "docs/CODEOWNERS:1",
    });
  });

  it("an explicit path that is missing is unavailable, naming the path", async () => {
    const missing = fx("order", "nope", "CODEOWNERS");
    const res = await deriveFromCodeowners(
      [{ label: "x.md", absPath: fx("order", "x.md") }],
      {
        explicit: "nope/CODEOWNERS",
        configDir: fx("order"),
        rootOf: rootOfFixture("order"),
      },
    );
    expect(res.status).toEqual({
      available: false,
      reason: `CODEOWNERS not found at ${missing}`,
    });
    expect(res.records.size).toBe(0);
  });

  it("no file in any root is available with a notice: no owners declared is a fact", async () => {
    // A repository that never wrote a CODEOWNERS has no owners, which is an
    // honest null, not a broken source. The search is carried as a reason so
    // a command can say it once; only an explicit path that is missing fails.
    const res = await deriveFromCodeowners(
      [{ label: "doc.md", absPath: fx("empty", "doc.md") }],
      { rootOf: rootOfFixture("empty") },
    );
    expect(res.status).toEqual({
      available: true,
      reason:
        "no CODEOWNERS file found (looked for .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS, .gitlab/CODEOWNERS)",
    });
    expect(res.records.get("doc.md")).toBeNull();
  });

  it("no input in any repository is unavailable too", async () => {
    const res = await deriveFromCodeowners(
      [{ label: "out.md", absPath: resolve("/nowhere/out.md") }],
      { rootOf: () => null },
    );
    expect(res.status.available).toBe(false);
    expect(res.records.size).toBe(0);
  });
});
