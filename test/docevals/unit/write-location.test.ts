/**
 * Where docevals writes each key it owns (proposal 0047, §3 and §4).
 *
 * Reading already follows a key's location (chunk 1). Writing has to follow
 * the same rule or the two disagree: a page whose manifest owns `evals` and
 * whose `fill` appends to its frontmatter now declares them twice, which
 * `meta validate` reports as an `external:owned` collision.
 *
 * The routing table is the claim, one case per row, plus the exact sentence
 * each one says.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { loadConfig } from "../../../src/docevals/core/config.js";
import {
  EvalWriter,
  EVALS_KEY,
  META_PROVENANCE_KEY,
  manifestEvalList,
  prefersExternal,
  updateManifestEval,
  type WriteHome,
} from "../../../src/docevals/core/write-location.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/manifest");
const dir = (name: string): string => resolve(FIXTURES, name);

/** The writer a run over `fixture` builds, for the paths it was given. */
function writerFor(fixture: string, targets: string[] = []): EvalWriter {
  const cwd = dir(fixture);
  return EvalWriter.for(loadConfig(undefined, cwd), cwd, targets);
}

const homeIn = async (
  fixture: string,
  label: string,
  data: Record<string, unknown>,
  key = EVALS_KEY,
): Promise<WriteHome> => writerFor(fixture).homeFor(label, data, key);

describe("the evals draft's own location marks", () => {
  it("marks the three page keys external and nothing else", () => {
    expect(prefersExternal("evals")).toBe(true);
    expect(prefersExternal("eval-suite")).toBe(true);
    expect(prefersExternal("eval-skip")).toBe(true);
    // Not the draft's key at all, so the draft says nothing about it.
    expect(prefersExternal("title")).toBe(false);
  });
});

describe("routing a write", () => {
  it("sends a key a local manifest owns to the page's entry there", async () => {
    const home = await homeIn("write", "docs/install.md", { title: "Install" });
    expect(home.kind).toBe("manifest");
    if (home.kind !== "manifest") return;
    expect(home.file).toBe("site.metadata.yaml");
    expect(home.entry).toBe("docs/install.md");
    expect(home.join).toBe("path");
  });

  it("refuses a page a joined manifest has no entry for, in meta's sentence", async () => {
    const home = await homeIn("join-missing", "docs/no-id.md", { title: "No id" });
    expect(home).toEqual({
      kind: "no-entry",
      message:
        "docs/no-id.md carries no doc-id, which site.metadata.yaml joins on, " +
        "so its evals has no entry there.",
    });
  });

  it("finds the entry when the page carries the join value", async () => {
    const home = await homeIn("join-missing", "docs/install.md", {
      title: "Install",
      "doc-id": "install-page",
    });
    expect(home.kind === "manifest" && home.entry).toBe("install-page");
  });

  it("names the URL manifest that owns an eval key", async () => {
    const home = await homeIn("url", "docs/install.md", { title: "Install" });
    expect(home).toEqual({
      kind: "url",
      collection: "site",
      file: "https://example.invalid/site.metadata.yaml",
    });
  });

  it("refuses a URL-owned eval key in chunk 1's wording", async () => {
    const writer = writerFor("url");
    const home = await writer.homeFor("docs/install.md", {}, EVALS_KEY);
    if (home.kind !== "url") throw new Error("expected a URL home");
    const refusal = writer.urlRefusal(home, EVALS_KEY);
    expect(refusal).toBeInstanceOf(DocevalsError);
    expect(refusal.message).toContain(
      "collection site: evals cannot come from a URL manifest, because docevals writes them.",
    );
  });

  it("leaves the key on the page when no manifest owns it", async () => {
    const writer = writerFor("no-manifest", ["docs"]);
    const home = await writer.homeFor("docs/install.md", { title: "Install" }, EVALS_KEY);
    expect(home.kind).toBe("page");
    if (home.kind !== "page") return;
    expect(home.prefersExternal).toBe(true);
    // Nothing is declared, so relocation would create the collection that
    // gives the key a manifest.
    expect(home.proposed).toMatchObject({
      kind: "collection",
      collection: "default",
      createsCollection: true,
    });
  });

  it("routes meta-provenance to the manifest that owns it", async () => {
    const home = await homeIn(
      "provenance",
      "docs/install.md",
      { title: "Install" },
      META_PROVENANCE_KEY,
    );
    expect(home.kind === "manifest" && home.file).toBe("site.metadata.yaml");
  });

  it("leaves meta-provenance on the page when the manifest owns only evals", async () => {
    const home = await homeIn(
      "join-missing",
      "docs/install.md",
      { title: "Install", "doc-id": "install-page" },
      META_PROVENANCE_KEY,
    );
    expect(home.kind).toBe("page");
  });
});

describe("the warning for evals that stayed on a page", () => {
  it("says it once for the whole collection, with the page count", async () => {
    const writer = writerFor("no-manifest", ["docs"]);
    for (const label of ["docs/a.md", "docs/b.md", "docs/c.md"]) {
      const home = await writer.homeFor(label, {}, EVALS_KEY);
      if (home.kind !== "page") throw new Error("expected a page home");
      writer.stayedOnPage(label, EVALS_KEY, home.proposed);
    }
    expect(writer.warnings(false)).toEqual([
      "wrote evals to 3 pages; the schema prefers external metadata. " +
        "Run manni meta relocate to give it a manifest.",
    ]);
  });

  it("says nothing when no key stayed on a page", () => {
    expect(writerFor("write").warnings(false)).toEqual([]);
  });

  it("speaks in the conditional under a dry run", async () => {
    const writer = writerFor("no-manifest", ["docs"]);
    const home = await writer.homeFor("docs/a.md", {}, EVALS_KEY);
    if (home.kind !== "page") throw new Error("expected a page home");
    writer.stayedOnPage("docs/a.md", EVALS_KEY, home.proposed);
    expect(writer.warnings(true)[0]).toContain("would write evals to 1 page;");
  });
});

describe("a manifest's eval list", () => {
  it("reads an absent list as empty", () => {
    expect(manifestEvalList(undefined, "site.metadata.yaml", "docs/a.md")).toEqual([]);
    expect(manifestEvalList(null, "site.metadata.yaml", "docs/a.md")).toEqual([]);
  });

  it("refuses a string shorthand rather than rewriting it", () => {
    expect(() =>
      manifestEvalList("one assertion", "site.metadata.yaml", "docs/a.md"),
    ).toThrow(/is not a list/);
  });

  it("updates one entry and leaves the rest alone", () => {
    const list = [
      { id: "first", assertion: "A" },
      { id: "second", assertion: "B", grader: "ai" },
    ];
    const next = updateManifestEval(list, "second", {
      grader: "command",
      command: ["node", "check.mjs", "{file}"],
      "generated-assertion-hash": "abc",
    });
    expect(next).toEqual([
      { id: "first", assertion: "A" },
      {
        id: "second",
        assertion: "B",
        grader: "command",
        command: ["node", "check.mjs", "{file}"],
        "generated-assertion-hash": "abc",
      },
    ]);
    // The input is not mutated: the splice writes the returned list.
    expect(list[1]).toEqual({ id: "second", assertion: "B", grader: "ai" });
  });

  it("finds an entry by its use reference too, and reports a miss", () => {
    expect(updateManifestEval([{ use: "shared" }], "shared", { grader: "command" })).toEqual([
      { use: "shared", grader: "command" },
    ]);
    expect(updateManifestEval([{ id: "other" }], "shared", { grader: "command" })).toBeUndefined();
  });
});

describe("a manifest per page", () => {
  it("names the page's own manifest, and marks it per-page", async () => {
    const home = await homeIn("per-page-write", "docs/install.md", { title: "Install" });
    expect(home.kind).toBe("manifest");
    if (home.kind !== "manifest") return;
    expect(home.file).toBe("evals/docs/install.yaml");
    expect(home.entry).toBe("docs/install.md");
    expect(home.join).toBe("path");
    expect(home.perPage).toBe(true);
  });

  it("reads a manifest that does not exist yet as holding nothing", async () => {
    const home = await homeIn("per-page-write", "docs/install.md", { title: "Install" });
    if (home.kind !== "manifest") throw new Error("expected a manifest home");
    expect(await writerFor("per-page-write").readManifest(home, EVALS_KEY)).toBeUndefined();
  });

  it("creates the page's own manifest, directory and all, on the first write", async () => {
    const cwd = mkdtempSync(resolve(tmpdir(), "docevals-per-page-"));
    cpSync(dir("per-page-write"), cwd, { recursive: true });
    const writer = EvalWriter.for(loadConfig(undefined, cwd), cwd, []);
    const home = await writer.homeFor("docs/install.md", { title: "Install" }, EVALS_KEY);
    if (home.kind !== "manifest") throw new Error("expected a manifest home");
    await writer.writeManifest(home, EVALS_KEY, [{ id: "mentions-prerequisites" }]);
    expect(readFileSync(resolve(cwd, "evals/docs/install.yaml"), "utf8")).toContain(
      "mentions-prerequisites",
    );
    rmSync(cwd, { recursive: true, force: true });
  });
});
