/**
 * What `graph serve` sends for one answer: the full result its CLI twin
 * prints, made to fit an agent's context. Pure, and the result it is given is
 * left as it was, because the CLI and the runtime return it whole.
 *
 * Compact first. The trace keeps `entry`, `withheld` and `filtered`, and
 * leaves out the walk diagnostics. A passage with no text carries no proof,
 * and `pages` names only the pages of passages that carry text.
 *
 * Then the cap. While the JSON is longer than `maxChars`, passages become
 * references in reverse priority. On a lookup the walks' passages go first,
 * then the walks' edges from the end, and the matches last, so the passages
 * that answer the question keep their text longest. A refusal is small, and
 * goes out as it is.
 */
import type { ProvenanceRecord } from "../runtime/chunks.js";
import type { LookupEdge, LookupResult, PassageBundle, PassageRole, RetrievalTrace } from "../runtime/retrieve.js";

/** One passage as served: its text and proof, or, reduced, a reference to read it by. */
export interface ServedPassage {
  iri: string;
  title?: string;
  page: string;
  lines?: string;
  text: string | null;
  truncated?: boolean;
  provenance?: ProvenanceRecord;
  sourceUrl?: string;
  rank?: number;
  score?: { lexical?: number | null; vector?: number | null; fused: number };
  depth?: number;
  role?: PassageRole;
}

interface ServedSection {
  passages: ServedPassage[];
  truncated: boolean;
}

interface ServedWalk extends ServedSection {
  edges: LookupEdge[];
}

type ServedTrace = Pick<RetrievalTrace, "entry" | "withheld" | "filtered">;
type Pages = PassageBundle["pages"];

export interface ServedLookup extends Omit<LookupResult, "matches" | "traversal" | "impact" | "trace"> {
  matches: ServedSection;
  traversal: ServedWalk;
  impact: ServedWalk;
  trace: ServedTrace;
}

export interface ServedBundle extends Omit<PassageBundle, "context" | "trace"> {
  context: ServedPassage[];
  trace: ServedTrace;
}

export type ServedAnswer = ServedLookup | ServedBundle;

/** A passage with text keeps its proof; one without leaves it out. */
function proofed(p: ServedPassage): ServedPassage {
  if (p.text !== null) return p;
  const { provenance, ...rest } = p;
  return rest;
}

/** A passage reduced to where it is and where it ranks. */
function reference(p: ServedPassage): ServedPassage {
  return {
    iri: p.iri,
    ...(p.title === undefined ? {} : { title: p.title }),
    page: p.page,
    ...(p.lines === undefined ? {} : { lines: p.lines }),
    ...(p.rank === undefined ? {} : { rank: p.rank }),
    ...(p.score === undefined ? {} : { score: { fused: p.score.fused } }),
    ...(p.depth === undefined ? {} : { depth: p.depth }),
    ...(p.role === undefined ? {} : { role: p.role }),
    text: null,
    truncated: true,
  };
}

/** The pages of `all` that a passage with text names. */
function texted(all: Pages, passages: readonly ServedPassage[]): Pages {
  const named = new Set(passages.filter((p) => p.text !== null).map((p) => p.page));
  return Object.fromEntries(Object.entries(all).filter(([page]) => named.has(page)));
}

/** One passage the cap may reduce, and the section whose `truncated` it sets. */
interface Slot {
  list: ServedPassage[];
  index: number;
  owner: { truncated: boolean };
}

const slotsOf = (list: ServedPassage[], owner: { truncated: boolean }): Slot[] =>
  list.map((_, index) => ({ list, index, owner }));

/** A walk's passages, deepest first, then later ones first at equal depth. */
const deepestFirst = (s: ServedSection): Slot[] =>
  slotsOf(s.passages, s).sort(
    (a, b) => (b.list[b.index]?.depth ?? 0) - (a.list[a.index]?.depth ?? 0) || b.index - a.index,
  );

/** Matches, lowest-ranked first. */
const lowestRankedFirst = (s: ServedSection): Slot[] =>
  slotsOf(s.passages, s).sort((a, b) => (b.list[b.index]?.rank ?? b.index) - (a.list[a.index]?.rank ?? a.index));

/**
 * Run each stage until `out` fits: a list of passages to reduce in order, or
 * a walk whose edges go from the end.
 */
function cap(out: ServedAnswer, maxChars: number, stages: readonly (Slot[] | ServedWalk)[], sync: () => void): void {
  // ponytail: one stringify per step; an incremental length if answers grow to thousands of steps.
  const over = (): boolean => JSON.stringify(out).length > maxChars;
  for (const stage of stages) {
    if (!Array.isArray(stage)) {
      while (stage.edges.length > 0 && over()) {
        stage.edges.pop();
        stage.truncated = true;
      }
      continue;
    }
    for (const { list, index, owner } of stage) {
      if (!over()) return;
      const p = list[index];
      if (p === undefined) continue;
      list[index] = reference(p);
      owner.truncated = true;
      sync();
    }
  }
}

/** The answer `graph serve` sends: compact, then within `maxChars` characters of JSON where it can be. */
export function fitAnswer(answer: LookupResult | PassageBundle, maxChars: number): ServedAnswer {
  if (answer.refusal !== undefined) return answer;
  const trace: ServedTrace = {
    entry: answer.trace.entry,
    withheld: answer.trace.withheld,
    filtered: answer.trace.filtered,
  };
  if ("matches" in answer) {
    const out: ServedLookup = {
      ...answer,
      matches: { ...answer.matches, passages: answer.matches.passages.map(proofed) },
      traversal: { ...answer.traversal, passages: answer.traversal.passages.map(proofed), edges: [...answer.traversal.edges] },
      impact: { ...answer.impact, passages: answer.impact.passages.map(proofed), edges: [...answer.impact.edges] },
      trace,
    };
    const sync = (): void => {
      out.pages = texted(answer.pages, [...out.matches.passages, ...out.traversal.passages, ...out.impact.passages]);
    };
    sync();
    const stages = [
      [...deepestFirst(out.impact), ...deepestFirst(out.traversal)],
      out.impact,
      out.traversal,
      lowestRankedFirst(out.matches),
    ];
    cap(out, maxChars, stages, sync);
    return out;
  }
  const out: ServedBundle = { ...answer, context: answer.context.map(proofed), trace };
  const sync = (): void => {
    out.pages = texted(answer.pages, out.context);
  };
  sync();
  cap(out, maxChars, [slotsOf(out.context, out).reverse()], sync);
  return out;
}
