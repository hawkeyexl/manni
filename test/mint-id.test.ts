/**
 * Minting a page's id (proposal 0126): the frozen-slug rule, the scan of
 * every id a directory's readers carry, and the three reasons a writer
 * mints nothing and leaves the value in the page.
 *
 * The fixtures are under `test/fixtures/external-metadata-dir/`:
 *  - `mint`: two collections reading `metadata/`, with pages for each slug
 *    case. `other.md` carries id `carried`, and `metadata/taken.yaml` exists.
 *  - `mint-stay`: a Docusaurus page, an agent-skills page and an AsciiDoc
 *    page with no fenced front matter.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunConfig } from "../src/meta/core/config.js";
import { keyHome, relocationContext, type RelocationContext } from "../src/meta/core/relocation.js";
import { frozenSlug, mintId, slugBase, type MintRequest } from "../src/meta/core/mint-id.js";
import { Validator } from "../src/meta/core/validator.js";
import { schemaLoadOptions } from "../src/meta/core/schema-registry.js";
import type { CollectionConfig } from "../src/shared/collections.js";

const here = dirname(fileURLToPath(import.meta.url));
const at = (name: string): string => resolve(here, "fixtures", "external-metadata-dir", name);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway copy of a fixture, with no metadata directory. */
function withoutDirectory(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `manni-mint-${name}-`));
  temps.push(dir);
  cpSync(at(name), dir, { recursive: true });
  rmSync(join(dir, "metadata"), { recursive: true, force: true });
  return dir;
}

async function contextOf(dir: string): Promise<RelocationContext> {
  const run = await resolveRunConfig({ cwd: dir, inputs: [] });
  return relocationContext(run, {
    cwd: dir,
    targets: [],
    validator: new Validator(schemaLoadOptions({ root: dir, fileBase: dir })),
  });
}

/** A mint of `label` through the directory every collection of `ctx` reads. */
function request(ctx: RelocationContext, label: string): MintRequest {
  return {
    label,
    pattern: "metadata/{id}.yaml",
    configDir: ctx.configDir ?? ctx.cwd,
    readers: ctx.declaredCollections,
    collections: ctx.declaredCollections,
  };
}

const collection = (name: string, paths: string[]): CollectionConfig => ({
  name,
  paths,
  exclude: [],
  externalMetadata: [],
  declaresExternalMetadata: false,
});

describe("the frozen slug", () => {
  it("measures a page from the literal prefix of the entry that claims it", () => {
    const site = [collection("site", ["docs/src/content/docs/**/*.{md,mdx}"])];
    const rel = "docs/src/content/docs/docevals/adopt/index.mdx";
    expect(slugBase(site, rel)).toBe("docs/src/content/docs");
    expect(frozenSlug(rel, slugBase(site, rel))).toBe("docevals-adopt");
  });

  it("names a base's own index by the base's last segment, and the config directory's by index", () => {
    expect(frozenSlug("docs/index.md", "docs")).toBe("docs");
    expect(frozenSlug("index.md", "")).toBe("index");
    expect(frozenSlug("docs/guides/index.md", "docs")).toBe("guides");
  });

  it("lowercases, turns each other run into one dash, and trims", () => {
    expect(frozenSlug("docs/guides/Getting_Started.md", "docs")).toBe("guides-getting-started");
    expect(frozenSlug("docs/--A  b--.md", "docs")).toBe("a-b");
  });

  it("is page when nothing is left", () => {
    expect(frozenSlug("docs/___.md", "docs")).toBe("page");
  });

  it("takes a plain file entry's directory as its base, and a plain directory entry as itself", () => {
    const notes = [collection("notes", ["notes/single.md", "guides"])];
    expect(slugBase(notes, "notes/single.md")).toBe("notes");
    expect(slugBase(notes, "guides/setup.md")).toBe("guides");
  });

  it("reads a brace pattern's literal prefix", () => {
    const strategy = [collection("strategy", ["docs/content-strategy/{audiences,personas,journeys}/*.md"])];
    const rel = "docs/content-strategy/personas/maya.md";
    expect(slugBase(strategy, rel)).toBe("docs/content-strategy");
    expect(frozenSlug(rel, slugBase(strategy, rel))).toBe("personas-maya");
  });

  it("uses the first collection that claims the page, and the config directory for default", () => {
    const two = [collection("narrow", ["docs/api/*.md"]), collection("wide", ["docs/**/*.md"])];
    expect(slugBase(two, "docs/api/auth.md")).toBe("docs/api");
    expect(slugBase([collection("default", ["docs/**"])], "docs/api/auth.md")).toBe("");
  });
});

describe("mintId", () => {
  const minted = async (ctx: RelocationContext, label: string): Promise<string | undefined> => {
    const outcome = await mintId(ctx, request(ctx, label));
    return "minted" in outcome ? outcome.minted : undefined;
  };

  it("mints the slug, and the page's text with the id written in", async () => {
    const ctx = await contextOf(at("mint"));
    expect(await mintId(ctx, request(ctx, "docs/guides/Getting_Started.md"))).toEqual({
      minted: "guides-getting-started",
      text: "---\ntitle: Getting started\nid: guides-getting-started\n---\n\n# Getting started\n",
    });
  });

  it("names the base's index, the plain-file entry and the brace pattern's pages", async () => {
    const ctx = await contextOf(at("mint"));
    expect(await minted(ctx, "docs/index.md")).toBe("docs");
    expect(await minted(ctx, "docs/guides/index.md")).toBe("guides");
    expect(await minted(ctx, "notes/single.md")).toBe("single");
    expect(await minted(ctx, "strategy/personas/maya.md")).toBe("personas-maya");
    expect(await minted(ctx, "docs/___.md")).toBe("page");
  });

  it("steps past an id another page carries, and a file that already exists", async () => {
    const ctx = await contextOf(at("mint"));
    expect(await minted(ctx, "docs/carried.md")).toBe("carried-2");
    expect(await minted(ctx, "docs/taken.md")).toBe("taken-2");
  });

  it("gives two pages one slug in sorted path order, whichever is asked first", async () => {
    const ctx = await contextOf(at("mint"));
    expect(await minted(ctx, "docs/a_b.md")).toBe("a-b-2");
    expect(await minted(ctx, "docs/a-b.md")).toBe("a-b");
    const again = await contextOf(at("mint"));
    expect(await minted(again, "docs/a-b.md")).toBe("a-b");
  });

  it("mints nothing for a page whose schema gives id a meaning of its own", async () => {
    const ctx = await contextOf(at("mint-stay"));
    expect(await mintId(ctx, request(ctx, "docs/docusaurus.md"))).toEqual({
      stay: "docusaurus:docs:3.10 gives id a meaning of its own; set one by hand",
    });
  });

  it("mints nothing for a page whose schemas do not allow id", async () => {
    const ctx = await contextOf(at("mint-stay"));
    expect(await mintId(ctx, request(ctx, "docs/skill/SKILL.md"))).toEqual({ stay: "its schemas do not allow id" });
  });

  // Neither page is on disk, so the scan holds no slug for either.
  it("leaves a page that stays no slug to push a later page past", async () => {
    const ctx = await contextOf(at("mint-stay"));
    const stayed = await mintId(ctx, request(ctx, "docs/ghost.adoc"));
    expect("stay" in stayed && stayed.stay).toMatch(/^the page cannot be written: /);
    expect(await minted(ctx, "docs/ghost.md")).toBe("ghost");
  });

  it("mints nothing for a page its format's writer cannot write", async () => {
    const ctx = await contextOf(at("mint-stay"));
    expect(await mintId(ctx, request(ctx, "docs/native.adoc"))).toEqual({
      stay:
        "the page cannot be written: This asciidoc document has no fenced front matter block; manni can only write fenced front matter for asciidoc. Add a fenced block, or set the field manually",
    });
  });
});

describe("keyHome on the metadata directory", () => {
  it("names the page's own file when it carries an id", async () => {
    const ctx = await contextOf(at("mint-stay"));
    expect(await keyHome(ctx, "docs/plain.md", { id: "plain" }, "personas")).toEqual({
      kind: "manifest",
      collection: "site",
      file: "metadata/plain.yaml",
      absPath: join(at("mint-stay"), "metadata", "plain.yaml"),
      join: "id",
      entry: "plain",
      perPage: true,
      perId: true,
    });
  });

  it("mints an id for a page with none, and names the file it will name", async () => {
    const ctx = await contextOf(at("mint"));
    const home = await keyHome(ctx, "docs/guides/Getting_Started.md", { title: "Getting started" }, "personas");
    expect(home).toMatchObject({
      kind: "manifest",
      file: "metadata/guides-getting-started.yaml",
      entry: "guides-getting-started",
      mint: { id: "guides-getting-started" },
    });
  });

  it("stays, with the reason, where no id can be minted", async () => {
    const ctx = await contextOf(at("mint-stay"));
    expect(await keyHome(ctx, "docs/docusaurus.md", { title: "Docusaurus" }, "personas")).toEqual({
      kind: "stay",
      collection: "site",
      file: "metadata/{id}.yaml",
      reason: "docusaurus:docs:3.10 gives id a meaning of its own; set one by hand",
    });
  });

  it("stays, too, where the directory it would create cannot name the page", async () => {
    const ctx = await contextOf(withoutDirectory("mint-stay"));
    // A key the directory would not own is the page's, as it always was.
    expect(await keyHome(ctx, "docs/docusaurus.md", { title: "Docusaurus" }, "title")).toMatchObject({
      kind: "unowned",
    });
    expect(await keyHome(ctx, "docs/docusaurus.md", { title: "Docusaurus" }, "personas")).toEqual({
      kind: "stay",
      collection: "site",
      file: "metadata/{id}.yaml",
      reason: "docusaurus:docs:3.10 gives id a meaning of its own; set one by hand",
    });
  });

  it("refuses an id that cannot name a file, and one held encrypted", async () => {
    const ctx = await contextOf(at("mint-stay"));
    await expect(keyHome(ctx, "docs/plain.md", { id: "Getting_Started" }, "personas")).rejects.toThrow(
      'docs/plain.md: id "Getting_Started" cannot name a file in metadata/; an id that names a manifest is lowercase letters, digits and "-", starting with a letter or digit.',
    );
    await expect(keyHome(ctx, "docs/plain.md", { id: `~${"A".repeat(90)}` }, "personas")).rejects.toThrow(
      "docs/plain.md: id is encrypted, so it cannot name a file in metadata/; store it plain.",
    );
  });
});
