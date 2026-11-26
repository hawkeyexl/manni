/**
 * `manni vector search` (proposal 0128 §4): one language's nodes, ranked by
 * meaning alone. The vector leg is graph's search core under `mode: "vector"`,
 * so the two rank, refuse and print alike. Hybrid ranking stays on graph,
 * which has both legs.
 */
import {
  renderSearch,
  runSearch as runGraphSearch,
  type SearchReport,
} from "../../graph/commands/search.js";
import type { Embedder } from "../../graph/embed/types.js";

export interface SearchOptions {
  query: string;
  /** `-i`: the directory holding the indexes, the manifest and the sidecars (default: beside `graph.out`). */
  index?: string;
  /** `--lang`: required when the corpus has more than one language. */
  lang?: string;
  /** `--limit`: maximum results (default 10). */
  limit?: number;
  config?: string;
  noConfig?: boolean;
  /** Injection seam for tests: bypasses the embedder factory. */
  embedder?: Embedder;
  cwd?: string;
}

export function runSearch(opts: SearchOptions): Promise<SearchReport> {
  return runGraphSearch({ ...opts, mode: "vector" });
}

export { renderSearch, type SearchReport };
