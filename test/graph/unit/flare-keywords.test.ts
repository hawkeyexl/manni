/**
 * A Flare topic's index markers reach the graph (proposal 0125, decision 16).
 * meta's HTML reader turns them into the page field `keywords`, and derive
 * already files a page under its `keywords` as `dcterms:subject`.
 */
import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { deriveGraph } from "../../../src/graph/core/derive.js";
import { NS } from "../../../src/graph/core/vocab.js";

const BASE = "https://example.com/graph/";

describe("Flare index keywords", () => {
  it("files a topic under its keyword and concept markers", async () => {
    const path = "Content/Install.htm";
    const content = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="http://www.madcapsoftware.com/Schemas/MadCap.xsd">\n<head><title>Install</title></head>\n<body><h1>Install</h1><p>Run it <MadCap:keyword term="install;setup" /> now.</p><MadCap:concept term="Setup" /></body>\n</html>\n`;
    const doc = await analyzeDoc(content, path, new Set([path]));
    const quads = deriveGraph([doc], { baseIri: BASE, derive: ["frontmatter", "tags"] });
    const subjects = quads
      .filter((q) => q.s === `${BASE}doc/${path}` && q.p === `${NS.dcterms}subject`)
      .map((q) => q.o.value);
    expect(subjects).toEqual(
      expect.arrayContaining([`${BASE}concept/install`, `${BASE}concept/setup`]),
    );
  });
});
