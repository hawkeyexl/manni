/**
 * The git source of the derived channel (proposal 0040).
 *
 * Every repository is built at runtime by `makeTempRepo` + `commit`, with
 * author dates and identities pinned per commit, so the facts under test are
 * the ones the commits state rather than whatever the machine's clock and git
 * config would produce. Each case runs in both walk forms — per-file
 * `--follow` and the bulk whole-repository walk — because proposal 0040
 * promises the two produce the same history.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  bodyOf,
  deriveFromGit,
  type GitFacts,
  type GitSourceOptions,
} from "../src/meta/core/derive/git.js";
import type { DeriveInput } from "../src/meta/core/derive/types.js";
import { markdownExtractor } from "../src/meta/extractors/markdown.js";
import {
  commit,
  git,
  makeTempRepo,
  removeTempRepo,
  writeFile,
} from "./helpers/temp-repo.js";

const D1 = "2020-01-02T03:04:05+02:00";
const D2 = "2020-02-03T03:04:05+02:00";
const D3 = "2020-03-04T03:04:05+02:00";
const D4 = "2020-04-05T03:04:05+02:00";

const NOW = new Date(2026, 8, 7, 12, 0, 0); // 2026-09-07, local time
const BOM = String.fromCharCode(0xfeff);

const doc = (fm: string, body: string): string => `---\n${fm}\n---\n\n${body}\n`;

function input(dir: string, rel: string): DeriveInput {
  const absPath = join(dir, rel);
  const content = readFileSync(absPath, "utf8");
  return {
    label: rel,
    absPath,
    content,
    extracted: markdownExtractor.extract(content, absPath),
  };
}

const forms: { name: string; opts: (dir: string) => GitSourceOptions }[] = [
  { name: "per-file", opts: (dir) => ({ cwd: dir, now: () => NOW }) },
  {
    name: "bulk",
    opts: (dir) => ({ cwd: dir, now: () => NOW, bulkThreshold: 0 }),
  },
];

async function factsFor(
  dir: string,
  rel: string,
  opts: GitSourceOptions,
): Promise<GitFacts> {
  const result = await deriveFromGit([input(dir, rel)], opts);
  expect(result.status).toEqual({ available: true });
  const facts = result.records.get(rel);
  if (!facts) throw new Error(`no record for ${rel}`);
  return facts;
}

const dirs: string[] = [];
const tempRepo = (files: Record<string, string>, init = true): string => {
  const dir = makeTempRepo({ files, init });
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

describe.each(forms)("deriveFromGit ($name)", ({ opts }) => {
  it("dates a file's birth through a rename", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    const first = commit(dir, "add", { authorDate: D1 });
    git(dir, ["mv", "a.md", "b.md"]);
    commit(dir, "move", { authorDate: D2 });
    writeFile(dir, "b.md", doc("title: t", "two"));
    const third = commit(dir, "edit", { authorDate: D3 });

    const facts = await factsFor(dir, "b.md", opts(dir));
    expect(facts.created).toEqual({
      value: "2020-01-02",
      source: "git",
      evidence: `added in ${first.slice(0, 7)} (2020-01-02)`,
    });
    expect(facts["last-updated"]).toEqual({
      value: "2020-03-04",
      source: "git",
      evidence: `body changed in ${third.slice(0, 7)} (2020-03-04)`,
    });
    expect(facts.lastBodyCommit).toBe(third);
    expect(facts.root).toBe(dir);
  });

  it("does not count a frontmatter-only edit as a body change", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    const first = commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t\ntags: [x]", "one"));
    commit(dir, "retag", { authorDate: D2 });

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts["last-updated"]).toEqual({
      value: "2020-01-02",
      source: "git",
      evidence: `body changed in ${first.slice(0, 7)} (2020-01-02)`,
    });
    expect(facts.lastBodyCommit).toBe(first);
  });

  it("prefers a stamp set in the same commit over the commit's date", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t\nlast-updated: 2001-01-01", "two"));
    const second = commit(dir, "edit and stamp", { authorDate: D2 });

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts["last-updated"]).toEqual({
      value: "2001-01-01",
      source: "git",
      evidence: `stamped in ${second.slice(0, 7)}`,
    });
  });

  it("agrees with a squash commit that carries both body and stamps", async () => {
    const dir = tempRepo({
      "a.md": doc("created: 1999-09-09\nlast-updated: 2001-01-01", "one"),
    });
    const sha = commit(dir, "squash", { authorDate: D1 });

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts.created).toEqual({
      value: "1999-09-09",
      source: "git",
      evidence: `stamped in ${sha.slice(0, 7)}`,
    });
    expect(facts["last-updated"]).toEqual({
      value: "2001-01-01",
      source: "git",
      evidence: `stamped in ${sha.slice(0, 7)}`,
    });
  });

  it("dates an uncommitted body change today", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "two"));

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts["last-updated"]).toEqual({
      value: "2026-09-07",
      source: "git",
      evidence: "uncommitted body change",
    });
    expect(facts.lastBodyCommit).toBeNull();
    expect(facts["reviewed-by"]).toBeNull();
    expect(facts["last-reviewed"]).toBeNull();
  });

  it("takes a changed working-tree stamp over today", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t\nlast-updated: 2002-02-02", "two"));

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts["last-updated"]).toEqual({
      value: "2002-02-02",
      source: "git",
      evidence: "stamped in working tree",
    });
    expect(facts.lastBodyCommit).toBeNull();
  });

  it("has nothing but today for an untracked file", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "new.md", doc("title: n", "fresh"));

    const facts = await factsFor(dir, "new.md", opts(dir));
    expect(facts.created).toBeNull();
    expect(facts.authors).toBeNull();
    expect(facts["last-updated"]).toEqual({
      value: "2026-09-07",
      source: "git",
      evidence: "uncommitted body change",
    });
  });

  it("lists authors oldest first, deduplicated, without bots", async () => {
    const ada = { name: "Ada", email: "ada@example.com" };
    const bob = { name: "Bob", email: "bob@example.com" };
    const bot = { name: "renovate[bot]", email: "1234+renovate[bot]@users.noreply.github.com" };
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1, author: bob });
    writeFile(dir, "a.md", doc("title: t", "two"));
    commit(dir, "edit", {
      authorDate: D2,
      author: ada,
      trailers: ["Co-authored-by: Cy <cy@example.com>"],
    });
    writeFile(dir, "a.md", doc("title: t", "three"));
    commit(dir, "edit again", { authorDate: D3, author: { name: "Bob Again", email: "BOB@example.com" } });
    writeFile(dir, "a.md", doc("title: t", "four"));
    commit(dir, "bump", { authorDate: D4, author: bot });
    // A frontmatter-only edit by a stranger is not a body change.
    writeFile(dir, "a.md", doc("title: t\ntags: [x]", "four"));
    commit(dir, "retag", { authorDate: D4, author: { name: "Dee", email: "dee@example.com" } });

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts.authors).toEqual({
      value: ["Bob", "Ada", "Cy"],
      source: "git",
      evidence: "4 body-changing commits",
    });
  });

  it("reads Reviewed-by trailers on the newest body-changing commit", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "two"));
    const reviewed = commit(dir, "edit", {
      authorDate: D2,
      trailers: [
        "Reviewed-by: Rae <rae@example.com>",
        "Reviewed-by: Sam",
      ],
    });

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts["reviewed-by"]).toEqual({
      value: ["Rae", "Sam"],
      source: "git",
      evidence: `Reviewed-by trailer in ${reviewed.slice(0, 7)}`,
    });
    expect(facts["last-reviewed"]).toEqual({
      value: "2020-02-03",
      source: "git",
      evidence: `Reviewed-by trailer in ${reviewed.slice(0, 7)}`,
    });
  });

  it("unfolds a trailer that wraps onto a continuation line", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    const sha = commit(dir, "add", {
      authorDate: D1,
      trailers: [
        "Co-authored-by: Alice Verylongname\n  <alice@example.com>",
        "Reviewed-by: Bob <bob@example.com>",
      ],
    });

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts.authors).toEqual({
      value: ["Ada", "Alice Verylongname"],
      source: "git",
      evidence: "1 body-changing commit",
    });
    expect(facts["reviewed-by"]).toEqual({
      value: ["Bob"],
      source: "git",
      evidence: `Reviewed-by trailer in ${sha.slice(0, 7)}`,
    });
  });

  it("has no review facts when the newest body commit carries no trailer", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1, trailers: ["Reviewed-by: Rae <rae@example.com>"] });
    writeFile(dir, "a.md", doc("title: t", "two"));
    commit(dir, "edit", { authorDate: D2 });

    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts["reviewed-by"]).toBeNull();
    expect(facts["last-reviewed"]).toBeNull();
  });

  it("survives CRLF line endings and a BOM", async () => {
    const crlf = (s: string): string => s.replace(/\n/g, "\r\n");
    const dir = tempRepo({
      "a.md": `${BOM}${crlf(doc("created: 1999-09-09\nlast-updated: 2001-01-01", "one"))}`,
    });
    const sha = commit(dir, "add", { authorDate: D1 });
    // The file is untouched, so its working body equals HEAD's body whatever
    // core.autocrlf did to the blob.
    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts.created).toEqual({
      value: "1999-09-09",
      source: "git",
      evidence: `stamped in ${sha.slice(0, 7)}`,
    });
    expect(facts["last-updated"]).toEqual({
      value: "2001-01-01",
      source: "git",
      evidence: `stamped in ${sha.slice(0, 7)}`,
    });
    expect(facts.lastBodyCommit).toBe(sha);
  });

  it("refuses a shallow clone and names the fix", async () => {
    const origin = tempRepo({ "a.md": doc("title: t", "one") });
    commit(origin, "add", { authorDate: D1 });
    writeFile(origin, "a.md", doc("title: t", "two"));
    commit(origin, "edit", { authorDate: D2 });
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "docmeta-shallow-")));
    dirs.push(parent);
    git(parent, ["clone", "-q", "--depth", "1", pathToFileURL(origin).href, "clone"]);
    const clone = join(parent, "clone");

    const result = await deriveFromGit([input(clone, "a.md")], opts(clone));
    expect(result.status.available).toBe(false);
    expect(result.status.reason).toContain("fetch-depth: 0");
    expect(result.status.reason).toContain(clone);
    expect(result.records.size).toBe(0);
  });

  it("is unavailable when one repository cannot answer, even if another can", async () => {
    // A partially answered walk would omit the shallow root's documents and
    // report green for the run: the false green the channel refuses.
    const good = tempRepo({ "a.md": doc("title: t", "one") });
    commit(good, "add", { authorDate: D1 });
    const origin = tempRepo({ "b.md": doc("title: t", "one") });
    commit(origin, "add", { authorDate: D1 });
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "docmeta-shallow-")));
    dirs.push(parent);
    git(parent, ["clone", "-q", "--depth", "1", pathToFileURL(origin).href, "clone"]);
    const clone = join(parent, "clone");

    const result = await deriveFromGit(
      [input(good, "a.md"), input(clone, "b.md")],
      opts(good),
    );
    expect(result.status.available).toBe(false);
    expect(result.status.reason).toContain("fetch-depth: 0");
    expect(result.status.reason).toContain(clone);
    expect(result.records.size).toBe(0);
  });

  it("is unavailable when git's output exceeds the read cap", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });

    const result = await deriveFromGit([input(dir, "a.md")], {
      ...opts(dir),
      maxOutputBytes: 64,
    });
    expect(result.status).toEqual({
      available: false,
      reason: `git history is too large to read in one pass (${dir})`,
    });
    expect(result.records.size).toBe(0);
  });

  it("is unavailable when no repository contains the documents", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") }, false);
    const result = await deriveFromGit([input(dir, "a.md")], opts(dir));
    expect(result.status).toEqual({
      available: false,
      reason: "no git repository contains the documents",
    });
    expect(result.records.size).toBe(0);
  });

  it("answers for the documents in a repository and omits the rest", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    const outside = tempRepo({ "b.md": doc("title: t", "one") }, false);

    const result = await deriveFromGit(
      [input(dir, "a.md"), input(outside, "b.md")],
      opts(dir),
    );
    expect(result.status).toEqual({ available: true });
    expect([...result.records.keys()]).toEqual(["a.md"]);
  });
});

describe("bodyOf", () => {
  it("drops a YAML fence and its block", () => {
    expect(bodyOf("---\ntitle: t\n---\n\n# t\n", true)).toBe("\n# t\n");
  });

  it("drops a TOML fence and its block", () => {
    expect(bodyOf("+++\ntitle = 't'\n+++\nbody\n", true)).toBe("body\n");
  });

  it("returns unfenced content whole", () => {
    expect(bodyOf("# t\n\nbody\n", undefined)).toBe("# t\n\nbody\n");
    expect(bodyOf("# t\n", false)).toBe("# t\n");
  });

  it("returns empty content as is", () => {
    expect(bodyOf("", true)).toBe("");
    expect(bodyOf("", undefined)).toBe("");
  });

  it("keeps a BOM ahead of the block, since it is outside it", () => {
    expect(bodyOf(`${BOM}---\r\ntitle: t\r\n---\r\nbody\r\n`, true)).toBe(
      `${BOM}body\r\n`,
    );
  });
});
