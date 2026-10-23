/**
 * `fitAnswer`: what `graph serve` sends for one answer. Compact first, then
 * reduce passages to references in reverse priority until the answer fits.
 * A synthetic answer pins the order without a corpus.
 */
import { describe, expect, it } from "vitest";
import { fitAnswer, type ServedBundle, type ServedLookup, type ServedPassage } from "../../../src/graph/commands/serve-fit.js";
import type { ProvenanceRecord } from "../../../src/graph/runtime/chunks.js";
import type { LookupMatch, LookupReached, LookupResult, PassageBundle, RetrievalTrace } from "../../../src/graph/runtime/retrieve.js";

const proof = (iri: string): ProvenanceRecord => ({ node: iri, page: `${iri}.md` }) as unknown as ProvenanceRecord;
const body = (iri: string): string => `${iri} `.repeat(40);

function match(iri: string, rank: number): LookupMatch {
  return {
    iri,
    title: iri.toUpperCase(),
    page: `${iri}.md`,
    lines: "1-9",
    text: body(iri),
    truncated: false,
    provenance: proof(iri),
    rank,
    score: { lexical: 0.5, vector: null, fused: 1 / rank },
  };
}

function reached(iri: string, depth: number, text = true): LookupReached {
  return {
    iri,
    title: iri.toUpperCase(),
    page: `${iri}.md`,
    lines: "1-9",
    text: text ? body(iri) : null,
    truncated: !text,
    provenance: proof(iri),
    depth,
  };
}

const edges = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ from: `${prefix}${String(i)}`, predicate: "dcterms:references", to: "m1" }));

function trace(): RetrievalTrace {
  return {
    entry: { candidates: [{ iri: "m1", score: 1 }] } as RetrievalTrace["entry"],
    hops: [{ from: "m1" }, { from: "m2" }] as unknown as RetrievalTrace["hops"],
    exclusions: [{ node: "x" }] as unknown as RetrievalTrace["exclusions"],
    resolutions: [{ node: "y" }] as unknown as RetrievalTrace["resolutions"],
    withheld: [],
    filtered: [],
  };
}

function lookup(): LookupResult {
  const matches = [match("m1", 1), match("m2", 2)];
  const traversal = [reached("t1", 1), reached("t2", 2), reached("t3", 1, false)];
  const impact = [reached("i1", 1), reached("i2", 2), reached("i3", 2)];
  return {
    question: "q",
    language: "en",
    matches: { passages: matches, truncated: false },
    traversal: { passages: traversal, edges: edges("t", 3), truncated: true },
    impact: { passages: impact, edges: edges("i", 3), truncated: false },
    pages: Object.fromEntries(
      [...matches, ...traversal, ...impact].map((p) => [p.page, { metadata: { title: p.iri } }]),
    ),
    citations: [],
    trace: trace(),
  };
}

const size = (a: unknown): number => JSON.stringify(a).length;
const all = (a: ServedLookup): ServedPassage[] => [...a.matches.passages, ...a.traversal.passages, ...a.impact.passages];
const asLookup = (a: unknown): ServedLookup => a as ServedLookup;

describe("fitAnswer: compaction", () => {
  it("keeps the trace's entry, withheld and filtered, and leaves out the walk diagnostics", () => {
    const served = asLookup(fitAnswer(lookup(), 1_000_000));
    expect(Object.keys(served.trace).sort()).toEqual(["entry", "filtered", "withheld"]);
    expect(served.trace.entry.candidates).toEqual([{ iri: "m1", score: 1 }]);
  });

  it("drops provenance from a passage with no text, and pages names only texted passages' pages", () => {
    const served = asLookup(fitAnswer(lookup(), 1_000_000));
    const t3 = served.traversal.passages.find((p) => p.iri === "t3");
    expect(t3).toBeDefined();
    expect(t3).not.toHaveProperty("provenance");
    expect(served.matches.passages[0]?.provenance).toEqual(proof("m1"));
    expect(Object.keys(served.pages).sort()).toEqual(["i1.md", "i2.md", "i3.md", "m1.md", "m2.md", "t1.md", "t2.md"]);
  });

  it("leaves the full result it was given untouched", () => {
    const full = lookup();
    const before = JSON.stringify(full);
    fitAnswer(full, 1);
    expect(JSON.stringify(full)).toBe(before);
  });

  it("returns a refusal as it is", () => {
    const refused: LookupResult = { ...lookup(), refusal: { reason: "no-route", detail: "nothing" } };
    expect(fitAnswer(refused, 1)).toBe(refused);
  });
});

describe("fitAnswer: the cap", () => {
  it("sends the compact answer whole when it fits", () => {
    const compact = fitAnswer(lookup(), 1_000_000);
    expect(fitAnswer(lookup(), size(compact))).toEqual(compact);
  });

  it("reduces impact deepest and latest first, then traversal deepest first, then matches lowest-ranked first", () => {
    const full = size(fitAnswer(lookup(), 1_000_000));
    const order: string[] = [];
    for (let cap = full; cap > 0; cap -= 7) {
      for (const p of all(asLookup(fitAnswer(lookup(), cap)))) {
        if (p.text === null && p.iri !== "t3" && !order.includes(p.iri)) order.push(p.iri);
      }
    }
    expect(order).toEqual(["i3", "i2", "i1", "t2", "t1", "m2", "m1"]);
  });

  it("stops as soon as the answer fits, and marks only the sections it reduced", () => {
    const compact = asLookup(fitAnswer(lookup(), 1_000_000));
    const served = asLookup(fitAnswer(lookup(), size(compact) - 1));
    expect(size(served)).toBeLessThan(size(compact));
    expect(served.impact.passages.map((p) => p.text === null)).toEqual([false, false, true]);
    expect(served.impact.truncated).toBe(true);
    expect(served.matches.truncated).toBe(false);
    expect(served.traversal.truncated).toBe(true);
    expect(served.pages).not.toHaveProperty("i3.md");
    expect(served.pages).toHaveProperty("i2.md");
  });

  it("reduces a passage to a reference: where it is and where it ranks", () => {
    const served = asLookup(fitAnswer(lookup(), 1));
    expect(served.matches.passages[0]).toEqual({
      iri: "m1",
      title: "M1",
      page: "m1.md",
      lines: "1-9",
      rank: 1,
      score: { fused: 1 },
      text: null,
      truncated: true,
    });
    expect(served.impact.passages[1]).toEqual({
      iri: "i2",
      title: "I2",
      page: "i2.md",
      lines: "1-9",
      depth: 2,
      text: null,
      truncated: true,
    });
    expect(served.pages).toEqual({});
    expect(served.matches.truncated).toBe(true);
  });

  it("drops the walks' edges from the end, impact's first, before any match loses its text", () => {
    const compact = asLookup(fitAnswer(lookup(), 1_000_000));
    const floor = asLookup(fitAnswer(lookup(), 1));
    expect(floor.impact.edges).toEqual([]);
    expect(floor.traversal.edges).toEqual([]);
    // Every walk passage a reference, every edge kept, the matches whole.
    const walked = {
      ...floor,
      matches: compact.matches,
      traversal: { ...floor.traversal, edges: edges("t", 3) },
      impact: { ...floor.impact, edges: edges("i", 3) },
      pages: { "m1.md": compact.pages["m1.md"], "m2.md": compact.pages["m2.md"] },
    };
    const served = asLookup(fitAnswer(lookup(), size(walked) - 1));
    expect(served.impact.edges).toEqual(edges("i", 2));
    expect(served.traversal.edges).toEqual(edges("t", 3));
    expect(served.matches).toEqual(compact.matches);
  });
});

describe("fitAnswer: bundles", () => {
  function bundle(): PassageBundle {
    const block = (iri: string, depth: number, role: "match" | "context") => ({
      iri,
      title: iri.toUpperCase(),
      text: body(iri),
      sourceUrl: `${iri}.md`,
      depth,
      page: `${iri}.md`,
      provenance: proof(iri),
      role,
    });
    const context = [block("c1", 0, "match"), block("c2", 1, "context"), block("c3", 1, "context")];
    return {
      question: "q",
      language: "en",
      context,
      citations: context.map((b) => ({ iri: b.iri, title: b.title, sourceUrl: b.sourceUrl })),
      pages: Object.fromEntries(context.map((b) => [b.page, { metadata: {} }])),
      trace: trace(),
      truncated: false,
    };
  }

  it("compacts the trace and keeps every texted passage's proof", () => {
    const served = fitAnswer(bundle(), 1_000_000) as ServedBundle;
    expect(Object.keys(served.trace).sort()).toEqual(["entry", "filtered", "withheld"]);
    expect(served.context.every((p) => p.provenance !== undefined)).toBe(true);
    expect(served.truncated).toBe(false);
  });

  it("reduces its passages in reverse order, to references with their depth and role", () => {
    const full = size(fitAnswer(bundle(), 1_000_000));
    const one = fitAnswer(bundle(), full - 1) as ServedBundle;
    expect(one.context.map((p) => p.text === null)).toEqual([false, false, true]);
    expect(one.context[2]).toEqual({ iri: "c3", title: "C3", page: "c3.md", depth: 1, role: "context", text: null, truncated: true });
    expect(one.truncated).toBe(true);
    expect(Object.keys(one.pages)).toEqual(["c1.md", "c2.md"]);
    const floor = fitAnswer(bundle(), 1) as ServedBundle;
    expect(floor.context.every((p) => p.text === null)).toBe(true);
    expect(floor.pages).toEqual({});
  });
});
