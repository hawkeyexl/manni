/**
 * Eval extraction: read the `metadata.evals` block from an artifact via the
 * metadata library and validate the artifact's whole front matter against
 * `manni:artifact-evals:1.0.0-proposal.2`. Invalid blocks are reported as
 * errors with source line numbers, never silently ignored (ADR 01002).
 *
 * The vocabulary is the metadata tool's; this tool implements behavior
 * against it (ADR 01010). The schema is document-rooted — `metadata` stays
 * open so other tools' members pass untouched — which is why validation is
 * handed the entire front matter object rather than the `evals` value alone.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  extractFrontmatter,
  Validator,
  type FieldError,
} from "../../meta/index.js";
import { packageRoot } from "../../shared/package-root.js";
import type { ResolvedArtifact } from "../artifacts/types.js";
import { TracevalsError } from "../types.js";
import type { TraceTarget } from "../core/target.js";

export const ARTIFACT_EVALS_SCHEMA_ID = "manni:artifact-evals:1.0.0-proposal.2";

const SCHEMA_FILE = "artifact-evals-1.0.0-proposal.2.json";

let schemaPath: string | undefined;

/**
 * Absolute path of the packaged schema (works from src and dist).
 *
 * The schema ships beside the code at `schemas/tracevals/`, reached from the
 * package root rather than from this module's own directory: `src/tracevals/
 * evals/` sits three hops down and tsup flattens `dist/` to one, and keying
 * off the directory name would silently return a path that does not exist
 * after a rename, so schema validation would quietly stop happening. The path
 * is still probed, so a missing file is a loud failure. Memoized, so the stat
 * cost is paid once per process rather than once per artifact.
 */
export function artifactEvalsSchemaPath(): string {
  if (schemaPath !== undefined) return schemaPath;
  const candidate = join(
    packageRoot(import.meta.url),
    "schemas",
    "tracevals",
    SCHEMA_FILE,
  );
  if (!existsSync(candidate)) {
    throw new TracevalsError(
      `cannot locate ${SCHEMA_FILE}; looked at ${candidate}. ` +
        "The package ships it under schemas/tracevals/ — reinstall if it is missing.",
    );
  }
  schemaPath = candidate;
  return candidate;
}

export type Severity = "error" | "warning" | "info";

/**
 * `capability` probes a boundary and is expected to fail sometimes;
 * `regression` protects behavior that already works. Reported, not enforced.
 */
export type EvalType = "capability" | "regression";

export interface EvalEntry {
  /** Stable identifier. Required by the schema on object entries. */
  id: string;
  /** Absent on graders whose options say everything. */
  assertion?: string;
  type: EvalType;
  /** "ai", "human", "command", or a deterministic grader kind. */
  grader: string;
  /** Overrides the configured judge provider for this eval only. */
  provider?: string;
  /** Overrides the judge model for this eval only; a CLI --model still wins. */
  model?: string;
  /** Ensemble runs for this eval only; a CLI --runs still wins. */
  runs?: number;
  /** Which bytes the grader receives. Absent means the whole transcript. */
  target?: TraceTarget;
  /** Relative contribution to the run's pass rate. Never changes the outcome. */
  weight?: number;
  options?: Record<string, unknown>;
  severity: Severity;
  evidence?: string;
  examples?: { pass?: string[]; fail?: string[] };
  /** Per-entry opt-out; reported as skipped, never silently dropped. */
  skip?: boolean;
  /**
   * Maps a `tool:*` grader's own severities onto eval severities. Accepted so
   * one entry vocabulary ports across both docmeta eval schemas; ignored here,
   * because this repo implements no `tool:*` graders.
   */
  severityMap?: Record<string, Severity>;
  /** Command-graded evals: argv, with `{trace}` substituted at grade time. */
  command?: string[];
  successExitCodes?: number[];
  timeoutMs?: number;
  /** sha256 of `assertion` when the check script was generated. */
  generatedAssertionHash?: string;
}

export interface ExtractedEvals {
  evals: EvalEntry[];
  /** Schema violations in the front matter, with line numbers when known. */
  errors: FieldError[];
  /** Whether a `metadata.evals` block was present. */
  declared: boolean;
  /** `metadata.eval-skip` — skip this artifact's evals entirely. */
  skip: boolean;
  /**
   * Which model proposed each eval, by eval id, from
   * `metadata.eval-provenance`. Written by `fill` and, until now, never read
   * back: it is what lets the judge notice it is grading an assertion it
   * wrote itself, which is bias on the *criterion* rather than on the session.
   *
   * A list because one id may appear under several `generated-by` entries —
   * a re-fill by a second model extends the block rather than replacing it.
   */
  proposedBy: Map<string, string[]>;
}

/**
 * Members of `metadata` this vocabulary claims. The schema cannot reject the
 * rest: `metadata` is the host tool's extension bag and must stay open, so a
 * misspelled `eval-skpi` would validate and quietly do nothing. Reserving the
 * `eval` prefix at run time restores the closed block's loud-typo property.
 */
const RESERVED_EVAL_KEYS = new Set(["evals", "eval-skip", "eval-provenance"]);

/** A YAML mapping, as opposed to a list, a scalar, or null. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const validator = new Validator();

export async function extractEvals(
  artifact: ResolvedArtifact,
): Promise<ExtractedEvals> {
  const extracted = extractFrontmatter(artifact.content, "markdown");
  const metadata = extracted.data.metadata;
  // The schema types `metadata` as an object. Anything else — a string, a
  // list, a number — is a fault the validator must report, so it is kept
  // distinct from "absent" rather than folded into it.
  const bag = isPlainObject(metadata) ? metadata : undefined;
  const declared = extracted.present && bag !== undefined && bag.evals !== undefined;

  if (!extracted.present) {
    return { evals: [], errors: [], declared: false, skip: false, proposedBy: new Map() };
  }

  const typoErrors = reservedPrefixErrors(bag, extracted.lineFor);
  if (typoErrors.length > 0) {
    return { evals: [], errors: typoErrors, declared, skip: false, proposedBy: new Map() };
  }

  // Skip the validator only for an artifact this vocabulary has nothing to say
  // about: `metadata` absent, or a well-formed object claiming none of its
  // keys. A `metadata` that is not an object still has to be validated (the
  // schema types it), and so does one carrying only `eval-provenance` — the
  // block is malformed-or-not either way, and a malformed one is never
  // silently ignored.
  const wellFormed = metadata === undefined || bag !== undefined;
  const claimsNothing =
    bag === undefined ||
    ![...RESERVED_EVAL_KEYS].some((key) => bag[key] !== undefined);
  if (wellFormed && claimsNothing) {
    return {
      evals: [],
      errors: [],
      declared: false,
      skip: false,
      proposedBy: new Map(),
    };
  }

  const errors = await validator.validate(
    extracted.data,
    [artifactEvalsSchemaPath()],
    extracted.lineFor,
  );
  if (errors.length > 0) {
    return { evals: [], errors, declared, skip: false, proposedBy: new Map() };
  }

  // Validation passed, so `metadata` is an object if it is present at all.
  const valid = bag ?? {};
  const skip = valid["eval-skip"] === true;
  return {
    evals: normalizeBlock(valid.evals),
    errors: [],
    declared,
    skip,
    proposedBy: readProvenance(valid["eval-provenance"]),
  };
}

/**
 * `metadata.eval-provenance` as eval id → the models that proposed it.
 *
 * Tolerant by design: the block has already passed the schema, and a shape it
 * did not constrain is not worth failing a run over — the worst outcome of
 * ignoring a malformed entry is one missing bias warning, while the worst
 * outcome of throwing is a run that will not start.
 */
function readProvenance(raw: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const by = entry["generated-by"];
    if (typeof by !== "string" || by.length === 0) continue;
    const ids = entry.evals;
    if (!Array.isArray(ids)) continue;
    for (const id of ids) {
      if (typeof id !== "string") continue;
      const list = out.get(id) ?? [];
      if (!list.includes(by)) list.push(by);
      out.set(id, list);
    }
  }
  return out;
}

/**
 * A key inside `metadata` that starts with `eval` but is not one this
 * vocabulary claims. Reported against the offending key so the fix is obvious.
 */
function reservedPrefixErrors(
  bag: Record<string, unknown> | undefined,
  lineFor: (pointer: string) => number | undefined,
): FieldError[] {
  if (bag === undefined) return [];
  const errors: FieldError[] = [];
  for (const key of Object.keys(bag)) {
    // Detection is case-insensitive while the allowlist is not, deliberately:
    // YAML keys are case-sensitive, so `Eval-skip` is never a valid spelling of
    // `eval-skip` and should be reported rather than accepted. Do not "fix" the
    // asymmetry by making RESERVED_EVAL_KEYS case-insensitive — that would
    // silently accept exactly the misspellings this guard exists to catch.
    if (!/^eval/i.test(key) || RESERVED_EVAL_KEYS.has(key)) continue;
    const line = lineFor(`/metadata/${key}`);
    errors.push({
      schema: ARTIFACT_EVALS_SCHEMA_ID,
      instancePath: `/metadata/${key}`,
      message: `unrecognized "eval" key; this vocabulary claims ${[...RESERVED_EVAL_KEYS].join(", ")}`,
      keyword: "additionalProperties",
      subject: key,
      ...(line !== undefined ? { line } : {}),
    });
  }
  return errors;
}

/**
 * The block is one assertion as a string, or a list of entries. An absent key
 * yields nothing — an artifact with no evals omits it rather than declaring an
 * empty list, which the schema also refuses.
 */
function normalizeBlock(raw: unknown): EvalEntry[] {
  if (typeof raw === "string") return [normalizeEntry(raw, 0)];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => normalizeEntry(entry, index));
}

function normalizeEntry(raw: unknown, index: number): EvalEntry {
  // The string shorthand is the legitimately id-less form, so its identity is
  // positional. Object entries carry a required `id` precisely because a
  // position-derived name breaks the history join whenever entries move.
  if (typeof raw === "string") {
    return {
      id: `eval-${index + 1}`,
      assertion: raw,
      type: "regression",
      grader: "ai",
      severity: "error",
    };
  }

  const obj = raw as Record<string, unknown>;
  const entry: EvalEntry = {
    id: obj.id as string,
    // Optional since artifact-evals proposal.2: a `tool-usage` criterion says
    // everything in `options`, and demanding a sentence no grader reads was
    // the one place this vocabulary disagreed with the page side. The schema
    // still requires it for `ai`, `human`, and a bare entry (which defaults to
    // `ai`), so anything that actually needs an assertion still has one.
    ...(typeof obj.assertion === "string" ? { assertion: obj.assertion } : {}),
    type: (obj.type as EvalType | undefined) ?? "regression",
    grader: typeof obj.grader === "string" ? obj.grader : "ai",
    severity: (obj.severity as Severity | undefined) ?? "error",
  };
  if (typeof obj.provider === "string") entry.provider = obj.provider;
  if (typeof obj.model === "string") entry.model = obj.model;
  if (typeof obj.runs === "number") entry.runs = obj.runs;
  if (typeof obj.weight === "number") entry.weight = obj.weight;
  if (typeof obj.target === "string" || (obj.target && typeof obj.target === "object")) {
    entry.target = obj.target as TraceTarget;
  }
  if (obj.options && typeof obj.options === "object") {
    entry.options = obj.options as Record<string, unknown>;
  }
  if (typeof obj.evidence === "string") entry.evidence = obj.evidence;
  if (obj.examples && typeof obj.examples === "object") {
    entry.examples = normalizeExamples(obj.examples as Record<string, unknown>);
  }
  if (obj.skip === true) entry.skip = true;
  if (obj["severity-map"] && typeof obj["severity-map"] === "object") {
    entry.severityMap = obj["severity-map"] as Record<string, Severity>;
  }
  if (Array.isArray(obj.command)) entry.command = obj.command as string[];
  if (Array.isArray(obj["success-exit-codes"])) {
    entry.successExitCodes = obj["success-exit-codes"] as number[];
  }
  if (typeof obj["timeout-ms"] === "number") {
    entry.timeoutMs = obj["timeout-ms"];
  }
  if (typeof obj["generated-assertion-hash"] === "string") {
    entry.generatedAssertionHash = obj["generated-assertion-hash"];
  }
  return entry;
}

/** Anchors are one example or a list of them; downstream sees only the list. */
function normalizeExamples(
  raw: Record<string, unknown>,
): { pass?: string[]; fail?: string[] } {
  const out: { pass?: string[]; fail?: string[] } = {};
  const pass = anchorList(raw.pass);
  const fail = anchorList(raw.fail);
  if (pass) out.pass = pass;
  if (fail) out.fail = fail;
  return out;
}

function anchorList(raw: unknown): string[] | undefined {
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw as string[];
  return undefined;
}
