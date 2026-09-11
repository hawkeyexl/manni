/**
 * The validate+checks path resolves every file's schema set exactly once.
 *
 * `validate`'s per-file loop resolves each file. Building the corpus checks'
 * collection views must add nothing to that count: under proposal 0041 rule 7
 * a view holds the collection's *members* — path arithmetic against the config
 * directory — so the read path resolves no schemas at all, which is 0021's
 * founding rule that 0027's resolution-winner membership had to bend. The
 * counter seam wraps `resolveSchemaSetWithSource`, the one function resolution
 * goes through, and the parity cases pin what that means where 0027 was
 * observable: a document `$schema` neither removes a file from a view nor
 * explains itself on stderr, and a `$schema` the trust settings refuse is a
 * finding about that file and nothing more.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const counter = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../src/meta/core/resolve-schema.js", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../src/meta/core/resolve-schema.js")>();
  return {
    ...mod,
    resolveSchemaSetWithSource: (
      ...args: Parameters<typeof mod.resolveSchemaSetWithSource>
    ) => {
      counter.calls += 1;
      return mod.resolveSchemaSetWithSource(...args);
    },
  };
});

import { runValidate } from "../src/meta/commands/validate.js";
import { runQuery } from "../src/meta/commands/query.js";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "fixtures", "collections");

const CHECK = `  checks:
    - name: dangling-author
      query: >-
        SELECT d._path AS path, 'author' AS key,
               'no author page for "' || d.author || '"' AS message
        FROM docs d LEFT JOIN authors a ON a.slug = d.author
        WHERE d.author IS NOT NULL AND a._path IS NULL
`;

/** A second check, whose only job is to report what the `authors` view holds. */
const MEMBERS_CHECK = `    - name: in-authors
      query: >-
        SELECT a._path AS path, 'slug' AS key, 'a member of authors' AS message
        FROM authors a
`;

const tempDirs: string[] = [];
function corpusWithChecks(extraConfig = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "docmeta-resolution-walk-"));
  tempDirs.push(dir);
  cpSync(corpus, dir, { recursive: true });
  const config = join(dir, "manni.config.yaml");
  writeFileSync(config, `${readFileSync(config, "utf8")}${CHECK}${extraConfig}`);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  counter.calls = 0;
});

describe("validate+checks: one resolution walk (not two)", () => {
  it("resolves each file exactly once when checks build collection views", async () => {
    const dir = corpusWithChecks();
    const run = await runValidate({ inputs: [], cwd: dir });
    expect(run.results.length).toBeGreaterThan(0);
    // One call per file, from the per-file loop alone: the view build resolves
    // nothing. A membership walk that resolved would double this.
    expect(counter.calls).toBe(run.results.length);
    // ...and the check still fired over the views it needed.
    const guide = run.results.find((r) => r.file === "docs/guide.md");
    expect(guide?.errors.some((e) => e.schema === "check:dangling-author")).toBe(
      true,
    );
  });

  it("a document $schema keeps its collection membership, and says nothing", async () => {
    // 0027's stress test 1 removed authors/self.md from the `authors` view,
    // because its own `$schema` outranked the override, and printed a notice
    // saying so. Membership does not consult resolution, so the file is an
    // ordinary member and there is nothing to explain.
    const dir = corpusWithChecks(MEMBERS_CHECK);
    const notices: string[] = [];
    const run = await runValidate({
      inputs: [],
      cwd: dir,
      onNotice: (m) => notices.push(m),
    });
    const self = run.results.find((r) => r.file === "authors/self.md");
    expect(self?.errors.some((e) => e.schema === "check:in-authors")).toBe(true);
    expect(notices.find((m) => m.includes("authors/self.md"))).toBeUndefined();
    expect(counter.calls).toBe(run.results.length);
  });

  it("query DDL under -s resolves the CLI set once, never per file (0030)", async () => {
    // The -s set goes through the same resolver as every other CLI-ref
    // surface — its cli branch, called exactly once for the run. The pin is
    // "not O(files)": a per-entry walk under -s would defeat the flag's
    // whole point (the walk's disagreement is what -s exists to bypass).
    const dir = mkdtempSync(join(tmpdir(), "docmeta-resolution-walk-"));
    tempDirs.push(dir);
    cpSync(resolve(here, "fixtures", "query-schema-flag"), dir, {
      recursive: true,
    });
    counter.calls = 0;
    const run = await runQuery({
      sql: "ALTER TABLE docs ADD COLUMN reviewed TEXT",
      inputs: ["docs"],
      cwd: dir,
      dryRun: true,
      schemas: ["./schemas/house.json"],
    });
    expect(run.changes?.some((c) => "schema" in c)).toBe(true);
    expect(counter.calls).toBe(1);
  });

  it("a file whose resolution failed is still a member, and not re-resolved", async () => {
    // 0027 demoted it to "member of no view", because a refused `$schema`
    // meant there was no winning override to put it in one. The refusal is
    // still that file's finding, and now it is nothing else: membership never
    // asked the resolver.
    const dir = corpusWithChecks(
      `${MEMBERS_CHECK}  schemaTrust:\n    documentRefs: local\n`,
    );
    writeFileSync(
      join(dir, "authors", "url.md"),
      "---\n$schema: https://schemas.example.com/x.json\ntitle: URL\nslug: url\n---\nBody.\n",
    );
    const run = await runValidate({ inputs: [], cwd: dir });
    // The refusal is that file's own schema finding...
    const refused = run.results.find((r) => r.file === "authors/url.md");
    expect(refused?.ok).toBe(false);
    expect(refused?.errors[0]?.keyword).toBe("schema");
    // ...and it is in the `authors` view all the same.
    expect(refused?.errors.some((e) => e.schema === "check:in-authors")).toBe(
      true,
    );
    // ...the checks still ran over the rest of the corpus...
    const guide = run.results.find((r) => r.file === "docs/guide.md");
    expect(guide?.errors.some((e) => e.schema === "check:dangling-author")).toBe(
      true,
    );
    // ...and nothing resolved any file a second time.
    expect(counter.calls).toBe(run.results.length);
  });
});
