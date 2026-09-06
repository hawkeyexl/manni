import { describe, expect, it } from "vitest";
import { GraphIndex } from "../../../src/kg/runtime/graph.js";
import {
  createFetchResolver,
  documentPreamble,
  documentSectionOrder,
  sectionOccurrence,
  sectionOwnText,
  sliceSection,
  splitFragment,
} from "../../../src/kg/runtime/resolve.js";
import { assemble } from "../../../src/kg/runtime/assemble.js";
import { createTrace } from "../../../src/kg/runtime/trace.js";
import { NS } from "../../../src/kg/core/vocab.js";

const BASE = "https://ex.com/kg/";
const DOC = `${BASE}doc/docs/a.md`;
const SECTION = `${DOC}#install`;

const MARKDOWN = `# Title

Intro prose.

## Install

Install steps here.

## Other

Not this one.
`;

function fixture(): GraphIndex {
  return GraphIndex.fromQuads([
    {
      s: DOC,
      p: `${NS.dockg}path`,
      o: { kind: "literal", value: "docs/a.md" },
    },
    { s: DOC, p: `${NS.dcterms}title`, o: { kind: "literal", value: "Title" } },
    {
      s: SECTION,
      p: `${NS.dcterms}title`,
      o: { kind: "literal", value: "Install" },
    },
    {
      s: SECTION,
      p: `${NS.dockg}level`,
      o: { kind: "literal", value: "2", datatype: `${NS.xsd}integer` },
    },
  ]);
}

/** A fetch stub serving one document. */
function stubFetch(body: string | undefined, calls: string[] = []) {
  return (url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      text: () => Promise.resolve(body ?? ""),
    });
  };
}

describe("splitFragment", () => {
  it("separates a section IRI from its document", () => {
    expect(splitFragment(SECTION)).toEqual({ doc: DOC, fragment: "install" });
    expect(splitFragment(DOC)).toEqual({ doc: DOC });
  });
});

describe("sliceSection", () => {
  it("slices from the matching heading to the next same-or-higher heading", () => {
    expect(sliceSection(MARKDOWN, "Install", 2)).toBe(
      "## Install\n\nInstall steps here.",
    );
  });

  it("runs to end-of-document for the last section", () => {
    expect(sliceSection(MARKDOWN, "Other", 2)).toBe(
      "## Other\n\nNot this one.",
    );
  });

  it("handles CRLF sources", () => {
    const crlf = MARKDOWN.replace(/\n/g, "\r\n");
    expect(sliceSection(crlf, "Install", 2)).toBe(
      "## Install\n\nInstall steps here.",
    );
  });

  it("returns undefined when the heading is absent or at another level", () => {
    expect(sliceSection(MARKDOWN, "Nope", 2)).toBeUndefined();
    expect(sliceSection(MARKDOWN, "Install", 3)).toBeUndefined();
  });

  it("does not end a section at a # line inside a fenced code block", () => {
    // A shell comment in a code sample is not an h1. Reading it as one used to
    // truncate the section to its first two lines.
    const md = [
      "# Doc",
      "",
      "## Install",
      "",
      "```bash",
      "# Set the API key",
      "export KEY=abc",
      "```",
      "",
      "Prose after the fence.",
      "",
      "## Other",
      "",
      "tail",
    ].join("\n");
    expect(sliceSection(md, "Install", 2)).toBe(
      [
        "## Install",
        "",
        "```bash",
        "# Set the API key",
        "export KEY=abc",
        "```",
        "",
        "Prose after the fence.",
      ].join("\n"),
    );
  });

  it("ignores a heading-shaped line inside a tilde fence too", () => {
    const md = [
      "## Install",
      "",
      "~~~",
      "## Not a heading",
      "~~~",
      "",
      "Still inside Install.",
    ].join("\n");
    expect(sliceSection(md, "Install", 2)).toContain("Still inside Install.");
  });

  it("still ends the section at a real heading after a closed fence", () => {
    const md = [
      "## Install",
      "",
      "```",
      "# comment",
      "```",
      "",
      "## Other",
      "",
      "tail",
    ].join("\n");
    expect(sliceSection(md, "Install", 2)).toBe(
      ["## Install", "", "```", "# comment", "```"].join("\n"),
    );
  });
});

describe("sectionOwnText", () => {
  const NESTED = [
    "# Top",
    "",
    "Top prose.",
    "",
    "## Child",
    "",
    "Child prose.",
    "",
    "### Grandchild",
    "",
    "Grandchild prose.",
  ].join("\n");

  it("stops at the next heading of any rank", () => {
    expect(sectionOwnText(NESTED, "Top", 1)).toBe("# Top\n\nTop prose.");
    expect(sectionOwnText(NESTED, "Child", 2)).toBe("## Child\n\nChild prose.");
  });

  it("differs from sliceSection, which keeps the subtree", () => {
    // Retrieval wants the subtree; indexing wants own text, or a parent
    // matches everything its children match and outranks them.
    const sliced = sliceSection(NESTED, "Top", 1)!;
    expect(sliced).toContain("Grandchild prose.");
    expect(sectionOwnText(NESTED, "Top", 1)).not.toContain("Grandchild prose.");
  });

  it("returns just the heading for a section whose body is all subsections", () => {
    const md = "## Options\n\n### Advanced\n\nDeep.";
    expect(sectionOwnText(md, "Options", 2)).toBe("## Options");
  });

  it("honors occurrence and fenced code like sliceSection", () => {
    const md = [
      "## A",
      "",
      "```",
      "# not a heading",
      "```",
      "",
      "## A",
      "",
      "second",
    ].join("\n");
    expect(sectionOwnText(md, "A", 2, 0)).toContain("# not a heading");
    expect(sectionOwnText(md, "A", 2, 1)).toBe("## A\n\nsecond");
  });
});

describe("documentPreamble", () => {
  it("returns the prose before the first heading", () => {
    expect(documentPreamble("Intro text.\n\n# Title\n\nBody.\n")).toBe(
      "Intro text.",
    );
  });

  it("returns undefined when the document opens with a heading", () => {
    expect(documentPreamble(MARKDOWN)).toBeUndefined();
    expect(documentPreamble("")).toBeUndefined();
    expect(documentPreamble("\n\n   \n")).toBeUndefined();
  });

  it("returns the whole document when it has no heading at all", () => {
    expect(documentPreamble("Just prose.\n\nMore prose.\n")).toBe(
      "Just prose.\n\nMore prose.",
    );
  });

  it("does not end the preamble at a # inside a fenced block", () => {
    const md = [
      "```bash",
      "# not a heading",
      "```",
      "",
      "Still preamble.",
      "",
      "# Real",
    ].join("\n");
    const out = documentPreamble(md);
    expect(out).toContain("Still preamble.");
    expect(out).not.toContain("# Real");
  });
});

describe("repeated headings", () => {
  const DUP_MD = [
    "# Doc",
    "",
    "## Install",
    "",
    "First install.",
    "",
    "## Install",
    "",
    "Second install.",
  ].join("\n");

  const DUP_DOC = `${BASE}doc/docs/dup.md`;
  const SEC_1 = `${DUP_DOC}#install`;
  const SEC_2 = `${DUP_DOC}#install-1`;
  const ROOT = `${DUP_DOC}#doc`;

  /** Doc → root section → two same-titled children, ordered by dockg:order. */
  function dupGraph(secondTitle = "Install"): GraphIndex {
    const lit2 = (v: string) => ({
      kind: "literal" as const,
      value: v,
      datatype: `${NS.xsd}integer`,
    });
    return GraphIndex.fromQuads([
      {
        s: DUP_DOC,
        p: `${NS.dockg}path`,
        o: { kind: "literal", value: "docs/dup.md" },
      },
      {
        s: DUP_DOC,
        p: `${NS.dcterms}hasPart`,
        o: { kind: "iri", value: ROOT },
      },
      {
        s: ROOT,
        p: `${NS.dcterms}title`,
        o: { kind: "literal", value: "Doc" },
      },
      { s: ROOT, p: `${NS.dockg}level`, o: lit2("1") },
      { s: ROOT, p: `${NS.dockg}order`, o: lit2("1") },
      { s: ROOT, p: `${NS.dcterms}hasPart`, o: { kind: "iri", value: SEC_1 } },
      { s: ROOT, p: `${NS.dcterms}hasPart`, o: { kind: "iri", value: SEC_2 } },
      {
        s: SEC_1,
        p: `${NS.dcterms}title`,
        o: { kind: "literal", value: "Install" },
      },
      { s: SEC_1, p: `${NS.dockg}level`, o: lit2("2") },
      { s: SEC_1, p: `${NS.dockg}order`, o: lit2("1") },
      {
        s: SEC_2,
        p: `${NS.dcterms}title`,
        o: { kind: "literal", value: secondTitle },
      },
      { s: SEC_2, p: `${NS.dockg}level`, o: lit2("2") },
      { s: SEC_2, p: `${NS.dockg}order`, o: lit2("2") },
    ]);
  }

  it("selects the nth heading via the occurrence argument", () => {
    expect(sliceSection(DUP_MD, "Install", 2, 0)).toContain("First install.");
    expect(sliceSection(DUP_MD, "Install", 2, 1)).toContain("Second install.");
    expect(sliceSection(DUP_MD, "Install", 2, 2)).toBeUndefined();
  });

  it("derives each section's occurrence from document order", () => {
    const g = dupGraph();
    expect(sectionOccurrence(g, SEC_1)).toBe(0);
    expect(sectionOccurrence(g, SEC_2)).toBe(1);
  });

  it("resolves duplicate-titled sections to their own text, not the first", () => {
    const g = dupGraph();
    const r = createFetchResolver(g, { fetch: stubFetch(DUP_MD) });
    return Promise.all([r.resolve(SEC_1), r.resolve(SEC_2)]).then(
      ([first, second]) => {
        expect(first?.text).toContain("First install.");
        // Without the occurrence fix this returned "First install." too —
        // wrong content under a confident citation.
        expect(second?.text).toContain("Second install.");
      },
    );
  });

  it("counts occurrences the way sliceSection matches — case-folded", () => {
    // `## Install` then `## install`. `sliceSection` matches headings
    // case-insensitively, so counting by the raw title gave both sections
    // occurrence 0, and the second one then sliced the *first* heading.
    const g = dupGraph("install");
    expect(sectionOccurrence(g, SEC_2)).toBe(1);
    const md = DUP_MD.replace("## Install\n\nSecond", "## install\n\nSecond");
    expect(
      sliceSection(md, "install", 2, sectionOccurrence(g, SEC_2)),
    ).toContain("Second install.");
  });

  it("orders sections depth-first by dockg:order", () => {
    expect(documentSectionOrder(dupGraph(), DUP_DOC)).toEqual([
      ROOT,
      SEC_1,
      SEC_2,
    ]);
  });
});

describe("createFetchResolver", () => {
  it("resolves a document to its full text via baseUrl", async () => {
    const calls: string[] = [];
    const r = createFetchResolver(fixture(), {
      baseUrl: "https://site/raw/",
      fetch: stubFetch(MARKDOWN, calls),
    });
    const out = await r.resolve(DOC);
    expect(out?.text).toBe(MARKDOWN);
    expect(out?.sourceUrl).toBe("https://site/raw/docs/a.md");
    expect(calls).toEqual(["https://site/raw/docs/a.md"]);
  });

  it("resolves a section to its slice of the parent document", async () => {
    const r = createFetchResolver(fixture(), {
      baseUrl: "https://site/raw/",
      fetch: stubFetch(MARKDOWN),
    });
    const out = await r.resolve(SECTION);
    expect(out?.text).toBe("## Install\n\nInstall steps here.");
    expect(out?.title).toBe("Install");
  });

  it("fetches each document only once across resolutions", async () => {
    const calls: string[] = [];
    const r = createFetchResolver(fixture(), {
      baseUrl: "https://site/raw/",
      fetch: stubFetch(MARKDOWN, calls),
    });
    await r.resolve(DOC);
    await r.resolve(SECTION);
    expect(calls).toHaveLength(1);
  });

  it("honors a custom pathToUrl", async () => {
    const calls: string[] = [];
    const r = createFetchResolver(fixture(), {
      pathToUrl: (p) => `https://cdn/${p.replace(/\.md$/, "")}.txt`,
      fetch: stubFetch(MARKDOWN, calls),
    });
    await r.resolve(DOC);
    expect(calls).toEqual(["https://cdn/docs/a.txt"]);
  });

  it("returns undefined for a node with no content, without fetching", async () => {
    const calls: string[] = [];
    const r = createFetchResolver(fixture(), {
      fetch: stubFetch(MARKDOWN, calls),
    });
    expect(await r.resolve(`${BASE}concept/x`)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("records failed fetches in the trace and resolves to undefined", async () => {
    const trace = createTrace();
    const r = createFetchResolver(fixture(), {
      baseUrl: "https://site/raw/",
      fetch: stubFetch(undefined),
      trace,
    });
    expect(await r.resolve(DOC)).toBeUndefined();
    expect(trace.resolutions).toEqual([
      {
        iri: DOC,
        sourceUrl: "https://site/raw/docs/a.md",
        ok: false,
        error: "fetch failed",
      },
    ]);
  });

  it("records a missing section heading in the trace", async () => {
    const trace = createTrace();
    const r = createFetchResolver(fixture(), {
      baseUrl: "https://site/raw/",
      fetch: stubFetch("# Title\n\nNo install heading here.\n"),
      trace,
    });
    expect(await r.resolve(SECTION)).toBeUndefined();
    expect(trace.resolutions[0]?.error).toBe("section heading not found");
  });
});

describe("assemble", () => {
  const resolver = (texts: Record<string, string>) => ({
    resolve: (iri: string) =>
      Promise.resolve(
        texts[iri]
          ? { iri, text: texts[iri], sourceUrl: `url:${iri}`, title: iri }
          : undefined,
      ),
  });

  it("builds context blocks and a matching citation manifest", async () => {
    const bundle = await assemble(
      resolver({ [DOC]: "alpha", [SECTION]: "beta" }),
      [
        { iri: DOC, depth: 0 },
        { iri: SECTION, depth: 1 },
      ],
    );
    expect(bundle.context.map((b) => b.text)).toEqual(["alpha", "beta"]);
    expect(bundle.context.map((b) => b.depth)).toEqual([0, 1]);
    expect(bundle.citations.map((c) => c.iri)).toEqual([DOC, SECTION]);
    expect(bundle.refusal).toBeUndefined();
    expect(bundle.truncated).toBe(false);
  });

  it("carries the entry rankings alongside the graph results", async () => {
    // Retrieval answers two questions — what matched, and what the graph is
    // connected to — and a caller needs both, not one plus a trace to mine.
    const entry = {
      lexical: [{ iri: DOC, score: 2, via: "lexical" as const }],
      vector: [{ iri: SECTION, score: 0.9, via: "vector" as const }],
      merged: [{ iri: DOC, score: 0.03, via: "hybrid" as const }],
    };
    const bundle = await assemble(
      resolver({ [DOC]: "alpha" }),
      [{ iri: DOC, depth: 0 }],
      { entry },
    );
    expect(bundle.entry).toEqual(entry);
    expect(bundle.context.map((b) => b.iri)).toEqual([DOC]);
  });

  it("carries the entry rankings even when it refuses", async () => {
    // A caller still wants to show what matched, and see that nothing survived
    // the graph walk.
    const entry = {
      lexical: [{ iri: DOC, score: 2, via: "lexical" as const }],
      vector: [],
      merged: [{ iri: DOC, score: 0.016, via: "lexical" as const }],
    };
    const bundle = await assemble(resolver({}), [], { entry });
    expect(bundle.refusal?.reason).toBe("no-route");
    expect(bundle.entry).toEqual(entry);
  });

  it("omits entry entirely when seeds were explicit", async () => {
    const bundle = await assemble(resolver({ [DOC]: "alpha" }), [
      { iri: DOC, depth: 0 },
    ]);
    expect("entry" in bundle).toBe(false);
  });

  it("refuses with no-route when traversal returned nothing", async () => {
    const bundle = await assemble(resolver({}), []);
    expect(bundle.refusal?.reason).toBe("no-route");
    expect(bundle.context).toEqual([]);
    expect(bundle.citations).toEqual([]);
  });

  it("refuses with no-content when nothing resolves to text", async () => {
    const bundle = await assemble(resolver({}), [{ iri: DOC, depth: 0 }]);
    expect(bundle.refusal?.reason).toBe("no-content");
    expect(bundle.refusal?.detail).toContain("none of them resolved");
  });

  it("drops blocks over the character budget and flags truncation", async () => {
    const bundle = await assemble(
      resolver({ [DOC]: "12345", [SECTION]: "67890" }),
      [
        { iri: DOC, depth: 0 },
        { iri: SECTION, depth: 1 },
      ],
      { maxChars: 5 },
    );
    expect(bundle.context.map((b) => b.iri)).toEqual([DOC]);
    expect(bundle.truncated).toBe(true);
  });
});
