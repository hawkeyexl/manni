/**
 * The chunk artifact's shapes (proposal 0090): `chunks.json`, the manifest,
 * and one `chunks.<tag>.jsonl` row per servable passage, each carrying its
 * provenance record. `manni graph export chunks` writes them on the Node side;
 * every host reads them. Types only, so the runtime bundle stays
 * platform-neutral.
 */

/** What a pin's finding says: cite's rule, at the severity `cite.severity` resolves. */
export interface PinFinding {
  rule: string;
  severity: "notice" | "warning" | "error";
}

/** One citation pin whose claim overlaps the passage. */
export interface PinItem {
  /** The citation's `id`, when it has one. */
  id: string | null;
  /** The body lines the claim occupies now: `N` or `N-M`. */
  claim: string;
  /** `path:lines` as the entry spells it; an encrypted path stays its token. */
  source: string;
  /** The commit the source end was recorded at, as recorded, or `null`. */
  commit: string | null;
  /** Empty means current. */
  findings: PinFinding[];
  /** The entry's `last-verified` as written, or `null`. */
  lastVerified: string | null;
  /** The entry's `verified-by` entries, or `[]`. */
  verifiedBy: unknown[];
}

export interface PinSummary {
  total: number;
  current: number;
  notice: number;
  warning: number;
  error: number;
  items: PinItem[];
}

/** A merge-safe date (proposals 0069, 0072): the derived UTC day, and whether the page names it. */
export interface DerivedDate {
  day: string | null;
  stamp: "current" | "stale" | "absent";
}

export interface ProvenanceDates {
  created: DerivedDate;
  lastUpdated: DerivedDate;
  /** The page's `last-verified` as written, or `null`. */
  lastVerified: string | null;
  /** The page's `verified-by` entries, or `[]`. */
  verifiedBy: unknown[];
}

export interface EvalItem {
  name: string;
  suite: string;
  grader: string;
  outcome: "pass" | "fail" | "needs-review" | "skipped" | "error";
  confidence?: number;
}

export interface ProvenanceEvals {
  /** `sha256-<64 hex>` of the report the verdicts came from. */
  report: string;
  /** Whether the page still has the bytes the verdicts judged. */
  current: boolean;
  pass: number;
  fail: number;
  needsReview: number;
  skipped: number;
  error: number;
  items: EvalItem[];
}

/** A block statement (proposal 0099) anchored inside the passage. */
export interface PassageStatement {
  /** Body lines, `N-M`. */
  lines: string;
  status: "current" | "changed" | "unpinned";
  /** Its delivered fields. */
  data: Record<string, unknown>;
}

/** The proof one served passage carries. Self-contained: copied out alone, it still says what it describes. */
export interface ProvenanceRecord {
  node: string;
  page: string;
  lines: string;
  /** The docs commit, or `null` outside git. */
  commit: string | null;
  worktree: "clean" | "modified" | null;
  pins: PinSummary;
  dates: ProvenanceDates;
  /** `null` when no docevals report was given. */
  evals: ProvenanceEvals | null;
  statements: PassageStatement[];
}

/** One line of `chunks.<tag>.jsonl`. */
export interface ChunkRow {
  /** The graph node IRI. */
  id: string;
  /** The digest of the graph the row was built from. */
  graph: string;
  page: string;
  /** Body lines, `N-M`. */
  lines: string;
  language: string;
  title: string;
  text: string;
  /** Present when the manifest names a model. */
  vector?: number[];
  /** The page's delivered fields, overlaid by its heading statements down to this section. */
  metadata: Record<string, unknown>;
  provenance: ProvenanceRecord;
}

export type WithholdReason = "drifted" | "failing";

/** `chunks.json`. Keys are sorted, and nothing in it reads the wall clock. */
export interface ChunksManifest {
  format: "manni-graph-chunks";
  version: 1;
  /** `sha256-<64 hex>` of `graphFile`. */
  graph: string;
  graphFile: string;
  searchIndex: string;
  commit: string | null;
  worktree: "clean" | "modified" | null;
  model: { id: string; dimensions: number } | null;
  retrieve: { seeds: number; depth: number; maxChars: number; withhold: WithholdReason[] };
  evals: { report: string; digest: string } | null;
  languages: Record<string, { file: string; rows: number }>;
  pages: Record<string, { metadata: Record<string, unknown> }>;
  withheld: { id: string; page: string; because: WithholdReason[] }[];
}
