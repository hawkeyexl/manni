/**
 * Readers (proposal 0111): an `ai` eval with `options: { readers: personas }`
 * is judged as the page's personas.
 *
 * The feature runs on one eval only when all four hold: the run judges, the
 * eval is `ai` and carries `readers: personas`, at least one id in the page's
 * `personas:` resolves to a persona record in a declared collection, and the
 * page is not itself a record. Everywhere else nothing here sets anything, so
 * the prompt, the cache key, the output and the exit are today's.
 *
 * The records come from the strategy domain's own loader, over every declared
 * collection, so ids, the file-stem default and sidecar merging cannot drift
 * from `strategy check`. They are read only when some eval carries an
 * `options.readers` key, and reading them prints nothing.
 */
import { resolve } from "node:path";
import { RECORD_TYPES, loadStrategySet, resolveStrategyRun } from "../../strategy/index.js";
import { optionalEnum } from "../graders/options.js";
import { renderReaders, type ReaderRecord } from "../judge/prompt.js";
import type { DocevalsConfig } from "./config.js";
import type { RunProblem } from "./engine.js";
import type { ResolvedEval, ResolvedPagePlan } from "./resolve.js";

/** The one value `options.readers` takes. */
const READERS_VALUES = ["personas"] as const;

/** A persona record, with the absolute path of the file it was read from. */
export interface PersonaRecord extends ReaderRecord {
  path: string;
}

/** Reads the run's persona records. Injected by tests. */
export type LoadPersonas = (config: DocevalsConfig, cwd: string) => Promise<PersonaRecord[]>;

/**
 * Every persona record in every declared collection. A run with no config,
 * or a config declaring no collection, has none, and reads nothing.
 */
export const loadPersonaRecords: LoadPersonas = async (config, cwd) => {
  if (config.configSource === null || config.collections.length === 0) return [];
  const run = await resolveStrategyRun({ cwd, inputs: [], configPath: config.configSource });
  if (run.inputs.length === 0) return [];
  const set = await loadStrategySet({
    run,
    exclude: [...new Set(run.collections.flatMap((c) => c.exclude))],
    allowEmpty: true,
  });
  return set.records
    .filter((r) => r.type === "persona")
    .map((r) => ({ id: r.id, data: r.data, path: resolve(run.base, r.file) }));
};

function isJudgedOptIn(plan: ResolvedPagePlan, ev: ResolvedEval): boolean {
  return !plan.skip && !ev.skip && ev.grader === "ai" && Object.hasOwn(ev.options, "readers");
}

/** `personas:` as a string or a list of strings, as `strategy check` reads it. */
function personaIds(value: unknown): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function isRecordPage(data: Record<string, unknown>): boolean {
  return (RECORD_TYPES as readonly unknown[]).includes(data["type"]);
}

/**
 * Give each opted-in eval its readers, in place, and return the one problem
 * this can raise: a `readers` value other than `personas`, where persona
 * records exist. Call it only in a judged run.
 */
export async function resolveReaders(
  plans: ResolvedPagePlan[],
  config: DocevalsConfig,
  cwd: string,
  load: LoadPersonas = loadPersonaRecords,
): Promise<RunProblem[]> {
  if (!plans.some((plan) => plan.evals.some((ev) => isJudgedOptIn(plan, ev)))) return [];
  const records = await load(config, cwd);
  if (records.length === 0) return [];

  // Ids match ignoring case. A duplicate id resolves to the record read first;
  // `strategy check` already reports it.
  const byId = new Map<string, PersonaRecord>();
  for (const record of records) {
    const key = record.id.toLowerCase();
    if (!byId.has(key)) byId.set(key, record);
  }

  const problems: RunProblem[] = [];
  for (const plan of plans) {
    const opted = plan.evals.filter((ev) => isJudgedOptIn(plan, ev));
    if (opted.length === 0) continue;
    for (const ev of opted) {
      const invalid = optionalEnum(ev.options, "readers", READERS_VALUES);
      if (invalid !== undefined) {
        problems.push({ file: plan.page.file, level: "error", message: `Eval "${ev.name}": ai ${invalid}` });
      }
    }

    const data = plan.page.frontmatter.data;
    if (isRecordPage(data)) continue;
    const readers = [
      ...new Set(
        personaIds(data["personas"]).flatMap((id) => {
          const record = byId.get(id.toLowerCase());
          return record === undefined ? [] : [record];
        }),
      ),
    ];
    if (readers.length === 0) continue;
    const section = renderReaders(readers);
    for (const ev of opted) {
      if (ev.options["readers"] !== "personas") continue;
      ev.readers = { personas: readers.map((r) => r.id), section, files: readers.map((r) => r.path) };
    }
  }
  return problems;
}
