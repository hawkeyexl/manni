/**
 * A page's `sample-questions`, read into one shape (manni:ai-context:1.1.0,
 * proposal 0086). An item is a string, or an object whose `answers` pin the
 * body lines that answer it. `build` derives only the question text; `check`
 * reads the pins and the review state, which never reach the graph.
 *
 * Reading is lenient: `meta validate` owns the schema, so an item it would
 * refuse is skipped here, and a malformed pin is dropped, rather than failing
 * a build or a check over a shape another command already reports.
 */
import { parseLines, type PageLines } from "../../shared/pin.js";

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
