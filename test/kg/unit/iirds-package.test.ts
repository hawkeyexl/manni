import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  projectPackage,
  type IirdsPackageOptions,
} from "../../../src/kg/core/iirds-package.js";
import type { Quad } from "../../../src/kg/core/derive.js";
import { emitTurtle } from "../../../src/kg/core/emit.js";
import { DockgError } from "../../../src/kg/types.js";
import { NS, RDF_TYPE } from "../../../src/kg/core/vocab.js";
import {
  IIRDS_HAS_TOPIC_TYPE,
  IIRDS_IIRDS_VERSION,
  IIRDS_IS_PART_OF_PACKAGE,
  IIRDS_PACKAGE,
  IIRDS_PRODUCT_VARIANT,
  IIRDS_RENDITION,
  IIRDS_SOURCE,
  IIRDS_TITLE,
  IIRDS_TOPIC,
  VCARD_ORGANIZATION_NAME,
} from "../../../src/kg/core/iirds.js";

const BASE = "https://ex.com/kg/";
const DOC = `${BASE}doc/docs/a.md`;
const PKG = `${BASE}package`;

const TTL = `
@prefix dockg: <${NS.dockg}> .
@prefix dcterms: <${NS.dcterms}> .
@prefix iirds: <${NS.iirds}> .
<${DOC}> a dockg:Document ;
  dcterms:title "A" ;
  dcterms:language "en" ;
  dockg:path "docs/a.md" ;
  iirds:has-topic-type iirds:GenericTask ;
  iirds:relates-to-product-variant <${BASE}product/widget> .
<${BASE}product/widget> a iirds:ProductVariant ;
  dcterms:title "Widget" .
`;

function storeOf(ttl: string): Store {
  return new Store(new Parser().parse(ttl));
}

/** A cwd containing the corpus source file the projection expects. */
function cwdWithDoc(): string {
  const dir = mkdtempSync(join(tmpdir(), "dockg-pkg-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "a.md"), "# A\n");
  return dir;
}

function has(quads: Quad[], s: string, p: string, o: string): boolean {
  return quads.some((q) => q.s === s && q.p === p && q.o.value === o);
}

const OPTS: IirdsPackageOptions = { baseIri: BASE, version: "1.3" };

describe("projectPackage", () => {
  it("emits a Package with exactly one iiRDSVersion and a title", () => {
    const { quads } = projectPackage(storeOf(TTL), OPTS, cwdWithDoc());
    expect(has(quads, PKG, RDF_TYPE, IIRDS_PACKAGE)).toBe(true);
    const versions = quads.filter(
      (q) => q.s === PKG && q.p === IIRDS_IIRDS_VERSION,
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]!.o.value).toBe("1.3");
    expect(has(quads, PKG, IIRDS_TITLE, "dockg export")).toBe(true);
  });

  it("re-types each Document as an iirds:Topic linked to the package", () => {
    const { quads } = projectPackage(storeOf(TTL), OPTS, cwdWithDoc());
    expect(has(quads, DOC, RDF_TYPE, IIRDS_TOPIC)).toBe(true);
    expect(has(quads, DOC, IIRDS_IS_PART_OF_PACKAGE, PKG)).toBe(true);
    expect(has(quads, DOC, IIRDS_TITLE, "A")).toBe(true);
    // The dockg-internal Document type is NOT carried into the projection.
    expect(has(quads, DOC, RDF_TYPE, `${NS.dockg}Document`)).toBe(false);
  });

  it("exposes each source file as a Rendition and lists the content file", () => {
    const cwd = cwdWithDoc();
    const { quads, contentFiles } = projectPackage(storeOf(TTL), OPTS, cwd);
    const rendition = `${DOC}/rendition`;
    expect(has(quads, rendition, RDF_TYPE, IIRDS_RENDITION)).toBe(true);
    expect(has(quads, rendition, IIRDS_SOURCE, "content/docs/a.md")).toBe(true);
    expect(has(quads, rendition, `${NS.iirds}format`, "text/markdown")).toBe(
      true,
    );
    expect(contentFiles).toEqual([
      { zipPath: "content/docs/a.md", absPath: join(cwd, "docs", "a.md") },
    ]);
  });

  it("carries the Phase-2 classification and the ProductVariant node", () => {
    const { quads } = projectPackage(storeOf(TTL), OPTS, cwdWithDoc());
    expect(
      has(quads, DOC, IIRDS_HAS_TOPIC_TYPE, `${NS.iirds}GenericTask`),
    ).toBe(true);
    const variant = `${BASE}product/widget`;
    expect(has(quads, variant, RDF_TYPE, IIRDS_PRODUCT_VARIANT)).toBe(true);
    expect(has(quads, variant, `${NS.dcterms}title`, "Widget")).toBe(true);
  });

  it("adds a Creator Party + vcard org when a creator is configured", () => {
    const { quads } = projectPackage(
      storeOf(TTL),
      { ...OPTS, creator: "Acme Corp" },
      cwdWithDoc(),
    );
    expect(
      has(quads, `${BASE}party/creator`, RDF_TYPE, `${NS.iirds}Party`),
    ).toBe(true);
    expect(
      has(quads, `${BASE}vcard/creator`, VCARD_ORGANIZATION_NAME, "Acme Corp"),
    ).toBe(true);
    expect(
      has(quads, PKG, `${NS.iirds}relates-to-party`, `${BASE}party/creator`),
    ).toBe(true);
  });

  it("warns (not throws) for a Document with no dockg:path and emits no rendition", () => {
    const ttl = `
@prefix dockg: <${NS.dockg}> .
@prefix dcterms: <${NS.dcterms}> .
<${BASE}doc/docs/b.md> a dockg:Document ;
  dcterms:title "B" .
`;
    const { quads, contentFiles, warnings } = projectPackage(
      storeOf(ttl),
      OPTS,
      cwdWithDoc(),
    );
    expect(warnings.some((w) => w.includes("no dockg:path"))).toBe(true);
    expect(contentFiles).toEqual([]);
    const doc = `${BASE}doc/docs/b.md`;
    expect(
      quads.some((q) => q.s === doc && q.p === `${NS.iirds}has-rendition`),
    ).toBe(false);
  });

  it("throws DockgError when a Document's source file is missing", () => {
    const emptyCwd = mkdtempSync(join(tmpdir(), "dockg-pkg-empty-"));
    expect(() => projectPackage(storeOf(TTL), OPTS, emptyCwd)).toThrow(
      DockgError,
    );
  });

  it("produces quads that round-trip through the Turtle emitter + n3 parser", () => {
    const { quads } = projectPackage(storeOf(TTL), OPTS, cwdWithDoc());
    const ttl = emitTurtle(quads);
    const reparsed = new Parser().parse(ttl);
    expect(reparsed.length).toBe(quads.length);
  });
});
