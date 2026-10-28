/**
 * A Flare topic's glossary term references reach the graph (proposal 0125,
 * decision 19). meta's HTML reader turns each `MadCap:glossaryTerm` into an
 * entry of the page field `concepts`, and derive already files a page under
 * its `concepts` as `dcterms:subject`.
 */
import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { deriveGraph } from "../../../src/graph/core/derive.js";
import { NS } from "../../../src/graph/core/vocab.js";

const BASE = "https://example.com/graph/";

describe("Flare glossary term references", () => {
  it("files a topic under the concept its glossaryTerm marker names", async () => {
    const path = "Content/Build.htm";
    const content = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="http://www.madcapsoftware.com/Schemas/MadCap.xsd">\n<head><title>Build</title></head>\n<body><h1>Build</h1><p>Build the <MadCap:glossaryTerm glossTerm="Glossary.Term15">batch target</MadCap:glossaryTerm> first.</p></body>\n</html>\n`;
    const doc = await analyzeDoc(content, path, new Set([path]));
    const quads = deriveGraph([doc], { baseIri: BASE, derive: ["frontmatter", "tags"] });
    const subjects = quads
      .filter((q) => q.s === `${BASE}doc/${path}` && q.p === `${NS.dcterms}subject`)
      .map((q) => q.o.value);
    // With no termbase, the glossTerm id is minted as a freeform concept, slugged: `Glossary.Term15` is `glossaryterm15`.
    expect(subjects).toEqual([`${BASE}concept/glossaryterm15`]);
  });
});
