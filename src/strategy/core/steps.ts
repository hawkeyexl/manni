/**
 * A journey's `steps:` resolved to the run's pages (proposal 0106). Pure,
 * given the routes: the command core loads `graph.routes`, and only when a
 * step names a `/` route.
 *
 * A `doc` is a repo path, resolved from the config file's directory and named
 * exactly, or a `/` route, resolved by graph's own `resolveRoute`. A scheme
 * URL and a route no mapping covers are not checked. Anything after `#` or
 * `?` is dropped first.
 */
import { relative, resolve } from "node:path";
import { PathIndex, hasScheme, resolveRoute } from "../../graph/core/analyze.js";
import type { RouteMapping } from "../../graph/core/config.js";
import type { ResolvedStep, StepState, StrategyRecord, StrategySet, StrategyStep } from "../types.js";
import { indexSet, type StrategyIndex } from "./check.js";

export interface StepContext {
  /** `graph.routes`, rebased onto the run's base. None leaves every route unchecked. */
  routes?: RouteMapping[];
  /** The directory a repo-path `doc` resolves from: the config file's, else the working directory. */
  from?: string;
  /** The directory the run's labels are relative to. */
  base?: string;
}

/** Each journey with steps to its steps, resolved, in order. */
export type StepMap = ReadonlyMap<StrategyRecord, ResolvedStep[]>;

const posix = (path: string): string => path.replaceAll("\\", "/");

/** `doc` without its anchor or query. */
function target(doc: string): string {
  return doc.split(/[?#]/, 1)[0] ?? "";
}

/** Whether a step's doc is a site route, which needs `graph.routes`. */
function isRoute(doc: string): boolean {
  return target(doc).startsWith("/");
}

export function stepsNeedRoutes(set: StrategySet): boolean {
  return set.records.some((r) => r.steps?.some((s) => s.doc !== undefined && isRoute(s.doc)) === true);
}

/** What a `doc` names: a page of the run, no page, or nothing this run can check. */
type Located = { page: string } | "none" | "unchecked";

function locate(doc: string, pages: ReadonlySet<string>, index: PathIndex, ctx: StepContext): Located {
  if (hasScheme(doc)) return "unchecked";
  const path = target(doc);
  if (path.startsWith("/")) {
    const found = resolveRoute(path, ctx.routes ?? [], index);
    if (found === null) return "unchecked";
    return found === "broken" ? "none" : { page: found };
  }
  const label = ctx.from === undefined || ctx.base === undefined ? path : relative(ctx.base, resolve(ctx.from, path));
  const wanted = posix(label);
  return pages.has(wanted) ? { page: wanted } : "none";
}

/** The state table of proposal 0106. `found` is undefined when the step has no `doc`. */
function stateOf(step: StrategyStep, found: Located | undefined, served: boolean): StepState {
  if (found === undefined) return step.exists === true || step.exists === "partial" ? "broken" : "unwritten";
  if (found === "unchecked") return step.exists === false ? "unwritten" : "unchecked";
  if (found === "none") return step.exists === false ? "unwritten" : "broken";
  if (step.exists === "partial") return "partial";
  return served ? "served" : "unclaimed";
}

export function resolveSteps(set: StrategySet, ctx: StepContext = {}, index: StrategyIndex = indexSet(set)): Map<StrategyRecord, ResolvedStep[]> {
  const pages = new Set((set.pages ?? []).map(posix));
  // `PathIndex` is graph's tiered lookup; a repo path must name its file exactly, so it uses `pages`.
  const routeIndex = new PathIndex(pages);
  const out = new Map<StrategyRecord, ResolvedStep[]>();
  for (const record of set.records) {
    if (record.type !== "journey" || record.steps === undefined) continue;
    const naming = new Set(index.pagesNaming(record).map(posix));
    out.set(
      record,
      record.steps.map((step): ResolvedStep => {
        const found = step.doc === undefined ? undefined : locate(step.doc, pages, routeIndex, ctx);
        const page = typeof found === "object" ? found.page : undefined;
        const state = stateOf(step, found, page !== undefined && naming.has(page));
        return { ...step, state, ...(page === undefined ? {} : { page }) };
      }),
    );
  }
  return out;
}

/** Served steps over steps. */
export function coverageOf(steps: readonly ResolvedStep[]): { served: number; steps: number } {
  return { served: steps.filter((s) => s.state === "served").length, steps: steps.length };
}
