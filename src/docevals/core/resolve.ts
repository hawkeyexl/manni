/**
 * Resolution: merge a page's eval frontmatter with the central config into a
 * concrete per-page plan. Suites contribute named evals; page entries reference
 * them (with overrides) or define inline evals. Page entries win on id
 * collision.
 *
 * The page vocabulary is `docmeta:evals:1.0.0-proposal.2` — four flat
 * page-level keys (`evals`, `eval-suite`, `eval-skip`, `eval-provenance`) and a
 * reserved `eval-` prefix, rather than the closed `evals:` object 0.1 used. The
 * whole frontmatter object is validated, not a synthetic `{evals}`: the prefix
 * reservation is a claim about the page root, and it cannot be enforced from a
 * fragment.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
// Pages validate against the current schema, not the oldest one still shipped:
// 1.1.0 adds `weight`, `target`, `runs` and `model`, and validating against
// 1.0.0 would reject every page that uses them. 1.0.0 stays published and
// byte-frozen for consumers who pinned it; every page valid against it is
// valid against this.
import frontmatterSchema from "../../../schemas/docevals/frontmatter-1.1.0.json" with { type: "json" };
import type { EvalType, GraderKind, Severity } from "../types.js";
import {
  normalizeEvalDef,
  type DocevalsConfig,
  type EvalDef,
  type RawEvalDef,
} from "./config.js";
import type { PageFile } from "./discover.js";
import type { EvalTarget } from "./target.js";

export interface ResolvedEval {
  /** Kebab-case id, unique per page. */
  name: string;
  /** Suite this eval reports under ("default" when none applies). */
  suite: string;
  assertion?: string;
  type: EvalType;
  grader: GraderKind;
  /** Per-eval provider/agent override for `ai` evals. */
  provider?: string;
  evidence?: string;
  examples?: { pass?: string[]; fail?: string[] };
  command?: string[];
  successExitCodes: number[];
  timeoutMs?: number;
  generatedAssertionHash?: string;
  options: Record<string, unknown>;
  severity: Severity;
  severityMap?: Record<string, Severity>;
  /**
   * Relative contribution to its suite's pass rate. Defaults to 1, which is
   * what makes weighting inert until someone asks for it: a suite of
   * unweighted evals computes exactly the rate it always did.
   */
  weight: number;
  /** Which bytes the grader receives. Absent means the page body. */
  target?: EvalTarget;
  /** Judge model for this eval; a CLI --model still wins. */
  model?: string;
  /** Ensemble runs for this eval; a CLI --runs still wins. */
  runs?: number;
  /** Where the eval definition came from. */
  source: "config" | "page";
  skip: boolean;
}

export interface PageProblem {
  message: string;
  level: "error" | "warning";
  line?: number;
}

/** One model's claim about evals it proposed, and how sure it was. */
export interface EvalProvenance {
  generatedBy: string;
  evals?: string[];
  confidence?: Record<string, number>;
}

export interface ResolvedPagePlan {
  page: PageFile;
  /** Page-level skip (`eval-skip: true`). */
  skip: boolean;
  suite: string | null;
  /**
   * Model that generated this page's content, read from the page's top-level
   * `generated-by` (docmeta:ai-context). The judge warns when it matches the
   * judging model — self-preference bias.
   */
  generatedBy?: string;
  /** Unretired machine-proposal trail from `eval-provenance`. */
  provenance: EvalProvenance[];
  evals: ResolvedEval[];
  problems: PageProblem[];
}

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const validateFrontmatter = ajv.compile(frontmatterSchema);

interface FrontmatterEvalRef {
  use: string;
  type?: EvalType;
  skip?: boolean;
  severity?: Severity;
  /**
   * How much this check counts *for this page*. The reference form is how
   * most pages join a suite at all, so a weight the schema accepts and the
   * merge drops would score the page at the corpus default without saying so.
   */
  weight?: number;
  options?: Record<string, unknown>;
}

type FrontmatterEvalEntry =
  | string
  | FrontmatterEvalRef
  | (RawEvalDef & { id: string; skip?: boolean });

interface RawProvenanceEntry {
  "generated-by": string;
  evals?: string[];
  confidence?: Record<string, number>;
}

/** The four page keys this vocabulary claims, plus the one it borrows. */
interface EvalFrontmatter {
  evals?: string | FrontmatterEvalEntry[];
  "eval-suite"?: string;
  "eval-skip"?: boolean;
  "eval-provenance"?: RawProvenanceEntry[];
  "generated-by"?: string;
}

/**
 * `evals` is one assertion string or a list of entries. Normalize to the list;
 * a bare string is an ai-judged assertion at error severity, and it has no id
 * of its own — the string shorthand is the legitimately id-less form.
 */
function evalEntries(raw: EvalFrontmatter["evals"]): FrontmatterEvalEntry[] {
  if (raw === undefined) return [];
  return typeof raw === "string" ? [raw] : raw;
}

function fromDef(
  name: string,
  suite: string,
  def: EvalDef,
  source: "config" | "page",
): ResolvedEval {
  return {
    name,
    suite,
    assertion: def.assertion,
    type: def.type ?? "regression",
    grader: (def.grader ?? "ai") as GraderKind,
    provider: def.provider,
    evidence: def.evidence,
    examples: def.examples,
    command: def.command,
    successExitCodes: def.successExitCodes ?? [0],
    timeoutMs: def.timeoutMs,
    generatedAssertionHash: def.generatedAssertionHash,
    options: def.options ?? {},
    severity: def.severity ?? "error",
    severityMap: def.severityMap,
    weight: def.weight ?? 1,
    target: def.target,
    model: def.model,
    runs: def.runs,
    source,
    skip: false,
  };
}

/**
 * A name for a string-shorthand eval, derived from its position.
 *
 * Position-derived names orphan cached verdicts when entries move, which is
 * why object entries must carry an explicit `id`. The shorthand has no id by
 * design, so it accepts that cost in exchange for being one line.
 *
 * `taken` is every name already claimed on this page. Without it a derived
 * name can collide with an explicit `id` of the same spelling, and the Map
 * write silently drops one of two evals the author declared — a page checking
 * less than it says while the run stays green.
 */
function shorthandName(index: number, taken: ReadonlySet<string>): string {
  const base = `assertion-${index + 1}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The page-level keys this vocabulary claims, for the reservation message. */
const RESERVED_KEYS = ["eval-suite", "eval-skip", "eval-provenance"] as const;

/**
 * A schema error, in words.
 *
 * The `eval-` prefix reservation is expressed as a `patternProperties` entry
 * whose subschema is `false`, and Ajv reports that as "boolean schema is
 * false" — which names neither the key nor the fix. The reservation exists
 * precisely to make a typo loud, so it gets a sentence rather than Ajv's
 * internals.
 */
function describeError(e: ErrorObject): string {
  if (e.keyword === "false schema" && e.instancePath.startsWith("/eval-")) {
    const key = e.instancePath.slice(1);
    return (
      `unknown key "${key}". The "eval-" prefix is reserved, and the only ` +
      `settings under it are ${RESERVED_KEYS.join(", ")} — so a typo is an ` +
      `error here rather than a key nothing reads.`
    );
  }
  return e.message ?? "is invalid";
}

/** Resolve one page's plan. Never throws; problems are collected per page. */
export function resolvePage(
  page: PageFile,
  config: DocevalsConfig,
): ResolvedPagePlan {
  const problems: PageProblem[] = [];
  const empty = {
    page,
    skip: false,
    suite: null,
    provenance: [],
    evals: [],
    problems,
  };
  if (page.extractError) {
    problems.push({ message: page.extractError, level: "error", line: 1 });
    return empty;
  }

  const data = page.frontmatter.data;
  // The whole object, not just the eval keys: `eval-` prefix reservation is a
  // statement about the page root. Sibling tools' keys stay legal — the schema
  // root is open — but a typo'd `eval-*` setting is caught here instead of
  // being silently ignored, which is what the closed 0.1 block used to buy.
  if (!validateFrontmatter(data)) {
    for (const e of validateFrontmatter.errors ?? []) {
      problems.push({
        message: `frontmatter${e.instancePath}: ${describeError(e)}`,
        level: "error",
        line: page.frontmatter.lineFor(e.instancePath) ?? 1,
      });
    }
    return empty;
  }

  const fm = data as EvalFrontmatter;
  const pageSkip = fm["eval-skip"] ?? false;
  const provenance: EvalProvenance[] = (fm["eval-provenance"] ?? []).map((p) => ({
    generatedBy: p["generated-by"],
    evals: p.evals,
    confidence: p.confidence,
  }));

  const declaredSuite = fm["eval-suite"];
  const suiteName = declaredSuite ?? config.defaults.suite;
  if (declaredSuite && !(declaredSuite in config.suites)) {
    problems.push({
      message: `Unknown suite "${declaredSuite}" (not defined in ${config.configPath})`,
      level: "error",
      line: page.frontmatter.lineFor("/eval-suite") ?? 1,
    });
    return { ...empty, skip: pageSkip, provenance };
  }

  const resolved = new Map<string, ResolvedEval>();

  // 1. Suite evals from the central config.
  if (suiteName) {
    const suite = config.suites[suiteName];
    for (const name of suite?.evals ?? []) {
      const def = config.evals[name];
      if (def) resolved.set(name, fromDef(name, suiteName, def, "config"));
    }
  }

  // 2. Page entries: references (with overrides) and inline evals.
  const reportSuite = suiteName ?? "default";
  // Every name an author wrote, collected before any shorthand is numbered.
  // Order matters: a shorthand at index 0 must yield to an explicit
  // `assertion-1` further down the list, not overwrite it.
  const claimed = new Set<string>(resolved.keys());
  for (const entry of evalEntries(fm.evals)) {
    if (typeof entry === "string") continue;
    claimed.add("use" in entry ? entry.use : entry.id);
  }
  for (const [i, entry] of evalEntries(fm.evals).entries()) {
    const linePtr = `/evals/${i}`;
    if (typeof entry === "string") {
      // String shorthand: an ai-judged assertion at error severity.
      //
      // In 0.1 a bare string was a *reference* to a config-defined eval, so a
      // page that still says `- fresh-enough` silently stops running the
      // freshness grader and sends the words "fresh-enough" to the judge
      // instead. Nothing errors; the eval simply disappears. Guessing the
      // author's intent would make a second, invisible spelling of `use:`, so
      // name the shape of the mistake and let them fix the page.
      if (entry in config.evals) {
        problems.push({
          message:
            `String shorthand "${entry}" matches an eval defined in ${config.configPath}, ` +
            `but a string is an assertion now, not a reference. ` +
            `Write "use: ${entry}" to run that eval.`,
          level: "warning",
          line: page.frontmatter.lineFor(linePtr) ?? 1,
        });
      }
      const name = shorthandName(i, claimed);
      claimed.add(name);
      resolved.set(
        name,
        fromDef(name, reportSuite, { assertion: entry }, "page"),
      );
      continue;
    }
    if ("use" in entry) {
      const ref = entry;
      const def = config.evals[ref.use];
      if (!def) {
        problems.push({
          message: `Unknown eval "${ref.use}" (not defined in ${config.configPath})`,
          level: "error",
          line: page.frontmatter.lineFor(linePtr) ?? 1,
        });
        continue;
      }
      const base =
        resolved.get(ref.use) ?? fromDef(ref.use, reportSuite, def, "config");
      resolved.set(ref.use, {
        ...base,
        type: ref.type ?? base.type,
        severity: ref.severity ?? base.severity,
        weight: ref.weight ?? base.weight,
        options: { ...base.options, ...(ref.options ?? {}) },
        skip: ref.skip ?? base.skip,
      });
      continue;
    }

    const inline = entry;
    if (resolved.has(inline.id) && resolved.get(inline.id)?.source === "page") {
      // Overriding a *suite* eval by id is the documented precedence rule and
      // stays a silent, intended win. Two page-level entries sharing an id is
      // different: one of them is dropped, so the page checks less than it
      // declares — an error, not a warning that lets the run pass.
      problems.push({
        message: `Duplicate eval id "${inline.id}" on page — the later entry replaces the earlier one`,
        level: "error",
        line: page.frontmatter.lineFor(linePtr) ?? 1,
      });
    }
    const ev = fromDef(inline.id, reportSuite, normalizeEvalDef(inline), "page");
    ev.skip = inline.skip ?? false;
    resolved.set(inline.id, ev);
    if (ev.grader === "ai" && !inline.examples) {
      problems.push({
        message: `Eval "${inline.id}": ai-graded evals work best with examples.pass/examples.fail`,
        level: "warning",
        line: page.frontmatter.lineFor(linePtr) ?? 1,
      });
    }
  }

  return {
    page,
    skip: pageSkip,
    suite: suiteName,
    generatedBy: fm["generated-by"],
    provenance,
    evals: [...resolved.values()],
    problems,
  };
}

/** Resolve all pages. */
export function resolvePages(
  pages: PageFile[],
  config: DocevalsConfig,
): ResolvedPagePlan[] {
  return pages.map((p) => resolvePage(p, config));
}
