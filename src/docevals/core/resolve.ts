/**
 * Resolution: merge a page's eval frontmatter with the central config into a
 * concrete per-page plan. Suites contribute named evals; page entries reference
 * them (with overrides) or define inline evals. Page entries win on id
 * collision.
 *
 * The page vocabulary is `manni:evals:1.0.0-proposal.4` — three flat
 * page-level keys (`evals`, `eval-suite`, `eval-skip`) and a reserved `eval-`
 * prefix, rather than the closed `evals:` object 0.1 used. The
 * whole frontmatter object is validated, not a synthetic `{evals}`: the prefix
 * reservation is a claim about the page root, and it cannot be enforced from a
 * fragment.
 *
 * `page.frontmatter` is the page's metadata *after* `core/external.ts` merged
 * in whatever an owning manifest supplies, so a page whose `evals` live in a
 * manifest resolves the plan it declares rather than none. What the page
 * itself carries and what a manifest supplied are told apart only when a
 * problem has to name a place: `locationOf` below.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { frontmatterSchema } from "../schema.js";
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
  /**
   * The manifest that supplied the value this problem is about, when one did
   * (`external-metadata`, proposal 0037). Absent for everything the page
   * carries, which the run then reports against the page as it always has.
   */
  file?: string;
}

export interface ResolvedPagePlan {
  page: PageFile;
  /** Page-level skip (`eval-skip: true`). */
  skip: boolean;
  suite: string | null;
  evals: ResolvedEval[];
  problems: PageProblem[];
}

// `strict: false`, as `src/cite/core/page.ts` compiles its own draft: from
// `1.0.0-proposal.4` the vocabulary annotates its three keys with
// `x-manni-location: external`, and Ajv's strict mode throws on a keyword it
// does not know rather than ignoring the annotation.
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true, strict: false });
// The draft as published: its severity is the family scale, so nothing is
// patched in memory.
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

/** The three page keys this vocabulary claims. */
interface EvalFrontmatter {
  evals?: string | FrontmatterEvalEntry[];
  "eval-suite"?: string;
  "eval-skip"?: boolean;
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
const RESERVED_KEYS = ["eval-suite", "eval-skip"] as const;

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

/**
 * Where a problem about `pointer` should point: the manifest that supplied the
 * value, or the page's own line for it.
 *
 * A manifest line without a file would read as a line of the page, which is
 * the one place the value is not. So the two travel together or not at all.
 */
function locationOf(
  page: PageFile,
  pointer: string,
): Pick<PageProblem, "file" | "line"> {
  const where = page.external?.locate(pointer);
  if (where === undefined) return { line: page.frontmatter.lineFor(pointer) ?? 1 };
  return { file: where.file, ...(where.line === undefined ? {} : { line: where.line }) };
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
    evals: [],
    problems,
  };
  if (page.extractError) {
    problems.push({ message: page.extractError, level: "error", line: 1 });
    return empty;
  }

  // A key a manifest owns and the page carries anyway. Meta files this as
  // `external:owned` on the document; docevals says the same sentence, at
  // error level, because there are then two declarations of what to check and
  // grading either one would be a guess.
  for (const c of page.external?.collisions ?? []) {
    problems.push({
      message: `"${c.key}" is owned by manifest ${c.file} (collection ${c.collection}); remove it from the document`,
      level: "error",
      line: page.frontmatter.lineFor(`/${c.key}`) ?? 1,
    });
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
        ...locationOf(page, e.instancePath),
      });
    }
    return empty;
  }

  const fm = data as EvalFrontmatter;
  const pageSkip = fm["eval-skip"] ?? false;

  const declaredSuite = fm["eval-suite"];
  const suiteName = declaredSuite ?? config.defaults.suite;
  if (declaredSuite && !(declaredSuite in config.suites)) {
    problems.push({
      message: `Unknown suite "${declaredSuite}" (not defined in ${config.configPath})`,
      level: "error",
      ...locationOf(page, "/eval-suite"),
    });
    return { ...empty, skip: pageSkip };
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
          ...locationOf(page, linePtr),
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
          ...locationOf(page, linePtr),
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
        ...locationOf(page, linePtr),
      });
    }
    const ev = fromDef(inline.id, reportSuite, normalizeEvalDef(inline), "page");
    ev.skip = inline.skip ?? false;
    resolved.set(inline.id, ev);
    if (ev.grader === "ai" && !inline.examples) {
      problems.push({
        message: `Eval "${inline.id}": ai-graded evals work best with examples.pass/examples.fail`,
        level: "warning",
        ...locationOf(page, linePtr),
      });
    }
  }

  return {
    page,
    skip: pageSkip,
    suite: suiteName,
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
