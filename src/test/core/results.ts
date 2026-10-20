/**
 * Doc Detective's results file, read across a process boundary.
 *
 * The object is kept as Doc Detective wrote it, because `-f json` prints it
 * verbatim. Only the parts the verdict and the reports need are checked: the
 * test-level counts, and each step's result, description, line and action.
 */
import { relative } from "node:path";
import type { Guidance } from "../../shared/guidance.js";

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
  /** Doc Detective's `resultDescription`, as it wrote it. */
  description: string;
  /** The Doc Detective action the step ran, such as `runShell`, when it is one Doc Detective documents. */
  action?: string;
  /** `Doc Detective`, the action, the step's own `description` and the action's guide. */
  guidance?: Guidance | null;
}

/** The step actions Doc Detective documents, each on a page of its own under `ACTIONS_GUIDE`. */
const ACTIONS = new Set([
  "checkLink",
  "click",
  "dragAndDrop",
  "find",
  "goTo",
  "httpRequest",
  "loadCookie",
  "loadVariables",
  "record",
  "runCode",
  "runShell",
  "saveCookie",
  "screenshot",
  "stopRecord",
  "type",
  "wait",
]);

// Each page is the action name lowercased with nothing between the words:
// `draganddrop`, `checklink`, `httprequest`. Kebab-case slugs 404 there.
const ACTIONS_GUIDE = "https://docs.doc-detective.com/docs/actions/";

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

/**
 * Every FAIL and WARNING step, in the order Doc Detective ran them. A step
 * that fails the same way in several contexts, one per browser or platform,
 * is one finding.
 */
export function collectFindings(results: DocDetectiveResults | null, cwd: string): TestFinding[] {
  if (results === null) return [];
  const out: TestFinding[] = [];
  const seen = new Set<string>();
  for (const spec of records(results["specs"])) {
    for (const test of records(spec["tests"])) {
      const contentPath = test["contentPath"] ?? spec["contentPath"];
      // Without a contentPath the file is unknown, and `""` says so: the
      // github reporter then leaves `file=` off the annotation. A URL input
      // is reported as Doc Detective names it; only a file path is relative.
      const file =
        typeof contentPath !== "string"
          ? ""
          : /^[a-z][a-z0-9+.-]*:\/\//i.test(contentPath)
            ? contentPath
            : relative(cwd, contentPath).replace(/\\/g, "/");
      for (const context of records(test["contexts"])) {
        for (const step of records(context["steps"])) {
          const result = step["result"];
          if (result !== "FAIL" && result !== "WARNING") continue;
          const location = step["location"];
          const line = isRecord(location) ? location["line"] : undefined;
          const resultDescription = step["resultDescription"];
          const description = typeof resultDescription === "string" ? resultDescription : "";
          const action = Object.keys(step).find((key) => ACTIONS.has(key));
          const key = JSON.stringify([file, line, action, result, description]);
          if (seen.has(key)) continue;
          seen.add(key);
          const stated = step["description"];
          out.push({
            file,
            ...(typeof line === "number" ? { line } : {}),
            result,
            description,
            ...(action === undefined ? {} : { action }),
            guidance: {
              id: "Doc Detective",
              rule: action ?? null,
              description: typeof stated === "string" && stated !== "" ? stated : null,
              guide: action === undefined ? null : `${ACTIONS_GUIDE}${action.toLowerCase()}`,
            },
          });
        }
      }
    }
  }
  return out;
}
