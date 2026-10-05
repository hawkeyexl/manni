/**
 * Doc Detective's results file, read across a process boundary.
 *
 * The object is kept as Doc Detective wrote it, because `-f json` prints it
 * verbatim. Only the parts the verdict and the reports need are checked: the
 * test-level counts, and each step's result, description and line.
 */
import { relative } from "node:path";

/** One level's counts in Doc Detective's `summary`. */
export interface ResultCounts {
  pass: number;
  fail: number;
  warning: number;
  skipped: number;
}

/** Doc Detective's results object, as it wrote it. */
export type DocDetectiveResults = Record<string, unknown>;

/** A step that FAILed or WARNed, named by the page it came from. */
export interface TestFinding {
  /** The page, posix and relative to the run's working directory. */
  file: string;
  /** The step's line in the page, when Doc Detective located it. */
  line?: number;
  result: "FAIL" | "WARNING";
  description: string;
}

export const ZERO_COUNTS: ResultCounts = { pass: 0, fail: 0, warning: 0, skipped: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function counts(value: unknown): ResultCounts | undefined {
  if (!isRecord(value)) return undefined;
  const out = { ...ZERO_COUNTS };
  for (const key of Object.keys(out) as (keyof ResultCounts)[]) {
    const n = value[key];
    if (typeof n !== "number") return undefined;
    out[key] = n;
  }
  return out;
}

/**
 * Parse a results file. `null` is what Doc Detective writes when it found no
 * tests. `undefined` is a file that is not a results object at all.
 */
export function parseResults(text: string): DocDetectiveResults | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null) return null;
  if (!isRecord(parsed) || !isRecord(parsed["summary"])) return undefined;
  if (counts(parsed["summary"]["tests"]) === undefined) return undefined;
  if (!Array.isArray(parsed["specs"])) return undefined;
  return parsed;
}

/** The test-level counts, which the summary line reports. */
export function testCounts(results: DocDetectiveResults | null): ResultCounts {
  if (results === null || !isRecord(results["summary"])) return { ...ZERO_COUNTS };
  return counts(results["summary"]["tests"]) ?? { ...ZERO_COUNTS };
}

/** Whether anything failed, at any level Doc Detective counts. */
export function anyFailed(results: DocDetectiveResults | null): boolean {
  if (results === null) return false;
  const summary = results["summary"];
  if (!isRecord(summary)) return false;
  return Object.values(summary).some((level) => (counts(level)?.fail ?? 0) > 0);
}

/** Every FAIL and WARNING step, in the order Doc Detective ran them. */
export function collectFindings(results: DocDetectiveResults | null, cwd: string): TestFinding[] {
  if (results === null) return [];
  const out: TestFinding[] = [];
  for (const spec of records(results["specs"])) {
    for (const test of records(spec["tests"])) {
      const contentPath = test["contentPath"] ?? spec["contentPath"];
      // Without a contentPath the file is unknown, and `""` says so: the
      // github reporter then leaves `file=` off the annotation.
      const file =
        typeof contentPath === "string"
          ? relative(cwd, contentPath).replace(/\\/g, "/")
          : "";
      for (const context of records(test["contexts"])) {
        for (const step of records(context["steps"])) {
          const result = step["result"];
          if (result !== "FAIL" && result !== "WARNING") continue;
          const location = step["location"];
          const line = isRecord(location) ? location["line"] : undefined;
          const description = step["resultDescription"];
          out.push({
            file,
            ...(typeof line === "number" ? { line } : {}),
            result,
            description: typeof description === "string" ? description : "",
          });
        }
      }
    }
  }
  return out;
}
