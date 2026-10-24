/**
 * The journey and persona records `manni test tasks` reads (plan §4.3).
 *
 * Which records exist, and which id names which, is the strategy domain's
 * answer: its loader reads the config's collections and its index resolves an
 * id. Each record used is then re-read through meta's extractor for the
 * fields strategy does not keep, with the line each sits on. A persona's body
 * is never read into anything.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { extractorForExtension } from "../../meta/internal.js";
import type { ConfigFile } from "../../shared/config-file.js";
import { errorMessage, ToolError } from "../../shared/errors.js";
import { indexSet, type StrategyIndex } from "../../strategy/core/check.js";
import { unknownRecordMessage } from "../../strategy/commands/get.js";
import { loadStrategy } from "../../strategy/commands/run.js";
import type { RecordType, StrategyRecord, StrategySet } from "../../strategy/types.js";
import { artifactEvalsErrors } from "../../tracevals/evals/schema.js";
import { normalizeEntry } from "../../tracevals/evals/extract.js";
import { graderFor } from "../../tracevals/graders/registry.js";
import { TestError } from "../errors.js";
import type { SourceLocation, TaskJourney, TaskPersona } from "./task-types.js";

/** The graders a task's eval may name. */
export const TASK_GRADERS = [
  "ai",
  "command",
  "regex",
  "file-access",
  "tool-usage",
  "tool-order",
  "turn-count",
  "cost",
] as const;

const GRADER_LIST = `${TASK_GRADERS.slice(0, -1).join(", ")} or ${TASK_GRADERS.at(-1) ?? ""}`;

export interface TaskRecords {
  /** `--journey <id>`: the journey, or a usage error. */
  journey(id: string): Promise<TaskJourney>;
  /** `--persona <id>`, or a name in a journey's `personas:` when `journey` is given. */
  persona(id: string, journey?: TaskJourney): Promise<TaskPersona>;
  /** Every journey that declares `evals:`, in set order. */
  golden(): Promise<TaskJourney[]>;
}

/** The fields read off a record file: its frontmatter and where each value sits. */
interface RecordFile {
  file: string;
  /** The config file's directory, which the record's paths resolve against. */
  dir: string;
  data: Record<string, unknown>;
  lineFor: (pointer: string) => number | undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** A string or a list of strings, as a list. */
function list(value: unknown): string[] {
  if (typeof value === "string") return value.trim() === "" ? [] : [value];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

/** A sibling domain's `ToolError` reported as this domain's. */
async function asTestError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ToolError && !(err instanceof TestError)) throw new TestError(err.message);
    throw err;
  }
}

/**
 * The records in the config's collections. A config with no collections holds
 * none, which is not an error until a record is asked for.
 */
export function loadTaskRecords(file: ConfigFile | null, cwd: string): TaskRecords {
  const configDir = file?.dir ?? cwd;
  let loaded: Promise<{ set: StrategySet; index: StrategyIndex; base: string }> | undefined;
  const load = (): Promise<{ set: StrategySet; index: StrategyIndex; base: string }> => {
    loaded ??= asTestError(async () => {
      if (file === null || file.collections.length === 0) {
        const set: StrategySet = { records: [], references: [] };
        return { set, index: indexSet(set), base: configDir };
      }
      const { set, run } = await loadStrategy({ cwd, inputs: [], configPath: file.path, allowEmpty: true });
      return { set, index: indexSet(set), base: run.base };
    });
    return loaded;
  };

  const readRecord = async (record: StrategyRecord, base: string): Promise<RecordFile> => {
    const abs = resolve(base, record.file);
    const file = relative(configDir, abs).split(sep).join("/");
    const extractor = extractorForExtension(extname(abs));
    if (extractor === undefined) throw new TestError(`${file}: no reader for its extension.`);
    try {
      const extracted = extractor.extract(await readFile(abs, "utf8"), abs);
      return { file, dir: configDir, data: extracted.data, lineFor: extracted.lineFor };
    } catch (err) {
      throw new TestError(`${file}: could not be read: ${errorMessage(err)}`);
    }
  };

  const byId = async (id: string, type: RecordType, flag: string): Promise<RecordFile & { record: StrategyRecord }> => {
    const { set, index, base } = await load();
    const record = index.anyWithId(id);
    if (record === undefined) throw new TestError(unknownRecordMessage(id, set.records));
    if (record.type !== type) throw new TestError(`"${id}" is a ${record.type}; ${flag} takes a ${type}.`);
    return { record, ...(await readRecord(record, base)) };
  };

  const persona = async (id: string, journey?: TaskJourney): Promise<TaskPersona> => {
    if (journey === undefined) {
      const { record, ...rf } = await byId(id, "persona", "--persona");
      return personaOf(record.id, rf);
    }
    const { index, base } = await load();
    const record = index.resolve("persona", id);
    if (record === undefined) {
      throw new TestError(`journey "${journey.id}" names persona "${id}", which has no record.`);
    }
    return personaOf(record.id, await readRecord(record, base));
  };

  return {
    journey: async (id) => {
      const { record, ...rf } = await byId(id, "journey", "--journey");
      return journeyOf(record.id, rf);
    },
    persona,
    golden: async () => {
      const { set, base } = await load();
      const out: TaskJourney[] = [];
      for (const record of set.records) {
        if (record.type !== "journey") continue;
        const rf = await readRecord(record, base);
        if (rf.data["evals"] === undefined) continue;
        out.push(journeyOf(record.id, rf));
      }
      return out;
    },
  };
}

function at(rf: RecordFile, pointer: string): SourceLocation {
  return { file: rf.file, line: rf.lineFor(pointer) ?? 1 };
}

function personaOf(id: string, rf: RecordFile): TaskPersona {
  const { data } = rf;
  const title = text(data["title"]);
  const description = text(data["description"]);
  const role = text(data["role"]);
  const teamContext = text(data["team-context"]);
  const raw = data["constraints"];
  const constraints = Array.isArray(raw)
    ? raw.flatMap((item: unknown, i) =>
        typeof item === "string" && item.trim() !== ""
          ? [{ text: item, location: at(rf, `/constraints/${String(i)}`) }]
          : [],
      )
    : list(raw).map((item) => ({ text: item, location: at(rf, "/constraints") }));
  return {
    id,
    file: rf.file,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(role === undefined ? {} : { role }),
    ...(teamContext === undefined ? {} : { teamContext }),
    proficiency: list(data["proficiency"]),
    prerequisites: list(data["prerequisites"]),
    goals: list(data["goals"]),
    pains: list(data["pains"]),
    constraints,
  };
}

function journeyOf(id: string, rf: RecordFile): TaskJourney {
  const { data } = rf;
  const title = text(data["title"]);
  const trigger = text(data["trigger"]);
  const success = text(data["success-criteria"]);
  const entryPoint = text(data["entry-point"]);
  const workspace = text(data["workspace"]);
  // A path the record names that is not there is a broken record, whatever a flag overrides.
  for (const [key, value] of [["entry-point", entryPoint], ["workspace", workspace]] as const) {
    if (value === undefined || /^https?:\/\//i.test(value) || existsSync(resolve(rf.dir, value))) continue;
    throw new TestError(`${rf.file}:${String(rf.lineFor(`/${key}`) ?? 1)}: ${key} "${value}" does not exist.`);
  }
  return {
    id,
    file: rf.file,
    title: title ?? id,
    titleLocation: title === undefined ? { file: rf.file, line: 1 } : at(rf, "/title"),
    ...(trigger === undefined ? {} : { trigger }),
    ...(success === undefined ? {} : { successCriteria: { text: success, location: at(rf, "/success-criteria") } }),
    ...(entryPoint === undefined ? {} : { entryPoint }),
    ...(workspace === undefined ? {} : { workspace }),
    personas: list(data["personas"]),
    evals: journeyEvals(rf),
  };
}

/**
 * A journey's `evals:`, validated as tracevals validates an artifact's block,
 * plus what a task adds: an id on every entry, ids unique, and only the
 * graders a synthetic run can be graded by. The first problem is the error.
 */
function journeyEvals(rf: RecordFile): TaskJourney["evals"] {
  const raw = rf.data["evals"];
  if (raw === undefined) return [];
  const where = (pointer: string): string => `${rf.file}:${String(rf.lineFor(pointer) ?? 1)}`;
  if (!Array.isArray(raw)) throw new TestError(`${where("/evals")}: evals must be a list of eval entries.`);

  const seen = new Map<string, number>();
  for (const [i, entry] of raw.entries()) {
    const n = String(i);
    const obj: Record<string, unknown> =
      typeof entry === "object" && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
    const id = text(obj["id"]);
    if (id === undefined) throw new TestError(`${where(`/evals/${n}`)}: evals[${n}] needs an id.`);
    const grader = typeof obj["grader"] === "string" ? obj["grader"] : "ai";
    if (!(TASK_GRADERS as readonly string[]).includes(grader)) {
      throw new TestError(
        `${where(`/evals/${n}/grader`)}: evals[${n}].grader "${grader}" cannot grade a task. Use ${GRADER_LIST}.`,
      );
    }
    const first = seen.get(id);
    if (first !== undefined) {
      throw new TestError(`${where(`/evals/${n}/id`)}: evals[${n}].id "${id}" repeats evals[${String(first)}].`);
    }
    seen.set(id, i);
  }

  // The vocabulary is document-rooted, so the list is validated where an
  // artifact keeps it, and each pointer is mapped back to the journey's.
  const errors = artifactEvalsErrors({ metadata: { evals: raw } }, (pointer) =>
    rf.lineFor(pointer.replace(/^\/metadata/, "")),
  );
  const firstError = errors[0];
  if (firstError !== undefined) {
    const path = firstError.instancePath.replace(/^\/metadata/, "");
    const m = /^\/evals\/(\d+)(.*)$/.exec(path);
    const label = m === null ? "evals" : `evals[${m[1] ?? ""}]${(m[2] ?? "").replaceAll("/", ".")}`;
    throw new TestError(`${where(path)}: ${label} ${firstError.message}.`);
  }

  return raw.map((entry: unknown, i) => {
    const n = String(i);
    const normalized = normalizeEntry(entry, i);
    const validate = graderFor(normalized.grader)?.validateOptions;
    const invalid = validate?.(normalized.options ?? {});
    if (invalid !== undefined) {
      const pointer = normalized.options === undefined ? `/evals/${n}` : `/evals/${n}/options`;
      throw new TestError(`${where(pointer)}: evals[${n}] ${invalid}`);
    }
    return { entry: normalized, location: at(rf, `/evals/${n}`) };
  });
}
