/**
 * A Flare topic in its project (proposal 0125, decisions 10, 12 and 17): a
 * link target naming a variable is the path it resolves to, a `/Content/` or
 * `/Project/` link resolves against the project root with no `routes:` entry,
 * and the project's `xml:lang` is the language of last resort.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeDoc, metadataOf } from "../../../src/graph/core/analyze.js";
import { ALL_DERIVE_SOURCES, type RouteMapping } from "../../../src/graph/core/config.js";
import { deriveGraph } from "../../../src/graph/core/derive.js";
import { parseContexts } from "../../../src/graph/core/discover.js";
import { NS } from "../../../src/graph/core/vocab.js";
import type { DocModel } from "../../../src/graph/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const PROJECT = join(import.meta.dirname, "..", "fixtures", "flare-project");
const INSTALL = "Content/Topics/Install.htm";
const SETUP = "Content/Topics/Setup.htm";
const NOTE = "Content/Resources/Snippets/Note.flsnp";
const ALL = new Set([INSTALL, SETUP, NOTE]);
const read = (label: string): string => readFileSync(join(PROJECT, label), "utf8");
const context = () => parseContexts({ tools: {} }, PROJECT);

beforeEach(() => {
  resetWarnings();
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const linksOf = (model: DocModel) =>
  model.links.map((l) => ({ raw: l.raw, kind: l.kind, ...(l.resolvedPath ? { to: l.resolvedPath } : {}) }));

describe("links in a Flare project", () => {
  it("resolves a variable target and a root-absolute target, internal or broken", async () => {
    const model = await analyzeDoc(read(INSTALL), INSTALL, ALL, { context: context() });
    expect(linksOf(model)).toEqual([
      { raw: "../Resources/Snippets/Note.flsnp", kind: "internal", to: NOTE },
      { raw: "Setup.htm", kind: "internal", to: SETUP },
      { raw: "Gone.htm", kind: "broken" },
      { raw: "/Content/Topics/Setup.htm", kind: "internal", to: SETUP },
      { raw: "/Content/Missing.htm", kind: "broken" },
    ]);
  });

  it("resolves a root-absolute link from a page in the project root's own folder", async () => {
    const label = "Root.htm";
    const model = await analyzeDoc(read(INSTALL), label, new Set([...ALL, label]), { context: context() });
    expect(linksOf(model)).toContainEqual({ raw: "/Content/Topics/Setup.htm", kind: "internal", to: SETUP });
  });

  it("skips a root-absolute link with no context, as any unmapped route", async () => {
    const model = await analyzeDoc(read(INSTALL), INSTALL, ALL);
    expect(linksOf(model).map((l) => l.raw)).toEqual(["../Resources/Snippets/Note.flsnp"]);
  });

  it("leaves a non-Flare page's root-absolute link to the routes", async () => {
    const page = "Content/Topics/notes.md";
    const model = await analyzeDoc("# Notes\n\n[setup](/Content/Topics/Setup.htm)\n", page, new Set([...ALL, page]), {
      context: context(),
    });
    expect(model.links).toEqual([]);
  });

  it("leaves a root-absolute link to the routes when the project root is above the labels", async () => {
    const base = join(PROJECT, "Content");
    const label = "Topics/Install.htm";
    const model = await analyzeDoc(read(INSTALL), label, new Set([label, "Topics/Setup.htm"]), {
      context: parseContexts({ tools: {} }, base),
    });
    expect(model.links.map((l) => l.raw)).not.toContain("/Content/Topics/Setup.htm");
    expect(model.links.map((l) => l.raw)).toContain("Setup.htm");
  });
});

describe("a Flare topic's language", () => {
  const ROUTE: RouteMapping = {
    basePath: "",
    root: "Content",
    extensions: [".htm"],
    indexFiles: [],
    language: "fr",
  };

  async function languages(routes: RouteMapping[] = []): Promise<Record<string, string>> {
    const docs = await Promise.all(
      [INSTALL, SETUP].map((path) => analyzeDoc(read(path), path, ALL, { context: context(), routes })),
    );
    const quads = deriveGraph(docs, { baseIri: "https://ex.com/", derive: ALL_DERIVE_SOURCES });
    return Object.fromEntries(
      quads
        .filter((q) => q.p === `${NS.dcterms}language` && !q.s.includes("#"))
        .map((q) => [q.s.replace("https://ex.com/doc/", ""), q.o.value]),
    );
  }

  it("is the page's own, then the project's xml:lang, canonicalized", async () => {
    const model = await analyzeDoc(read(INSTALL), INSTALL, ALL, { context: context() });
    expect(model.projectLanguage).toBe("en-us");
    expect(await languages()).toEqual({ [INSTALL]: "en-US", [SETUP]: "de" });
  });

  it("takes a route's language over the project's, and the page's over both", async () => {
    expect(await languages([ROUTE])).toEqual({ [INSTALL]: "fr", [SETUP]: "de" });
  });

  it("is absent with no context", async () => {
    const model = await analyzeDoc(read(INSTALL), INSTALL, ALL);
    expect(model).not.toHaveProperty("projectLanguage");
  });
});

describe("a Flare TOC's metadata (0125, decision 17)", () => {
  it("reads none, though its root carries a Version attribute", () => {
    const toc = '<?xml version="1.0" encoding="utf-8"?>\n<CatapultToc Version="1">\n  <TocEntry Title="Start" Link="/Content/Topics/Install.htm" />\n</CatapultToc>\n';
    expect(metadataOf(toc, "Project/TOCs/Main.fltoc", "xml")).toEqual({ data: {}, present: false });
    expect(metadataOf(toc, "Project/TOCs/Tour.flbrs", "xml")).toEqual({ data: {}, present: false });
    // A plain XML file keeps reading its root's attributes, as before.
    expect(metadataOf(toc.replace("CatapultToc", "catalog").replace("CatapultToc", "catalog"), "data/catalog.xml", "xml").present).toBe(true);
  });
});
