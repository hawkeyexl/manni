/**
 * What `term fill` plans before a model is asked: the concepts pages name and
 * the termbase lacks, the out directory and the page format, and how crawl
 * findings merge (proposal 0086 § 3).
 */
import { describe, expect, it } from "vitest";
import {
  FILL_PAGE_FORMATS,
  mergeFound,
  namedConcepts,
  newCandidates,
  pageExtension,
  planFromMetadata,
  sharedTermDirectory,
} from "../../src/term/core/fill-plan.js";
import { TERM_WRITERS } from "../../src/term/core/writers/index.js";
import type { Term, TermBlock, TermReference, TermSet } from "../../src/term/types.js";

function term(label: string, opts: { id?: string; alt?: string[]; definition?: string; path?: string; construct?: "page" | "manifest"; see?: string } = {}): Term {
  return {
    id: opts.id ?? label.toLowerCase(),
    record: {
      label,
      ...(opts.alt === undefined ? {} : { "alt-labels": opts.alt }),
      ...(opts.definition === undefined ? {} : { definition: opts.definition }),
      ...(opts.see === undefined ? {} : { see: opts.see }),
    },
    location: {
      file: opts.path ?? "terms.yaml",
      ...(opts.path === undefined ? {} : { path: opts.path }),
      construct: opts.construct ?? "page",
      line: 1,
      fieldLines: {},
    },
  };
}

function set(terms: Term[], references: TermReference[], blocks: TermBlock[] = []): TermSet {
  return { terms, references, blocks, notices: [] };
}

describe("namedConcepts", () => {
  const retryBlock: TermBlock = {
    file: "a.md",
    line: 4,
    language: "en",
    label: "Retry",
    altLabels: ["Retries"],
    edges: [
      { field: "broader", value: "Errors", line: 8 },
      { field: "related-concepts", value: "Backoff", line: 9 },
    ],
  };

  it("merges references and block edge values by label ignoring case, a block enriching what they name", () => {
    const concepts = namedConcepts({
      blocks: [retryBlock],
      references: [
        { file: "b.md", line: 3, label: "Retry", language: "fr" },
        { file: "b.md", line: 3, label: "retries" },
        { file: "c.md", label: "errors" },
      ],
    });
    expect(concepts.map((c) => c.label)).toEqual(["Retry", "errors", "Backoff"]);
    const retry = concepts[0];
    expect(retry?.altLabels).toEqual(["Retries"]);
    expect(retry?.broader).toEqual(["Errors"]);
    expect(retry?.related).toEqual(["Backoff"]);
    // The naming page's language, never the block's own.
    expect(retry?.language).toBe("fr");
    expect(retry?.from).toEqual([{ file: "b.md", line: 3 }]);
    expect(concepts[1]?.from).toEqual([{ file: "c.md" }, { file: "a.md", line: 8 }]);
    expect(concepts[2]?.language).toBe("en");
  });

  it("never makes a concept of a block's own label", () => {
    const concepts = namedConcepts({ blocks: [retryBlock], references: [] });
    expect(concepts.map((c) => c.label)).toEqual(["Errors", "Backoff"]);
  });

  it("carries a block's definition to the concept it labels", () => {
    const [backoff] = namedConcepts({
      blocks: [{ file: "a.md", label: "Backoff", definition: "Waiting longer.", edges: [] }],
      references: [{ file: "b.md", label: "backoff" }],
    });
    expect(backoff?.definition).toBe("Waiting longer.");
  });
});

describe("planFromMetadata", () => {
  it("creates only what no label, id or alt-label resolves", () => {
    const plan = planFromMetadata(
      set(
        [term("Timeout", { alt: ["Time-out"], definition: "Waiting." }), term("Jitter", { id: "jit" })],
        [
          { file: "a.md", label: "TIME-OUT" },
          { file: "a.md", label: "jit" },
          { file: "a.md", label: "timeout" },
          { file: "a.md", label: "Retry" },
        ],
      ),
    );
    expect(plan.create.map((c) => c.label)).toEqual(["Retry"]);
  });

  it("lists entries with no definition, a block's definition carried, a see entry left out", () => {
    const jitter = term("Jitter");
    const quorum = term("Quorum");
    const plan = planFromMetadata(
      set(
        [jitter, quorum, term("Old", { see: "Jitter" })],
        [],
        [{ file: "a.md", label: "quorum", definition: "A majority.", edges: [] }],
      ),
    );
    expect(plan.create).toEqual([]);
    expect(plan.missing).toEqual([{ term: jitter }, { term: quorum, carried: "A majority." }]);
  });
});

describe("sharedTermDirectory", () => {
  it("is the one directory term pages share", () => {
    const dir = sharedTermDirectory([term("A", { path: "/d/glossary/a.md" }), term("B", { path: "/d/glossary/b.md" })]);
    expect(dir).toBe("/d/glossary");
  });

  it("is undefined for two directories, or no term pages", () => {
    expect(sharedTermDirectory([term("A", { path: "/d/x/a.md" }), term("B", { path: "/d/y/b.md" })])).toBeUndefined();
    expect(sharedTermDirectory([term("A", { construct: "manifest", path: "/d/terms.yaml" })])).toBeUndefined();
    expect(sharedTermDirectory([])).toBeUndefined();
  });
});

describe("pageExtension", () => {
  it("follows the term pages in the directory first", () => {
    const terms = [term("A", { path: "/d/g/a.mdx" }), term("B", { path: "/d/g/b.mdx" }), term("C", { path: "/d/g/c.md" })];
    expect(pageExtension(terms, "/d/g", ["x.md", "y.md", "z.md"])).toBe(".mdx");
  });

  it("then the most common page extension, then .md", () => {
    expect(pageExtension([], "/d/g", ["a.adoc", "b.adoc", "c.md", "terms.tbx"])).toBe(".adoc");
    expect(pageExtension([], "/d/g", ["terms.tbx"])).toBe(".md");
  });

  it("follows .htm pages, and the .markdown and .asciidoc spellings", () => {
    expect(pageExtension([], "/d/g", ["a.htm", "b.htm", "c.md"])).toBe(".htm");
    expect(pageExtension([], "/d/g", ["a.markdown"])).toBe(".markdown");
    expect(pageExtension([], "/d/g", ["a.asciidoc"])).toBe(".asciidoc");
  });

  it("only picks an extension whose format writes one term per page", () => {
    for (const [ext, format] of Object.entries(FILL_PAGE_FORMATS)) {
      expect(TERM_WRITERS.find((w) => w.format === format)?.shapes, ext).toContain("directory");
    }
  });
});

describe("crawl candidates", () => {
  it("merge across pages by label, keeping the most confident definition", () => {
    const merged = mergeFound([
      { file: "a.md", line: 3, label: "Idempotency key", definition: "Weak.", confidence: 0.6 },
      { file: "b.md", line: 9, label: "idempotency key", altLabels: ["Idempotency token"], definition: "Strong.", confidence: 0.9 },
      { file: "b.md", label: "Idempotency Key" },
      { file: "c.md", label: "Charge", confidence: 0.95, definition: "Money moves." },
    ]);
    expect(merged).toEqual([
      {
        label: "Idempotency key",
        altLabels: ["Idempotency token"],
        definition: "Strong.",
        confidence: 0.9,
        from: [{ file: "a.md", line: 3 }, { file: "b.md", line: 9 }],
      },
      { label: "Charge", altLabels: [], definition: "Money moves.", confidence: 0.95, from: [{ file: "c.md" }] },
    ]);
  });

  it("need minPages pages, and drop what a known name covers", () => {
    const merged = mergeFound([
      { file: "a.md", label: "Key", confidence: 0.9 },
      { file: "b.md", label: "Key", confidence: 0.9 },
      { file: "a.md", label: "Retry", confidence: 0.9 },
      { file: "b.md", label: "Retry", confidence: 0.9 },
      { file: "a.md", label: "Lone", confidence: 0.9 },
    ]);
    expect(newCandidates(merged, new Set(["retry"]), 2).map((c) => c.label)).toEqual(["Key"]);
    expect(newCandidates(merged, new Set(), 1).map((c) => c.label)).toEqual(["Key", "Retry", "Lone"]);
  });
});
