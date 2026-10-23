/**
 * Whom each page serves, and the impact roll-up over findings on those pages
 * (proposal 0105). Another domain hands in its findings, each with its page's
 * absolute path, and gets back one entry per persona and journey those pages
 * name, worst first. Cite's check is the first caller.
 *
 * Per field, 0102's gate holds: `journeys:` counts only when a journey record
 * exists, and `personas:` only when a persona record does. A value that names
 * no record is left out, since `strategy check` already reports it.
 */
import { resolve } from "node:path";
import type { Severity } from "../../shared/severity.js";
import { loadStrategy } from "../commands/run.js";
import type { StrategyRecord } from "../types.js";
import { resolveStrategyRun } from "./config.js";
import { indexSet } from "./check.js";

/** The two record types a page's readers are named by, in the order they print. */
const SERVING_TYPES = ["persona", "journey"] as const;
type ServingType = (typeof SERVING_TYPES)[number];

const FIELD_OF: Readonly<Record<ServingType, "personas" | "journeys">> = { persona: "personas", journey: "journeys" };

export interface ServingSet {
  /** The persona and journey records, in set order. */
  records: StrategyRecord[];
  /** Each page's named records, keyed by absolute path: personas first, then journeys, each once. */
  pages: Map<string, StrategyRecord[]>;
}

export interface ServingOptions {
  cwd: string;
  /** The config whose collections hold the records. */
  configPath?: string;
}

/**
 * Every collection's set, whatever the caller's own inputs. `undefined` when
 * no collection is declared or none holds a persona or journey record. A
 * broken `strategy:` section or an unreadable file throws strategy's error.
 */
export async function loadServing(opts: ServingOptions): Promise<ServingSet | undefined> {
  const configPath = opts.configPath === undefined ? {} : { configPath: opts.configPath };
  const run = await resolveStrategyRun({ cwd: opts.cwd, inputs: [], ...configPath });
  if (run.inputs.length === 0) return undefined;
  // ponytail: one walk and one merged view of every collection, on a red run only. Narrow the read to the finding pages if it costs.
  const { set } = await loadStrategy({ cwd: opts.cwd, inputs: [], allowEmpty: true, ...configPath });
  const records = set.records.filter((r): r is StrategyRecord & { type: ServingType } =>
    (SERVING_TYPES as readonly string[]).includes(r.type),
  );
  if (records.length === 0) return undefined;

  const index = indexSet(set);
  const pages = new Map<string, StrategyRecord[]>();
  for (const type of SERVING_TYPES) {
    for (const reference of set.references) {
      if (reference.record || reference.field !== FIELD_OF[type]) continue;
      const named = index.resolve(type, reference.value);
      if (named === undefined) continue;
      const page = resolve(run.base, reference.page);
      const list = pages.get(page) ?? [];
      if (!list.includes(named)) list.push(named);
      pages.set(page, list);
    }
  }
  return { records, pages };
}

/** One reported finding, on the page it counts on. */
export interface ImpactFinding {
  /** The page's absolute path, the key into `ServingSet.pages`. */
  page: string;
  /** The page as the caller's report spells it. */
  file: string;
  severity: Severity;
}

/** One persona or journey, and the findings on the pages that name it. */
export interface ImpactEntry {
  type: ServingType;
  id: string;
  title?: string;
  /** A journey record's `lifecycle:`, when it has one. */
  lifecycle?: string;
  findings: number;
  errors: number;
  warnings: number;
  notices: number;
  /** Those pages, as the caller spells them, in the order its findings came. */
  pages: string[];
}

/** A journey that is not live: it sorts after every live one. */
const RETIRED = new Set(["draft", "archived"]);

function retired(entry: ImpactEntry): number {
  return entry.lifecycle !== undefined && RETIRED.has(entry.lifecycle) ? 1 : 0;
}

/** Personas, then journeys. Within each: live first, then errors, warnings, notices and findings, descending, then id. */
function worstFirst(a: ImpactEntry, b: ImpactEntry): number {
  return (
    SERVING_TYPES.indexOf(a.type) - SERVING_TYPES.indexOf(b.type) ||
    retired(a) - retired(b) ||
    b.errors - a.errors ||
    b.warnings - a.warnings ||
    b.notices - a.notices ||
    b.findings - a.findings ||
    a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" })
  );
}

/** The roll-up: one entry per record a finding's page names, worst first. Empty when none does. */
export function impactOf(serving: ServingSet, findings: readonly ImpactFinding[]): ImpactEntry[] {
  const entries = new Map<StrategyRecord, ImpactEntry>();
  for (const finding of findings) {
    for (const named of serving.pages.get(finding.page) ?? []) {
      let entry = entries.get(named);
      if (entry === undefined) {
        entry = {
          type: named.type === "persona" ? "persona" : "journey",
          id: named.id,
          ...(named.title === undefined ? {} : { title: named.title }),
          ...(named.type === "journey" && named.lifecycle !== undefined ? { lifecycle: named.lifecycle } : {}),
          findings: 0,
          errors: 0,
          warnings: 0,
          notices: 0,
          pages: [],
        };
        entries.set(named, entry);
      }
      entry.findings += 1;
      if (finding.severity === "error") entry.errors += 1;
      else if (finding.severity === "warning") entry.warnings += 1;
      else entry.notices += 1;
      if (!entry.pages.includes(finding.file)) entry.pages.push(finding.file);
    }
  }
  return [...entries.values()].sort(worstFirst);
}

/** `a`, `a and b`, `a, b and c`. */
function listOf(values: readonly string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1] ?? ""}`;
}

function plural(n: number, one: string): string {
  return `${String(n)} ${one}${n === 1 ? "" : "s"}`;
}

/** `Serves maya (Maya, Documentation Engineer) and m5.`, or `undefined` for no records. */
export function servesSentence(records: readonly StrategyRecord[]): string | undefined {
  if (records.length === 0) return undefined;
  return `Serves ${listOf(records.map((r) => (r.title === undefined ? r.id : `${r.id} (${r.title})`)))}.`;
}

/** The pretty block: a heading, then one row per entry, padded to the widest id and title. Empty for no entries. */
export function impactLines(entries: readonly ImpactEntry[]): string[] {
  if (entries.length === 0) return [];
  const counts = SERVING_TYPES.flatMap((type) => {
    const n = entries.filter((e) => e.type === type).length;
    return n === 0 ? [] : [plural(n, type)];
  });
  const titleOf = (e: ImpactEntry): string =>
    [e.title, e.lifecycle !== undefined && RETIRED.has(e.lifecycle) ? `(${e.lifecycle})` : undefined]
      .filter((part) => part !== undefined)
      .join(" ");
  const idWidth = Math.max(...entries.map((e) => e.id.length));
  const titleWidth = Math.max(...entries.map((e) => titleOf(e).length));
  const rows = entries.map((e) => {
    const levels = [
      e.errors > 0 ? plural(e.errors, "error") : undefined,
      e.warnings > 0 ? plural(e.warnings, "warning") : undefined,
      e.notices > 0 ? plural(e.notices, "notice") : undefined,
    ].filter((level) => level !== undefined);
    return `  ${e.id.padEnd(idWidth)}   ${titleOf(e).padEnd(titleWidth)}   ${listOf(levels)} on ${plural(e.pages.length, "page")}`;
  });
  return [`The pages with findings serve ${counts.join(" and ")}.`, ...rows];
}
