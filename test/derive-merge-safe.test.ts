/**
 * Proposal 0069: merge-safe stamps by default.
 *
 * Two halves. The default field set: a `derive:` block with no `fields`
 * manages `owner`, `created`, `last-updated` and `provenance`, and on each
 * page only the ones its schemas claim. And two evidence rules, each proved
 * by replaying a squash merge the way a host performs one: one commit on the
 * base with the branch tip's tree, a different author, a later date, and the
 * co-author trailers the host appends. A stamp written on the branch reads
 * current after that commit, except the one hole the last-updated suite pins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveFailed, runDerive } from "../src/meta/commands/derive.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { DERIVED_STALE_SCHEMA } from "../src/meta/core/derive/types.js";
import { DocmetaError, type FieldError } from "../src/meta/types.js";
import { hashLines } from "../src/shared/pin.js";
import { resetWarnings } from "../src/shared/warn.js";
import {
  commit,
  git,
  makeTempRepo,
  removeTempRepo,
  replaySquash,
  writeFile,
} from "./helpers/temp-repo.js";

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures", "merge-safe");

const D1 = "2026-08-20T10:00:00+00:00";
const D2 = "2026-09-01T10:00:00+00:00";
const D3 = "2026-09-05T10:00:00+00:00";

/** What a host appends to a squash of a branch Claude co-authored. */
const SQUASH_TRAILERS = [
  "Co-authored-by: Someone <s@example.com>",
  "Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>",
];

const dirs: string[] = [];
beforeEach(() => {
  resetWarnings();
  // W1 and W2 go to stderr: the stewardship schema prefers owner in a manifest.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

function tempRepo(files: Record<string, string> = {}): string {
  const dir = makeTempRepo({ files });
  dirs.push(dir);
  return dir;
}

function stageFixture(): string {
  const dir = tempRepo();
  cpSync(FIXTURE, dir, { recursive: true });
  commit(dir, "add docs", { authorDate: D1 });
  return dir;
}

/** Replace the `derive:` block of the fixture's config. */
function setDerive(dir: string, block: string): void {
  const at = join(dir, "manni.config.yaml");
  const text = readFileSync(at, "utf8");
  writeFileSync(at, text.replace(/ {2}derive:\n(?: {4}.*\n)*/, block), "utf8");
}

/** Every `derived:stale` finding of a validate run, as `file: subject`. */
async function staleOf(dir: string, inputs: string[] = []): Promise<string[]> {
  const { results } = await runValidate({ inputs, cwd: dir });
  return results.flatMap((r) =>
    r.errors
      .filter((e: FieldError) => e.schema === DERIVED_STALE_SCHEMA)
      .map((e) => `${r.file}: ${e.subject ?? e.instancePath}`),
  );
}

describe("the merge-safe default (0069)", () => {
  it("manages on each page only the merge-safe fields its schemas claim", async () => {
    const dir = stageFixture();
    const run = await runDerive({ inputs: [], cwd: dir, dryRun: true });

    const fieldsOf = (file: string): string[] =>
      run.results.find((r) => r.file === file)?.fields.map((f) => f.field) ?? ["(no result)"];
    // Stewardship claims owner, created and last-updated, and not provenance.
    expect(fieldsOf("docs/steward/guide.md")).toEqual(["owner", "created", "last-updated"]);
    expect(fieldsOf("docs/plain/note.md")).toEqual([]);
  });

  it("validate compares the per-page default set, and nothing on a page that claims none", async () => {
    const dir = stageFixture();
    expect(await staleOf(dir)).toEqual([
      "docs/steward/guide.md: owner",
      "docs/steward/guide.md: created",
      "docs/steward/guide.md: last-updated",
    ]);
  });

  it("fields: [] manages nothing, and derive says there is nothing to derive", async () => {
    const dir = stageFixture();
    setDerive(dir, "  derive:\n    fields: []\n    sources: [git, codeowners]\n");
    expect(await staleOf(dir)).toEqual([]);
    await expect(runDerive({ inputs: [], cwd: dir })).rejects.toThrow(
      new DocmetaError("nothing to derive: set derive.fields in manni.config.yaml or pass --fields"),
    );
  });

  it("written fields are managed exactly as written, claimed or not", async () => {
    const dir = stageFixture();
    setDerive(dir, "  derive:\n    fields: [owner]\n    sources: [codeowners]\n");
    expect(await staleOf(dir)).toEqual([
      "docs/plain/note.md: owner",
      "docs/steward/guide.md: owner",
    ]);
  });

  it("exits 2 when no page's schemas claim a merge-safe field", async () => {
    const dir = stageFixture();
    await expect(runDerive({ inputs: ["docs/plain/note.md"], cwd: dir })).rejects.toThrow(
      new DocmetaError(
        "nothing to derive: no page's schemas claim a merge-safe field (owner, created, last-updated, provenance); set derive.fields or pass --fields",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// The evidence rules, across a replayed squash

/** Start a repository on its base branch and return the branch's name. */
function base(dir: string): string {
  commit(dir, "init", { authorDate: D1 });
  return git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

const PERMISSIVE = '{ "type": "object" }\n';

describe("rule 1: decision 2 reads the owning manifest (0069)", () => {
  it("keeps a keyless {page}.meta.yaml's created current after a squash dated days later", async () => {
    const dir = tempRepo({
      "manni.config.yaml": [
        "collections:",
        "  - name: site",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        '      - file: "{page}.meta.yaml"',
        "meta:",
        '  schemas: ["manni:stewardship:1.0.0"]',
        "  derive:",
        "    fields: [created, last-updated]",
        "    sources: [git]",
        "",
      ].join("\n"),
      "README.md": "base\n",
    });
    const main = base(dir);
    git(dir, ["checkout", "-q", "-b", "feature"]);
    // Stewardship marks created external and last-updated page.
    writeFile(dir, "docs/guide.md", "---\ntitle: Guide\nlast-updated: 2026-09-01\n---\n\n# Guide\n\nBody.\n");
    writeFile(dir, "docs/guide.meta.yaml", "docs/guide.md:\n  created: 2026-09-01\n");
    commit(dir, "add the guide", { authorDate: D2 });
    expect(await staleOf(dir)).toEqual([]);

    replaySquash(dir, { branch: "feature", onto: main, authorDate: D3, trailers: SQUASH_TRAILERS });
    expect(await staleOf(dir)).toEqual([]);
    expect(deriveFailed(await runDerive({ inputs: [], cwd: dir, check: true }))).toBe(false);
  });

  it("keeps an explicit manifest's created and last-updated current after a squash", async () => {
    const dir = tempRepo({
      "manni.config.yaml": [
        "collections:",
        "  - name: site",
        '    paths: ["docs/**/*.md"]',
        "    externalMetadata:",
        "      - file: ./site-meta.yaml",
        "        keys: [created, last-updated]",
        "meta:",
        "  schemas: [./permissive.schema.json]",
        "  derive:",
        "    fields: [created, last-updated]",
        "    sources: [git]",
        "",
      ].join("\n"),
      "permissive.schema.json": PERMISSIVE,
      "docs/guide.md": "---\ntitle: Guide\n---\n\n# Guide\n\nOne.\n",
      // Written before the page landed here: the content is older than its path.
      "site-meta.yaml": "docs/guide.md:\n  created: 2026-08-01\n  last-updated: 2026-08-01\n",
    });
    const main = base(dir);
    git(dir, ["checkout", "-q", "-b", "feature"]);
    writeFile(dir, "docs/guide.md", "---\ntitle: Guide\n---\n\n# Guide\n\nTwo.\n");
    writeFile(dir, "site-meta.yaml", "docs/guide.md:\n  created: 2026-08-01\n  last-updated: 2026-09-01\n");
    commit(dir, "edit the guide", { authorDate: D2 });
    expect(await staleOf(dir)).toEqual([]);

    replaySquash(dir, { branch: "feature", onto: main, authorDate: D3, trailers: SQUASH_TRAILERS });
    expect(await staleOf(dir)).toEqual([]);
    expect(deriveFailed(await runDerive({ inputs: [], cwd: dir, check: true }))).toBe(false);
  });
});

describe("a kept stamp across a squash: the known hole (0069)", () => {
  const config = [
    "collections:",
    "  - name: site",
    '    paths: ["docs/**/*.md"]',
    "meta:",
    "  schemas: [./permissive.schema.json]",
    "  derive:",
    "    fields: [last-updated]",
    "    sources: [git]",
    "",
  ].join("\n");
  const page = (stamp: string, body: string): string =>
    `---\ntitle: Guide\nlast-updated: ${stamp}\n---\n\n# Guide\n\n${body}\n`;

  it("reads stale once on the base when an edit kept that day's stamp and merged a day later", async () => {
    const dir = tempRepo({
      "manni.config.yaml": config,
      "permissive.schema.json": PERMISSIVE,
      "docs/guide.md": page("2026-08-20", "One."),
    });
    const main = base(dir);
    git(dir, ["checkout", "-q", "-b", "feature"]);
    // The same day: the stamp is already today's, so the edit leaves it be.
    writeFile(dir, "docs/guide.md", page("2026-08-20", "Two."));
    commit(dir, "edit the guide", { authorDate: "2026-08-20T15:00:00+00:00" });
    expect(await staleOf(dir)).toEqual([]);

    replaySquash(dir, {
      branch: "feature",
      onto: main,
      authorDate: "2026-08-21T09:00:00+00:00",
      trailers: SQUASH_TRAILERS,
    });
    // The squash changed the body and kept the stamp. Git alone cannot tell
    // that from an edit whose author forgot to restamp, so a kept stamp never
    // vouches (0040 decision 2), and the squash's own date stands.
    expect(await staleOf(dir)).toEqual(["docs/guide.md: last-updated"]);

    // Running derive on the base clears it.
    await runDerive({ inputs: [], cwd: dir });
    expect(await staleOf(dir)).toEqual([]);
  });
});

describe("rule 3: a stamped commit is the whole account of its lines (0069)", () => {
  const FABLE = "claude-fable-5";
  const pin = (...lines: string[]): string => hashLines(lines.join("\n"));
  const page = (fm: string, lines: string[]): string =>
    `---\ntitle: Guide\n${fm}---\n\n# Guide\n\n${lines.join("\n")}\n`;

  it("keeps a human line human when the squash appends a machine trailer", async () => {
    const dir = tempRepo({
      "manni.config.yaml": [
        "collections:",
        "  - name: site",
        '    paths: ["docs/**/*.md"]',
        "meta:",
        "  schemas: [./permissive.schema.json]",
        "  derive:",
        "    fields: [provenance]",
        "    sources: [git]",
        '    machines: ["*[bot]", "noreply@anthropic.com"]',
        "",
      ].join("\n"),
      "permissive.schema.json": PERMISSIVE,
      "docs/guide.md": page("", ["one", "two", "three"]),
    });
    const main = base(dir);
    git(dir, ["checkout", "-q", "-b", "feature"]);

    // Body lines: 1 blank, 2 heading, 3 blank, then 4, 5, 6.
    const stamp =
      `provenance:\n  - generated-by: ${FABLE}\n    lines: 4\n    integrity: ${pin("ONE, by a machine")}\n`;
    writeFile(dir, "docs/guide.md", page(stamp, ["ONE, by a machine", "two", "three"]));
    commit(dir, "machine edit", {
      authorDate: D2,
      trailers: ["Co-authored-by: Claude Opus 5.5 <noreply@anthropic.com>"],
    });
    writeFile(dir, "docs/guide.md", page(stamp, ["ONE, by a machine", "two", "THREE, by a person"]));
    commit(dir, "human edit", { authorDate: D2 });
    expect(await staleOf(dir)).toEqual([]);

    replaySquash(dir, { branch: "feature", onto: main, authorDate: D3, trailers: SQUASH_TRAILERS });
    expect(await staleOf(dir)).toEqual([]);
    const check = await runDerive({ inputs: [], cwd: dir, check: true });
    expect(deriveFailed(check)).toBe(false);
  });
});
