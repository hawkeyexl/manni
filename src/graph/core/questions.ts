/**
 * A page's `sample-questions`, read into one shape (manni:ai-context:1.1.0,
 * proposal 0087). An item is a string, or an object whose `answers` pin the
 * body lines that answer it. `build` derives only the question text; `check`
 * reads the pins and the review state, which never reach the graph.
 *
 * Reading is lenient: `meta validate` owns the schema, so an item it would
 * refuse is skipped here, and a malformed pin is dropped, rather than failing
 * a build or a check over a shape another command already reports.
 */
import { existsSync, readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { isNode, isSeq, LineCounter, parseDocument } from "yaml";
import { parseLines, type PageLines } from "../../shared/pin.js";
import { GraphError } from "../types.js";
import questionsSchema from "./questions-schema.json" with { type: "json" };

/** One pinned answer: body lines of the page, and the pin over them. */
export interface AnswerPin {
  lines: PageLines;
  integrity?: string;
  /** `false` only when the pin says so; absent means confirmed. */
  reviewed: boolean;
}

export interface SampleQuestion {
  question: string;
  /** Empty for an unpinned question, which must find the page itself. */
  answers: AnswerPin[];
  /** `false` only when the item says so; absent means confirmed. */
  reviewed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPin(value: unknown): AnswerPin | undefined {
  if (!isRecord(value)) return undefined;
  const spec = value.lines;
  const lines =
    typeof spec === "number" || typeof spec === "string" ? parseLines(spec) : undefined;
  if (lines === undefined) return undefined;
  const integrity = value.integrity;
  return {
    lines,
    ...(typeof integrity === "string" ? { integrity } : {}),
    reviewed: value.reviewed !== false,
  };
}

function readItem(item: unknown): SampleQuestion | undefined {
  if (typeof item === "string") {
    return item === "" ? undefined : { question: item, answers: [], reviewed: true };
  }
  if (!isRecord(item) || typeof item.question !== "string") return undefined;
  const question = item.question;
  if (question === "") return undefined;
  const answers = Array.isArray(item.answers)
    ? item.answers.flatMap((a) => readPin(a) ?? [])
    : [];
  return { question, answers, reviewed: item.reviewed !== false };
}

/** The questions a `sample-questions` value holds: one item, or a list of them. */
export function readSampleQuestions(value: unknown): SampleQuestion[] {
  const items: unknown[] = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return items.flatMap((item) => readItem(item) ?? []);
}

/** One answer in a golden-set file: a pin on the page `file` names. */
export interface FileAnswerPin extends AnswerPin {
  /** The page, relative to the config file, as the item names it. */
  file: string;
}

/** One question in a golden-set file (proposal 0086). */
export interface FileQuestion {
  question: string;
  /** Empty for a known gap, a question the docs don't answer. */
  answers: FileAnswerPin[];
  reviewed: boolean;
  /** The item's own `language`, when it names one. */
  language?: string;
  /** The file line the item starts on, 1-based. */
  line: number;
}

let validateFile: ReturnType<Ajv2020["compile"]> | undefined;

/**
 * The questions of one golden-set file. `abs` is where it is read from, and
 * `label` is how messages name it. A missing file, a YAML error and a schema
 * failure are each a `GraphError`, an operational error: a golden set that
 * cannot be read gates nothing.
 */
export function readQuestionFile(abs: string, label: string): FileQuestion[] {
  if (!existsSync(abs)) {
    throw new GraphError(`graph.questionFiles names ${label}, which does not exist.`);
  }
  const counter = new LineCounter();
  const doc = parseDocument(readFileSync(abs, "utf8"), { lineCounter: counter });
  const [error] = doc.errors;
  if (error) throw new GraphError(`${label}: ${error.message}`);
  const value: unknown = doc.toJS() ?? [];
  validateFile ??= new Ajv2020({ allowUnionTypes: true }).compile(questionsSchema);
  if (!validateFile(value) || !Array.isArray(value)) {
    const [first] = validateFile.errors ?? [];
    const where = [first?.instancePath, first?.message ?? "is invalid"].filter(Boolean).join(" ");
    throw new GraphError(`${label}: ${where}.`);
  }
  const nodes = isSeq(doc.contents) ? doc.contents.items : [];
  return value.flatMap((item: unknown, n): FileQuestion[] => {
    if (!isRecord(item) || typeof item.question !== "string") return [];
    const node = nodes[n];
    const offset = isNode(node) ? node.range[0] : undefined;
    const answers = Array.isArray(item.answers)
      ? item.answers.flatMap((a: unknown): FileAnswerPin[] => {
          const pin = readPin(a);
          return pin && isRecord(a) && typeof a.file === "string" ? [{ ...pin, file: a.file }] : [];
        })
      : [];
    return [
      {
        question: item.question,
        answers,
        reviewed: item.reviewed !== false,
        ...(typeof item.language === "string" ? { language: item.language } : {}),
        line: offset === undefined ? 1 : counter.linePos(offset).line,
      },
    ];
  });
}

/**
 * A question as duplicates are compared: lowercased, punctuation dropped,
 * and runs of spaces folded to one.
 */
export function questionKey(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The share of a question its answer already says, past which it copies. */
export const COPIED_SHARE = 0.5;

/**
 * How many of the question's adjacent word pairs, lowercased, the text of its
 * answers also holds. Undefined under two words, where there is no pair to measure.
 */
export function copiedPairs(
  question: string,
  ...answers: string[]
): { copied: number; of: number } | undefined {
  const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const pairs = (list: string[]): string[] => list.slice(1).map((w, i) => `${list[i] ?? ""} ${w}`);
  const asked = pairs(words(question));
  if (asked.length === 0) return undefined;
  // Each answer on its own, so no pair spans two of them.
  const said = new Set(answers.flatMap((a) => pairs(words(a))));
  return { copied: asked.filter((p) => said.has(p)).length, of: asked.length };
}
