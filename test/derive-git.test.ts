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
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { hashLines } from "../src/shared/pin.js";
import {
  commit,
  git,
  makeTempRepo,
  removeTempRepo,
  writeFile,
} from "./helpers/temp-repo.js";

// Every case here spawns git, the built bin, or a fake CLI, and a Windows
// runner under load takes longer than vitest's 5 s default for a single
// spawn chain. The whole file gets the budget the bin-spawning suites use.
vi.setConfig({ testTimeout: 60_000 });

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

  it("refuses a shallow clone and names the fix", { timeout: 60_000 }, async () => {
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

  it("is unavailable when one repository cannot answer, even if another can", { timeout: 60_000 }, async () => {
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

/**
 * `provenance` from blame (proposal 0046). Blame runs only when the field is
 * requested, and each case below reads the evidence rules through the git
 * source's own I/O: blame, the trailers of the commits it names, and the
 * page (or manifest) blob at each of them.
 */
describe.each(forms)("deriveFromGit provenance ($name)", ({ opts }) => {
  const FABLE = "claude-fable-5";
  const SONNET = "claude-sonnet-5";
  const pin = (...lines: string[]): string => hashLines(lines.join("\n"));
  const withProvenance = (dir: string, extra: Partial<GitSourceOptions> = {}): GitSourceOptions => ({
    ...opts(dir),
    fields: ["provenance"],
    ...extra,
  });

  it("derives nothing, and runs no blame, when provenance is not requested", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1, trailers: [`Generated-by: ${SONNET}`] });
    const facts = await factsFor(dir, "a.md", opts(dir));
    expect(facts.provenance).toBeNull();
  });

  it("attributes uncommitted body lines to --generated-by (rule 1)", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one\ntwo\nthree") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "one\nTWO\nthree"));

    const facts = await factsFor(dir, "a.md", withProvenance(dir, { generatedBy: FABLE }));
    expect(facts.provenance).toEqual({
      value: [{ "generated-by": FABLE, lines: 3, integrity: pin("TWO") }],
      source: "git",
      evidence: "uncommitted",
    });
    // Without a name, an uncommitted line has no evidence at all.
    expect((await factsFor(dir, "a.md", withProvenance(dir))).provenance).toBeNull();
  });

  it("attributes every line of a file with no history yet", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "b.md", doc("title: t", "x\ny"));
    const facts = await factsFor(dir, "b.md", withProvenance(dir, { generatedBy: FABLE }));
    expect(facts.provenance?.value).toEqual([
      { "generated-by": FABLE, lines: "1-3", integrity: pin("", "x", "y") },
    ]);
  });

  it("reads a Generated-by trailer on the commit that wrote the lines (rule 3)", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one\ntwo") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "one\nTWO"));
    const sha = commit(dir, "edit", { authorDate: D2, trailers: [`generated-by: ${SONNET}`] });

    const facts = await factsFor(dir, "a.md", withProvenance(dir));
    expect(facts.provenance).toEqual({
      value: [{ "generated-by": SONNET, lines: 3, integrity: pin("TWO") }],
      source: "git",
      evidence: `blame ${sha.slice(0, 7)}`,
    });
  });

  it("counts the commits behind the ranges in the evidence", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one\ntwo\nthree") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "ONE\ntwo\nthree"));
    const first = commit(dir, "edit", { authorDate: D2, trailers: [`Generated-by: ${SONNET}`] });
    writeFile(dir, "a.md", doc("title: t", "ONE\ntwo\nTHREE"));
    commit(dir, "edit again", { authorDate: D3, trailers: [`Generated-by: ${FABLE}`] });

    const facts = await factsFor(dir, "a.md", withProvenance(dir));
    expect(facts.provenance?.value).toEqual([
      { "generated-by": SONNET, lines: 2, integrity: pin("ONE") },
      { "generated-by": FABLE, lines: 4, integrity: pin("THREE") },
    ]);
    expect(facts.provenance?.evidence).toBe(`blame ${first.slice(0, 7)}, 2 commits`);
  });

  it("names a Co-authored-by machine only when derive.machines matches it (rule 4), and leaves it out of authors", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "ONE"));
    commit(dir, "edit", {
      authorDate: D2,
      trailers: ["Co-authored-by: Claude Opus 5 <noreply@anthropic.com>"],
    });

    const machines = ["*[bot]", "noreply@anthropic.com"];
    const matched = await factsFor(dir, "a.md", withProvenance(dir, { machines }));
    expect(matched.provenance?.value).toEqual([
      { "generated-by": "Claude Opus 5", lines: 2, integrity: pin("ONE") },
    ]);
    expect(matched.authors?.value).toEqual(["Ada"]);

    // The default is 0040's `[bot]` suffix: the same trailer is a person.
    const unmatched = await factsFor(dir, "a.md", withProvenance(dir));
    expect(unmatched.provenance).toBeNull();
    expect(unmatched.authors?.value).toEqual(["Ada", "Claude Opus 5"]);
  });

  it("reads the stamp a squash commit carried (rule 2, stress test 10)", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one\ntwo\nthree") });
    commit(dir, "add", { authorDate: D1 });
    const main = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    git(dir, ["checkout", "-q", "-b", "agent"]);

    // The agent's edit and its stamp, committed together on the branch.
    writeFile(dir, "a.md", doc("title: t", "one\nTWO\nTHREE"));
    const stamped = await factsFor(dir, "a.md", withProvenance(dir, { generatedBy: FABLE }));
    const value = stamped.provenance?.value;
    expect(value).toEqual([{ "generated-by": FABLE, lines: "3-4", integrity: pin("TWO", "THREE") }]);
    const page = readFileSync(join(dir, "a.md"), "utf8");
    writeFile(dir, "a.md", markdownExtractor.apply?.(page, { provenance: value }) ?? page);
    commit(dir, "agent edit", { authorDate: D2, author: { name: "Agent", email: "agent@example.com" } });

    git(dir, ["checkout", "-q", main]);
    git(dir, ["merge", "--squash", "agent"]);
    const squash = commit(dir, "squash", { authorDate: D3, author: { name: "Merger", email: "m@example.com" } });

    const facts = await factsFor(dir, "a.md", withProvenance(dir));
    expect(facts.provenance).toEqual({
      value,
      source: "git",
      evidence: `blame ${squash.slice(0, 7)}`,
    });
  });

  it("reads the stamp from a manifest's blob at the commit when the record lives there", async () => {
    const dir = tempRepo({
      "a.md": doc("title: t", "one\ntwo"),
      "private/provenance.yaml": "# records\n",
    });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "one\nTWO"));
    writeFile(
      dir,
      "private/provenance.yaml",
      `a.md:\n  provenance:\n    - generated-by: ${FABLE}\n      lines: 3\n      integrity: ${pin("TWO")}\n`,
    );
    const sha = commit(dir, "agent edit", { authorDate: D2 });

    const manifest = { absPath: join(dir, "private", "provenance.yaml"), entry: "a.md", join: "path" };
    const result = await deriveFromGit(
      [{ ...input(dir, "a.md"), provenanceManifest: manifest }],
      withProvenance(dir),
    );
    expect(result.status).toEqual({ available: true });
    expect(result.records.get("a.md")?.provenance).toEqual({
      value: [{ "generated-by": FABLE, lines: 3, integrity: pin("TWO") }],
      source: "git",
      evidence: `blame ${sha.slice(0, 7)}`,
    });
    // The page's own frontmatter is not read when a manifest holds the record.
    const onPage = await factsFor(dir, "a.md", withProvenance(dir));
    expect(onPage.provenance).toBeNull();
  });

  it("reads a manifest stamp written under the page's path before a rename", async () => {
    const stampOf = (key: string): string =>
      `${key}:\n  provenance:\n    - generated-by: ${FABLE}\n      lines: 3\n      integrity: ${pin("TWO")}\n`;
    // Two manifests, one keyed from the repository root and one from `docs/`,
    // so the key at each commit is re-expressed from where the config sits.
    const dir = tempRepo({
      "docs/old.md": doc("title: t", "one\ntwo"),
      "private/provenance.yaml": "# records\n",
      "docs/provenance.yaml": "# records\n",
    });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "docs/old.md", doc("title: t", "one\nTWO"));
    writeFile(dir, "private/provenance.yaml", stampOf("docs/old.md"));
    writeFile(dir, "docs/provenance.yaml", stampOf("old.md"));
    const sha = commit(dir, "agent edit", { authorDate: D2 });
    git(dir, ["mv", "docs/old.md", "docs/new.md"]);
    writeFile(dir, "private/provenance.yaml", stampOf("docs/new.md"));
    writeFile(dir, "docs/provenance.yaml", stampOf("new.md"));
    commit(dir, "rename", { authorDate: D3 });
    // The record is dropped: only history can say who wrote line 3 now.
    writeFile(dir, "private/provenance.yaml", "# records\n");
    writeFile(dir, "docs/provenance.yaml", "# records\n");

    const refs = [
      { absPath: join(dir, "private", "provenance.yaml"), entry: "docs/new.md", join: "path" },
      { absPath: join(dir, "docs", "provenance.yaml"), entry: "new.md", join: "path" },
    ];
    for (const manifest of refs) {
      const result = await deriveFromGit(
        [{ ...input(dir, "docs/new.md"), provenanceManifest: manifest }],
        withProvenance(dir),
      );
      expect(result.status).toEqual({ available: true });
      expect(result.records.get("docs/new.md")?.provenance).toEqual({
        value: [{ "generated-by": FABLE, lines: 3, integrity: pin("TWO") }],
        source: "git",
        evidence: `blame ${sha.slice(0, 7)}`,
      });
    }
  });

  it("attributes every line of a file deleted from history and recreated uncommitted", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one"), "docs/b.md": doc("title: t", "old") });
    commit(dir, "add", { authorDate: D1 });
    git(dir, ["rm", "-q", "docs/b.md"]);
    commit(dir, "delete", { authorDate: D2 });
    writeFile(dir, "docs/b.md", doc("title: t", "x"));

    const result = await deriveFromGit(
      [input(dir, "a.md"), input(dir, "docs/b.md")],
      withProvenance(dir, { generatedBy: FABLE }),
    );
    expect(result.status).toEqual({ available: true });
    expect(result.records.get("docs/b.md")?.provenance?.value).toEqual([
      { "generated-by": FABLE, lines: "1-2", integrity: pin("", "x") },
    ]);
    // The other page keeps its facts.
    expect(result.records.get("a.md")?.created?.value).toBe("2020-01-02");
  });

  it("ignores a blame.ignoreRevsFile setting, so attribution does not depend on the machine", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    writeFile(dir, "a.md", doc("title: t", "ONE"));
    const sha = commit(dir, "edit", { authorDate: D2, trailers: [`Generated-by: ${SONNET}`] });
    // Named but absent, as a global setting reads in a repository without the file.
    git(dir, ["config", "blame.ignoreRevsFile", ".git-blame-ignore-revs"]);

    const facts = await factsFor(dir, "a.md", withProvenance(dir));
    expect(facts.provenance).toEqual({
      value: [{ "generated-by": SONNET, lines: 2, integrity: pin("ONE") }],
      source: "git",
      evidence: `blame ${sha.slice(0, 7)}`,
    });
  });

  it("names git's own complaint when blame fails on a committed file", async () => {
    const dir = tempRepo({ "a.md": doc("title: t", "one") });
    commit(dir, "add", { authorDate: D1 });
    git(dir, ["config", "blame.date", "bogus"]);

    const result = await deriveFromGit([input(dir, "a.md")], withProvenance(dir));
    expect(result.status.available).toBe(false);
    expect(result.status.reason).toContain("git blame could not read a.md");
    expect(result.status.reason).toContain("unknown date format bogus");
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
