/**
 * `manni docevals fill` — ask an LLM provider to propose frontmatter evals for each
 * page, gate the proposals on self-reported confidence, and append the
 * survivors to the page's frontmatter. Proposals are ai-graded only and
 * deduplicated against the page's resolved plan; existing evals are never
 * touched. See ADR 01001.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";
import { loadConfig } from "../core/config.js";
import { discoverPages, leadingFrontmatterFormat } from "../core/discover.js";
import { resolvePages, type ResolvedPagePlan } from "../core/resolve.js";
import { appendPageEvals, type NewEvalEntry } from "../core/frontmatter-edit.js";
import {
  parseFormat,
  SUMMARY_FORMATS,
  type SummaryFormat,
} from "../reporters/format.js";
import { makeProvider, resolveProviderIdentity } from "../judge/provider.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import { FillCache, fillCacheKey } from "../fill/cache.js";
import {
  FILL_SYSTEM_PROMPT,
  buildFillUser,
  isValidProposal,
  PROPOSAL_SCHEMA,
} from "../fill/prompt.js";
import { looksLikeOverflow, splitBody } from "../core/split.js";

export interface FillOptions {
  config?: string;
  cwd?: string;
  /** Characters of page per inference call; longer pages are split. */
  chunkChars?: number;
  /** Report proposals without writing frontmatter. */
  dryRun?: boolean;
  /** Minimum confidence to write; overrides config `fill.confidenceThreshold`. */
  confidence?: number;
  /** Stop after this many inference calls; overrides config `fill.maxTurns`. */
  maxTurns?: number;
  noCache?: boolean;
  provider?: string;
  model?: string;
  /** Test seam: bypasses provider construction entirely. */
  providerInstance?: InferenceProvider;
}

export type FillStatus =
  | "filled"
  | "proposed"
  | "nothing-proposed"
  | "skipped"
  | "skipped-budget"
  | "error";

export interface ProposedEval {
  id: string;
  assertion: string;
  confidence: number;
  examples: { pass: string; fail: string };
  type?: "capability" | "regression";
  evidence?: string;
  severity?: "error" | "warning" | "info";
  rationale?: string;
}

export interface FillPageResult {
  file: string;
  status: FillStatus;
  /** Appended (or, in a dry run, would-append) proposals. */
  written: ProposedEval[];
  /** Proposals below the confidence threshold — reported, never written. */
  belowThreshold: ProposedEval[];
  /** Fresh proposals dropped for exceeding `fill.maxEvalsPerPage`. */
  capped: ProposedEval[];
  /** Proposed ids that already exist in the page's resolved plan. */
  duplicates: string[];
  cached: boolean;
  error?: string;
}

export interface FillReport {
  results: FillPageResult[];
  threshold: number;
  /** Inference calls actually made. One per proposed page; a cache hit is none. */
  turns: number;
  exitCode: 0 | 1;
}

/**
 * Proposals become inline evals with explicit grader/type. Confidence is no
 * longer report-only — it is written to `eval-provenance` alongside the model
 * that proposed it, so the page itself records what a machine wrote and how
 * sure it was, and a reviewer retires the entry when they have checked it.
 */
function toEntry(p: ProposedEval): NewEvalEntry {
  return {
    id: p.id,
    assertion: p.assertion,
    type: p.type ?? "regression",
    grader: "ai",
    evidence: p.evidence,
    examples: p.examples,
    severity: p.severity,
  };
}

export async function runFill(
  globs: string[],
  options: FillOptions = {},
): Promise<FillReport> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(options.config, cwd);
  const pages = discoverPages(config, globs, cwd);
  const plans = resolvePages(pages, config);

  const threshold = options.confidence ?? config.fill.confidenceThreshold;
  const maxTurns = options.maxTurns ?? config.fill.maxTurns;
  const temperature = config.fill.temperature;
  const maxEvals = config.fill.maxEvalsPerPage;
  const chunkChars = options.chunkChars ?? config.fill.chunkChars;
  const cache = new FillCache(
    resolve(cwd, config.fill.cacheDir),
    !options.noCache,
  );

  // Identity is resolved without constructing the provider, so fully-cached
  // or all-skipped runs need no API key.
  let provider = options.providerInstance;
  const identity = provider
    ? { provider: provider.provider(), model: provider.modelName() }
    : resolveProviderIdentity(config, {
        provider: options.provider,
        model: options.model,
      });
  const getProvider = () =>
    (provider ??= makeProvider(config, {
      provider: options.provider,
      model: options.model,
    }));
  let turns = 0;
  const results: FillPageResult[] = [];

  for (const plan of plans) {
    results.push(await fillOne(plan));
  }

  return {
    results,
    threshold,
    turns,
    exitCode: results.some((r) => r.status === "error") ? 1 : 0,
  };

  async function fillOne(plan: ResolvedPagePlan): Promise<FillPageResult> {
    const base: FillPageResult = {
      file: plan.page.file,
      status: "nothing-proposed",
      written: [],
      belowThreshold: [],
      capped: [],
      duplicates: [],
      cached: false,
    };
    if (plan.skip) return { ...base, status: "skipped" };
    const problem = plan.problems.find((p) => p.level === "error");
    if (problem) return { ...base, status: "error", error: problem.message };
    // Reject non-YAML frontmatter before spending an LLM call: it can't be
    // appended to (appendPageEvals would otherwise refuse) and there is
    // nothing to fill.
    const format = leadingFrontmatterFormat(plan.page.content);
    if (format === "toml" || format === "json") {
      return {
        ...base,
        status: "error",
        error: `only YAML frontmatter can be filled (found ${format} frontmatter)`,
      };
    }

    const existing = plan.evals.map((e) => ({
      id: e.name,
      assertion: e.assertion,
    }));
    const existingNames = existing.map((e) => e.id).sort();
    // Keyed on the budget the proposals were actually produced at, not the
    // one the run asked for. Halve-and-retry means those differ: the split
    // boundaries move, so the parts differ, so the proposals differ. Storing
    // a halved-budget result under the full-budget key lets a later run that
    // did *not* overflow replay proposals from a split it never performed.
    const keyFor = (budget: number): string =>
      fillCacheKey(
        identity.provider,
        identity.model,
        temperature,
        maxEvals,
        plan.page.body,
        existingNames,
        budget,
      );
    // Deliberately no fallback lookup at the halved budget. Serving a halved
    // result to a run that asked for the full one is the collision itself,
    // just spread over two keys — and a page that overflows does so
    // deterministically for the same provider and body, so the retry path
    // finds its own entry from the second run onward.
    const key = keyFor(chunkChars);
    let raw = cache.get(key);
    const cached = raw !== undefined;
    if (!raw) {
      // Claimed before the call, not tallied after it (ADR 01019). A cache
      // hit never reaches here, so replaying a cached corpus spends no turns.
      if (maxTurns !== null && turns >= maxTurns) {
        return { ...base, status: "skipped-budget" };
      }
      // A page longer than the budget is proposed against in parts rather
      // than truncated. Each part is its own call; the results merge by eval
      // id, keeping the highest confidence — docmeta's `mergeProposals`.
      let budget = chunkChars;
      // This page's own parts. `turns` is the run-wide budget counter and
      // includes every earlier page, so reporting it as "N of M parts" names
      // a number that has nothing to do with this page.
      let partsRead = 0;
      let merged: Map<string, ProposedEval> | undefined;
      let failure: string | undefined;
      for (let attempt = 0; attempt < 2 && merged === undefined; attempt++) {
        const chunks = splitBody(plan.page.body, budget);
        const collected = new Map<string, ProposedEval>();
        let overflowed = false;
        let outOfTurns = false;
        partsRead = 0;
        for (const [i, chunk] of chunks.entries()) {
          if (maxTurns !== null && turns >= maxTurns) {
            outOfTurns = true;
            break;
          }
          turns += 1;
          partsRead += 1;
          let response;
          try {
            response = await getProvider().completeJSON({
              system: FILL_SYSTEM_PROMPT,
              user: buildFillUser(
                plan.page.file,
                chunk,
                existing,
                maxEvals,
                chunks.length > 1 ? { index: i, total: chunks.length } : undefined,
              ),
              schema: PROPOSAL_SCHEMA,
              temperature,
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            failure = message;
            if (looksLikeOverflow(message)) overflowed = true;
            break;
          }
          if (!isValidProposal(response.json)) {
            failure = "provider returned a proposal that does not match the schema";
            break;
          }
          for (const proposal of (response.json as { evals: ProposedEval[] }).evals) {
            const held = collected.get(proposal.id);
            if (held === undefined || proposal.confidence > held.confidence) {
              collected.set(proposal.id, proposal);
            }
          }
          if (i === chunks.length - 1) merged = collected;
        }
        if (outOfTurns) {
          // Never a silent partial: a page read in part proposed from part of
          // itself, and saying so is the difference between "nothing to add"
          // and "we stopped early".
          return {
            ...base,
            status: "skipped-budget",
            ...(chunks.length > 1
              ? {
                  error:
                    `--max-turns reached after ${String(partsRead)} of ` +
                    `${String(chunks.length)} part(s) of this page`,
                }
              : {}),
          };
        }
        if (merged === undefined && overflowed && attempt === 0) {
          budget = Math.max(1, Math.floor(budget / 2));
          continue;
        }
        if (merged === undefined) break;
      }
      if (merged === undefined) {
        return {
          ...base,
          status: "error",
          error: failure ?? "the provider returned no proposal",
        };
      }
      raw = { evals: [...merged.values()] };
      cache.set(keyFor(budget), raw);
    }

    // Drop duplicates (against the resolved plan and within the batch) before
    // applying the per-page cap, so duplicate names never crowd out fresh
    // proposals.
    const seen = new Set(existingNames);
    const duplicates: string[] = [];
    const fresh: ProposedEval[] = [];
    for (const p of raw.evals as ProposedEval[]) {
      if (seen.has(p.id)) {
        duplicates.push(p.id);
        continue;
      }
      seen.add(p.id);
      fresh.push(p);
    }
    // Proposals beyond the per-page cap are reported as `capped` rather than
    // silently dropped — they may be high-confidence, so folding them into
    // belowThreshold would misreport why they weren't written.
    const capped = fresh.slice(maxEvals);
    const belowThreshold: ProposedEval[] = [];
    const written: ProposedEval[] = [];
    for (const p of fresh.slice(0, maxEvals)) {
      if (p.confidence >= threshold) written.push(p);
      else belowThreshold.push(p);
    }

    const result = {
      ...base,
      written,
      belowThreshold,
      capped,
      duplicates,
      cached,
    };
    if (written.length === 0) return result;
    try {
      const updated = appendPageEvals(
        plan.page.content,
        plan.page.file,
        written.map(toEntry),
        {
          generatedBy: identity.model,
          evals: written.map((p) => p.id),
          confidence: Object.fromEntries(
            written.map((p) => [p.id, p.confidence]),
          ),
        },
      );
      if (!options.dryRun) writeFileSync(plan.page.absPath, updated);
    } catch (e) {
      return {
        ...result,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
        written: [],
      };
    }
    return { ...result, status: options.dryRun ? "proposed" : "filled" };
  }
}

const STATUS_LABELS: Record<FillStatus, string> = {
  filled: "filled",
  proposed: "proposed",
  "nothing-proposed": "no-op",
  skipped: "skipped",
  "skipped-budget": "skipped",
  error: "error",
};

export function renderFill(
  report: FillReport,
  format: SummaryFormat,
): string {
  // See renderList — same reasoning, same public exposure via src/index.ts.
  parseFormat(format, SUMMARY_FORMATS, "format");
  if (format === "json") return JSON.stringify(report, null, 2);
  const lines: string[] = [];
  const names = (evals: ProposedEval[]) =>
    evals.map((p) => `${p.id} ${p.confidence.toFixed(2)}`).join(", ");
  for (const r of report.results) {
    const label = STATUS_LABELS[r.status].padEnd(8);
    const cachedTag = r.cached ? " [cached]" : "";
    switch (r.status) {
      case "filled":
        lines.push(
          `${pc.green(label)} ${r.file}  +${r.written.length} evals (${names(r.written)})${cachedTag}`,
        );
        break;
      case "proposed":
        lines.push(
          `${pc.cyan(label)} ${r.file}  +${r.written.length} evals (${names(r.written)})${cachedTag} — dry run, not written`,
        );
        break;
      case "nothing-proposed":
        lines.push(`${pc.dim(label)} ${r.file}  (nothing new proposed)${cachedTag}`);
        break;
      case "skipped":
        lines.push(`${pc.dim(label)} ${r.file}  (evals.skip)`);
        break;
      case "skipped-budget":
        lines.push(`${pc.yellow(label)} ${r.file}  (turn budget exhausted)`);
        break;
      case "error":
        lines.push(`${pc.red(label)} ${r.file}: ${r.error ?? "unknown error"}`);
        break;
    }
    if (r.belowThreshold.length > 0) {
      lines.push(
        pc.dim(
          `         below ${report.threshold}: ${names(r.belowThreshold)}`,
        ),
      );
    }
    if (r.capped.length > 0) {
      lines.push(
        pc.dim(`         over per-page cap: ${names(r.capped)}`),
      );
    }
    if (r.duplicates.length > 0) {
      lines.push(pc.dim(`         duplicates: ${r.duplicates.join(", ")}`));
    }
  }
  lines.push("");
  lines.push(
    `Threshold: ${report.threshold} · inference calls: ${report.turns}`,
  );
  return lines.join("\n");
}
