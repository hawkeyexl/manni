/**
 * Pipeline orchestration: discover → resolve → deterministic graders (cheap
 * first, the book's hybrid pattern) → AI judge → aggregate → report.
 *
 * The judge is injected (`options.judge`) so the deterministic pipeline and
 * tests run without any provider configured.
 */
import { DocevalsError } from "../types.js";
import type {
  EvalResult,
  Finding,
  RunReport,
  SuiteSummary,
} from "../types.js";
import { loadConfig, type DocevalsConfig, type ExecutionGrant } from "./config.js";
import { discoverPages } from "./discover.js";
import { resolvePages, type ResolvedPagePlan } from "./resolve.js";
import {
  applyBaseline,
  buildBaseline,
  countFingerprints,
  diffBaselines,
  readBaseline,
  writeBaselineFile,
  DEFAULT_BASELINE_PATH,
  type Baseline,
  type FingerprintContext,
} from "./baseline.js";
import { changedFilesSince, changedKey } from "./since.js";
import { graderFor } from "../graders/registry.js";
import { checkFeasibility } from "./feasibility.js";
import { realExec } from "../graders/exec.js";
import { groupTargetsByEval, type ExecFn, type GraderTarget } from "../graders/types.js";
import { sha256 } from "../judge/cache.js";
import { isTurnBudgetSkip } from "../judge/budget.js";
import { resolve } from "node:path";

export interface RunProblem {
  file: string;
  message: string;
  level: "error" | "warning";
  line?: number;
}

/** RunReport plus resolution problems (kept off the core type for reporters). */
export interface EngineReport extends RunReport {
  problems: RunProblem[];
  /** Present only when a baseline was read or written (ADR 01017). */
  baseline?: BaselineOutcome["summary"];
  /**
   * Present only under `--since` (ADR 01040). `pagesTotal` is the whole
   * discovered corpus — `pages` above stays that number too — and
   * `pagesSelected` is the count of pages that **changed since the ref**.
   *
   * It is deliberately not "pages this run evaluated", which would be a
   * different and larger number: corpus-wide graders keep every page in scope,
   * so an unchanged page can still be graded. Consumers reading this from
   * `--format json` should treat it as the size of the change set, matching
   * what the reporters print.
   */
  since?: { ref: string; pagesSelected: number; pagesTotal: number };
}

export interface JudgeOptions {
  provider?: string;
  model?: string;
  runs?: number;
  noCache?: boolean;
  /** Stop after this many uncached inference calls (ADR 01019). */
  maxTurns?: number | null;
  /** Characters of content per judge call; longer content is read in parts. */
  chunkChars?: number;
}

/** Injected AI judging stage; absent → ai-graded evals are skipped. */
export type JudgeFn = (
  targets: GraderTarget[],
  config: DocevalsConfig,
  options: JudgeOptions,
) => Promise<EvalResult[]>;

/** Injected script-generation stage (Phase 4); absent → missing commands error. */
export type GenerateFn = (
  targets: GraderTarget[],
  config: DocevalsConfig,
  options: JudgeOptions,
) => Promise<{ generatedPaths: string[] }>;

export interface RunOptions {
  configPath?: string;
  /** Preloaded config; skips loading/validating configPath a second time. */
  config?: DocevalsConfig;
  globs?: string[];
  cwd?: string;
  deterministicOnly?: boolean;
  aiOnly?: boolean;
  /** Additional execution grants for this run; never widens beyond these. */
  allowExecution?: ExecutionGrant[];
  /** `false` clears every grant for this run. */
  execution?: boolean;
  /** Run only these evals by name. Empty match is a usage error (ADR 01018). */
  evalNames?: string[];
  /** Run only evals belonging to this suite. */
  suite?: string;
  /**
   * Evaluate only pages that differ between this ref and HEAD. Unlike
   * `evalNames`, an empty match is *not* a usage error (ADR 01040).
   */
  since?: string;
  /**
   * Baseline in four states, like docmeta's: `undefined` leaves the config in
   * charge, a string names a file, `true` means "use the resolved path even if
   * the config names none", and `false` disables it outright.
   */
  baseline?: string | boolean;
  /** Record the run's findings as the new baseline. `true` uses the resolved path. */
  writeBaseline?: string | boolean;
  /**
   * Stamped into a written baseline's `generatedWith`, for diagnosis only. The
   * engine is a library entry point and cannot read its own package.json in a
   * bundle, so the CLI supplies it rather than the engine guessing.
   */
  toolVersion?: string;
  generate?: boolean;
  failOnReview?: boolean;
  judgeOptions?: JudgeOptions;
  exec?: ExecFn;
  judge?: JudgeFn;
  generateScripts?: GenerateFn;
}

/**
 * Why this eval's `target` cannot be served, or `undefined` when it can.
 *
 * `body` is what every deterministic grader already reads, so naming it
 * explicitly is a no-op rather than an error.
 */
function unsupportedTarget(
  ev: ResolvedPagePlan["evals"][number],
): string | undefined {
  const target = ev.target;
  if (target === undefined || target === "body") return undefined;
  const grader = graderFor(ev.grader);
  const named = typeof target === "string" ? target : target.path;
  if (grader?.targets?.includes(typeof target === "string" ? target : "file")) {
    return undefined;
  }
  return (
    `grader ${ev.grader} cannot read target "${named}" — it grades the page ` +
    `body. Use the ai grader for this target, or drop the target.`
  );
}

function skippedResult(
  plan: ResolvedPagePlan,
  ev: ResolvedPagePlan["evals"][number],
  reason: string,
): EvalResult {
  return {
    evalName: ev.name,
    type: ev.type,
    grader: ev.grader,
    file: plan.page.file,
    outcome: "skipped",
    skipReason: reason,
    durationMs: 0,
  };
}

/**
 * Collision-proof composite key for (file, eval) maps — file paths may
 * contain any character, so field boundaries must be unambiguous.
 */
function resultKey(file: string, evalName: string): string {
  return JSON.stringify([file, evalName]);
}

function groupFindings(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = resultKey(f.file, f.evalName);
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return map;
}

/**
 * Record each result's suite on the result itself.
 *
 * The mapping is already computed here for the summaries; without stamping it,
 * a reporter that wants to group by suite (JUnit) has no way to, and a
 * consumer of `--format json` sees pass rates per suite with no way to tell
 * which results produced them.
 */
function stampSuites(
  results: EvalResult[],
  plans: ResolvedPagePlan[],
): void {
  const suiteOf = new Map<string, string>();
  const weightOf = new Map<string, number>();
  for (const plan of plans) {
    for (const ev of plan.evals) {
      const key = resultKey(plan.page.file, ev.name);
      suiteOf.set(key, ev.suite);
      weightOf.set(key, ev.weight);
    }
  }
  for (const r of results) {
    const key = resultKey(r.file, r.evalName);
    r.suite = suiteOf.get(key) ?? "default";
    // A result with no matching plan entry cannot be weighted from one, so it
    // counts as 1 rather than 0 — dropping it out of the denominator would let
    // an unresolvable eval quietly raise a suite's rate.
    r.weight = weightOf.get(key) ?? 1;
  }
}

export interface BaselineOutcome {
  results: EvalResult[];
  /** Present only when a baseline was read or written. */
  summary?: {
    path: string;
    recorded: number;
    suppressed: number;
    stale: number;
    written?: { added: number; removed: number; total: number };
  };
}

/**
 * Read, apply, and optionally re-record the findings baseline (ADR 01017).
 *
 * The path is resolved once, here, and both reading and writing use it. That is
 * deliberate: a bare `--write-baseline` must record into the *configured* path,
 * because a repo that points `baseline:` somewhere custom would otherwise
 * record into a file nothing ever reads — and the ratchet would silently do
 * nothing at all. docmeta names this exact trap.
 */
function resolveBaseline(
  results: EvalResult[],
  config: DocevalsConfig,
  options: RunOptions,
  cwd: string,
  problems: RunProblem[],
): BaselineOutcome {
  const wants = options.writeBaseline !== undefined && options.writeBaseline !== false;
  if (options.baseline === false && !wants) return { results };

  // Read and write paths resolve separately. Sharing one made
  // `--baseline old.json --write-baseline new.json` read old.json and then
  // overwrite it, never creating new.json.
  //
  // A bare `--baseline` falls back to the configured path and then the
  // default. `--write-baseline` does NOT force that fallback on the *read*
  // side: `--write-baseline snapshot.json` in a repo with no `baseline:` key
  // should not silently subtract a file the user never named.
  const readFallback =
    config.baseline ?? (options.baseline === true ? DEFAULT_BASELINE_PATH : null);
  const applyFrom =
    options.baseline === false
      ? null
      : typeof options.baseline === "string"
        ? options.baseline
        : readFallback;
  const writeTo = !wants
    ? null
    : typeof options.writeBaseline === "string"
      ? options.writeBaseline
      : (config.baseline ?? DEFAULT_BASELINE_PATH);
  const configured = writeTo ?? applyFrom;
  if (configured === null) return { results };

  // Relative to the config's directory, not the working directory: the file is
  // committed beside the config, and a run from a subdirectory has to find the
  // same one.
  const ctx: FingerprintContext = { base: config.configDir, runBase: cwd };
  // A baseline that cannot be parsed must not block the one command documented
  // to repair it. Reading unconditionally made `--write-baseline` throw the
  // very error whose message recommends running it.
  const read = (from: string): Baseline | null => {
    try {
      return readBaseline(resolve(config.configDir, from), from);
    } catch (e) {
      if (!wants) throw e;
      problems.push({
        file: from,
        message: `${e instanceof Error ? e.message : String(e)} — re-recording over it.`,
        level: "warning",
      });
      return null;
    }
  };

  // What gets subtracted from this run's findings. Null under --no-baseline.
  const previous = applyFrom === null ? null : read(applyFrom);
  // What is about to be overwritten. This is what `removed` must be measured
  // against — not `previous`, which may be a different file or, under
  // --no-baseline, deliberately unread. Measuring the diff against the wrong
  // prior silently reported `-0` for a re-record that dropped everything.
  const overwriting =
    writeTo === null ? null : writeTo === applyFrom ? previous : read(writeTo);

  let out = results;
  let recorded = 0;
  let suppressed = 0;
  let stale = 0;
  if (previous && options.baseline !== false) {
    const applied = applyBaseline(results, previous, ctx);
    out = applied.results;
    recorded = applied.recorded;
    suppressed = applied.suppressed;
    stale = applied.stale;
  }

  if (!wants) {
    return {
      results: out,
      summary: { path: configured, recorded, suppressed, stale },
    };
  }

  // Recorded from the *unsuppressed* results: a re-record describes what the
  // corpus contains now, not what this run happened to still be complaining
  // about after the previous baseline was subtracted.
  const next = buildBaseline(results, options.toolVersion ?? "unknown", ctx);
  writeBaselineFile(resolve(config.configDir, writeTo!), next, writeTo!);
  const { added, removed } = diffBaselines(overwriting, next);
  // Apply the baseline this run just wrote, not the one it replaced. Recording
  // today's findings *is* declaring them the accepted state, so a recording run
  // has nothing new left to fail on. Reporting them as failures anyway would
  // make `--write-baseline` a command you always have to `|| true`, which is a
  // reliable way to lose the exit code that matters on the next run.
  const accepted = applyBaseline(results, next, ctx);
  // Writing a baseline nothing will read is the same silent-nothing-happens
  // failure as recording into the wrong path: the command succeeds, the file
  // appears, and the next run ignores it. Say so where the user is looking.
  // Fires whenever an ordinary run would not read back what was just written:
  // no `baseline:` at all, or a `--write-baseline <path>` pointing somewhere
  // the config does not name.
  if (config.baseline !== writeTo) {
    problems.push({
      file: writeTo!,
      message:
        `Recorded ${writeTo!}, but \`baseline:\` in ${config.configPath} is ` +
        `${config.baseline === null ? "not set" : `"${config.baseline}"`}. ` +
        `An ordinary run will not read this file — point the key at it, or pass --baseline ${writeTo!}.`,
      level: "warning",
    });
  }
  return {
    results: accepted.results,
    summary: {
      path: configured,
      recorded,
      suppressed,
      stale,
      written: { added, removed, total: countFingerprints(next) },
    },
  };
}

/**
 * Narrow each plan's evals to the requested names and/or suite, in place.
 *
 * Returns whether a filter was applied, which is what suspends suite
 * enforcement downstream. A filter matching nothing is a usage error rather
 * than a green run over zero evals — the same contract `discoverPages` already
 * enforces for an empty input set (ADR 01018).
 */
export function applySelection(
  plans: ResolvedPagePlan[],
  config: DocevalsConfig,
  options: { evalNames?: string[]; suite?: string },
  /**
   * Whether a match must be something the run would actually grade.
   *
   * True for `run`, where a filter matching only skipped work would exit 0
   * having executed nothing. False for `list`, which executes nothing by
   * design — showing that an eval resolves but is skipped is the answer it
   * exists to give, and throwing there breaks the command the run's own error
   * message points at.
   */
  requireRunnable = true,
): boolean {
  const names = options.evalNames?.filter((n) => n.trim() !== "") ?? [];
  const suite = options.suite;
  if (names.length === 0 && suite === undefined) return false;

  if (suite !== undefined && !(suite in config.suites)) {
    throw new DocevalsError(
      `--suite "${suite}" is not a defined suite. Defined: ${
        Object.keys(config.suites).sort().join(", ") || "(none)"
      }`,
    );
  }
  const wanted = new Set(names);

  // Counts only evals that will actually be graded. Counting evals on a
  // skipped page made `--eval x` exit 0 over a run that executed nothing,
  // which is the outcome ADR 01018 makes a usage error one typo away.
  let matched = 0;
  for (const plan of plans) {
    const runnable = !plan.skip && !plan.problems.some((p) => p.level === "error");
    plan.evals = plan.evals.filter((ev) => {
      const byName = wanted.size === 0 || wanted.has(ev.name);
      // Match the suite an eval *reports under*, not the membership list in
      // `config.suites[x].evals`. A page inherits its suite from `eval-suite`
      // or `defaults.suite` and stamps it on every eval it carries, including
      // page-inline ones the membership list never mentions — so filtering on
      // the list would select evals that report under a different suite than
      // the one asked for, and miss ones that report under it.
      const bySuite = suite === undefined || ev.suite === suite;
      const keep = byName && bySuite;
      if (keep && (!requireRunnable || (runnable && !ev.skip))) matched += 1;
      return keep;
    });
  }

  if (matched === 0) {
    const asked = [
      names.length > 0 ? `--eval ${names.join(", ")}` : "",
      suite === undefined ? "" : `--suite ${suite}`,
    ]
      .filter(Boolean)
      .join(" and ");
    throw new DocevalsError(
      `${asked} matched no evals that would run on the pages selected. Nothing ` +
        `would have been checked — the name may be wrong, or every page carrying ` +
        `it may be skipped. Run \`manni docevals list\` with the same filter to ` +
        `see the resolved plan.`,
    );
  }
  return true;
}

/**
 * Narrow each plan to the pages that changed, in place, leaving corpus graders
 * alone (ADR 01040).
 *
 * **The corpus exemption is the subtle half.** `GraderContext` carries
 * `targets`, not a page list, so `tool:differentiation` builds its comparison
 * population out of whatever it is handed. `gradeGroup` returns `[]` below two
 * targets, and an eval with no findings is recorded as a **pass** — so
 * narrowing a corpus grader's input does not narrow the check, it silently
 * converts it into a pass. Corpus evals therefore survive on unchanged pages,
 * which costs no subprocess and no tokens because the only corpus grader is
 * native. The visible consequence is that a scoped run can report a finding on
 * a page nobody touched; the message already names the other page.
 *
 * An empty result is **not** a usage error, which is where this parts company
 * with `applySelection`. "No page changed" is a correct answer to a correct
 * question; "`--eval` matched nothing" is a typo.
 */
export function applySinceScope(
  plans: ResolvedPagePlan[],
  changed: Set<string>,
): { pagesSelected: number } {
  let pagesSelected = 0;
  for (const plan of plans) {
    if (changed.has(changedKey(plan.page.absPath))) {
      pagesSelected += 1;
      continue;
    }
    plan.evals = plan.evals.filter((ev) => {
      const grader = graderFor(ev.grader);
      if (grader) return grader.mode === "corpus";
      // `graderFor` returns undefined for `ai` and `human` — which is exactly
      // what scoping should drop, since not paying the judge is the point — and
      // *also* for an unrecognised `tool:` kind. Dropping those too would hide a
      // misconfiguration on every page the branch did not touch: the grading
      // loop is what reports an unknown kind, so an eval removed here never
      // errors. A typo would surface on a changed page and vanish on an
      // unchanged one, which is the least predictable behaviour available.
      return ev.grader !== "ai" && ev.grader !== "human";
    });
  }
  return { pagesSelected };
}

/**
 * Per-suite aggregates. Reads the suite `stampSuites` recorded on each result
 * rather than rebuilding the plan-to-suite map a second time — two copies of
 * one derivation are two things to keep in agreement.
 */
function summarizeSuites(
  results: EvalResult[],
  config: DocevalsConfig,
  partial = false,
): SuiteSummary[] {
  const bySuite = new Map<string, EvalResult[]>();
  for (const r of results) {
    const suite = r.suite ?? "default";
    const list = bySuite.get(suite) ?? [];
    list.push(r);
    bySuite.set(suite, list);
  }
  const summaries: SuiteSummary[] = [];
  for (const [suite, rs] of [...bySuite.entries()].sort()) {
    const passed = rs.filter((r) => r.outcome === "pass").length;
    const failed = rs.filter((r) => r.outcome === "fail").length;
    const errored = rs.filter((r) => r.outcome === "error").length;
    const needsReview = rs.filter((r) => r.outcome === "needs-review").length;
    const skipped = rs.filter((r) => r.outcome === "skipped").length;
    // Counts stay unweighted and per-eval: they report how many evals did
    // what, and a reader comparing "1 failed" against a rate of 0.33 is
    // reading two different questions, both answered honestly.
    //
    // The rate is weighted over the same membership as before — the graded
    // set, pass + fail + error. `needs-review` and `skipped` stay out of both
    // halves, so a page awaiting review neither helps nor hurts.
    const graded = (r: EvalResult): boolean =>
      r.outcome === "pass" || r.outcome === "fail" || r.outcome === "error";
    const suiteCriteria = config.suites[suite]?.criteria ?? [];

    const contributions: { weight: number; passed: boolean }[] = [];

    // Criteria first, because which evals a criterion actually absorbs is only
    // known once it is evaluated. A group scored once is the whole point —
    // three checks written as a criterion must not outvote three standalone
    // evals just for being grouped.
    let critPassed = 0;
    let critFailed = 0;
    let critSuspended = 0;
    /** "<file> <evalName>" of members a *scored* criterion speaks for. */
    const absorbed = new Set<string>();
    // Indexed once for the whole suite. The loop below is criterion x page x
    // member, and a `filter`/`find` inside it rescans every result each time —
    // quadratic in a corpus's result count, on the one code path that runs
    // after everything else has finished.
    const byKey = new Map<string, EvalResult>();
    const filesByEval = new Map<string, Set<string>>();
    for (const r of rs) {
      byKey.set(resultKey(r.file, r.evalName), r);
      const files = filesByEval.get(r.evalName) ?? new Set<string>();
      files.add(r.file);
      filesByEval.set(r.evalName, files);
    }
    for (const critName of suiteCriteria) {
      const def = config.criteria[critName];
      if (!def) continue;
      const pages = new Set<string>();
      for (const name of def.evals) {
        for (const file of filesByEval.get(name) ?? []) pages.add(file);
      }
      for (const file of pages) {
        const members = def.evals.map((name) =>
          byKey.get(resultKey(file, name)),
        );
        // Every member must have been graded for the group to mean anything.
        // A missing or ungraded member suspends it rather than failing it.
        if (members.some((m) => m === undefined || !graded(m))) {
          critSuspended++;
          // Deliberately does NOT absorb its members. A suspended criterion
          // contributes nothing, so absorbing them too would delete their
          // outcomes from the rate entirely — a failing member would move the
          // total by nothing and silently inflate the suite.
          continue;
        }
        const passes = members.map((m) => m?.outcome === "pass");
        const passed =
          def.combine === "any" ? passes.some(Boolean) : passes.every(Boolean);
        if (passed) critPassed++;
        else critFailed++;
        contributions.push({ weight: def.weight, passed });
        for (const m of members) {
          if (m) absorbed.add(resultKey(m.file, m.evalName));
        }
      }
    }

    // Standalone evals: everything a scored criterion did not speak for.
    for (const r of rs) {
      if (!graded(r) || absorbed.has(resultKey(r.file, r.evalName))) continue;
      contributions.push({ weight: r.weight ?? 1, passed: r.outcome === "pass" });
    }

    const totalWeight = contributions.reduce((sum, c) => sum + c.weight, 0);
    const passRate =
      totalWeight > 0
        ? contributions
            .filter((c) => c.passed)
            .reduce((sum, c) => sum + c.weight, 0) / totalWeight
        : 1;
    const targetPassRate = config.suites[suite]?.targetPassRate ?? 1.0;
    summaries.push({
      suite,
      total: rs.length,
      passed,
      failed,
      needsReview,
      skipped,
      errored,
      passRate,
      targetPassRate,
      // A suite target is a claim about a body of checks. A filtered run
      // measured part of it, so it reports the numbers and withholds the
      // verdict — erring toward false confidence is what gets a gate removed
      // rather than fixed (ADR 01018).
      meetsTarget: partial ? false : passRate >= targetPassRate,
      ...(partial ? { partial: true } : {}),
      ...(suiteCriteria.length > 0
        ? {
            criteria: {
              total: critPassed + critFailed + critSuspended,
              passed: critPassed,
              failed: critFailed,
              suspended: critSuspended,
            },
          }
        : {}),
    });
  }
  return summaries;
}

export async function runEvals(options: RunOptions = {}): Promise<EngineReport> {
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? loadConfig(options.configPath, cwd);
  const exec = options.exec ?? realExec;
  const pages = discoverPages(config, options.globs ?? [], cwd);
  // Refused up front, not at the end: a re-record rebuilds the file from this
  // run's findings, so recording from a filtered run would drop every
  // fingerprint the filter excluded. Deciding it here costs nothing; deciding
  // it after `resolveBaseline` meant the generation pass had already written
  // scripts and rewritten frontmatter, and the judge had already been paid.
  //
  // `--since` is refused here for the same reason and, being *before* the git
  // call below, a usage error never spawns a subprocess.
  if (
    options.writeBaseline !== undefined &&
    options.writeBaseline !== false &&
    ((options.evalNames?.some((n) => n.trim() !== "") ?? false) ||
      options.suite !== undefined ||
      options.since !== undefined)
  ) {
    throw new DocevalsError(
      "--write-baseline records the whole corpus, so it cannot be combined with " +
        "--eval, --suite or --since: the re-record would drop every finding the " +
        "narrowing excluded. Re-run without it to record.",
    );
  }

  // Before `resolvePages`, so an unresolvable ref fails the run without paying
  // for resolution — but applied after `applySelection` below, because
  // `PageFile.absPath` only exists post-discovery and resolution problems must
  // surface for every page, scoped or not (ADR 01018's driver).
  // Blank and option-shaped refs are rejected inside `changedFilesSince`, at
  // the seam, so a library caller gets the same guard the CLI does.
  const sinceRef = options.since;
  const changed =
    sinceRef === undefined ? null : await changedFilesSince(sinceRef, cwd, exec);

  const plans = resolvePages(pages, config);
  // A run that resolved no evals at all checked nothing, and exited 0 saying
  // so in about seventeen bytes. The identical condition reached through
  // `--eval no-such-eval` is already exit 2 with a careful message
  // (ADR 01018); reaching it through configuration must not be silence
  // (ADR 01041).
  //
  // Read off the *resolved* plan, deliberately before every narrowing:
  // `applySelection` owns its own empty-match error and names what was asked
  // for, and `--since` deliberately answers "no page changed" with exit 0 and
  // a sentence (ADR 01040). The plan being empty is a different claim from a
  // scope being empty.
  //
  // Suppressed when resolution errored, because then there *is* something to
  // report: the run exits 1 naming the bad key, which is a better diagnosis
  // than telling the reader to configure a suite they may already have.
  //
  // And read over the pages the author did **not** skip. A page carrying
  // `eval-skip: true` and no suite resolves *zero* evals rather than evals
  // that are then skipped, so counting over every page turned a deliberate,
  // documented skip into a usage error — `test/fixtures/pages/index.mdx` is
  // exactly that page, and `docs/src/content/docs/evals/index.mdx` runs it
  // expecting exit 0. "Nothing is configured to check the pages you asked
  // about" is the claim; a skipped page is not one of those pages.
  const unskipped = plans.filter((p) => !p.skip);
  if (
    unskipped.length > 0 &&
    unskipped.every((p) => p.evals.length === 0) &&
    !plans.some((p) => p.problems.some((pr) => pr.level === "error"))
  ) {
    throw new DocevalsError(
      `No evals resolved for any of the ${unskipped.length} page(s) this run would check. ` +
        `Nothing would have been checked, so this run would have reported ` +
        `success without checking anything.\n` +
        `Point \`defaults.suite\` at a suite in ${config.configPath}, or give ` +
        `the pages an \`eval-suite\` or \`evals\` frontmatter key. Run ` +
        `\`manni docevals list\` to see the resolved plan.`,
    );
  }
  const filtered = applySelection(plans, config, options);
  // Declared here, applied *after* the feasibility pass below. `--since` scopes
  // what is graded, never what is diagnosed — and `applySinceScope` empties
  // `plan.evals` on unchanged pages, so scoping first would hand
  // `checkFeasibility` nothing to look at. A pull request that edits only
  // `manni.config.yaml` changes no page, so under `--since` every plan would be
  // empty and the config's own validity — a malformed grader option, an unknown
  // key — would go unchecked, exiting 0. The one flag meant for CI would make a
  // config-only change the least examined kind of change there is.
  let scope: { ref: string; pagesSelected: number; pagesTotal: number } | null = null;
  const judgeOptions = options.judgeOptions ?? {};

  const problems: RunProblem[] = plans.flatMap((p) =>
    p.problems.map((pr) => ({
      file: p.page.file,
      message: pr.message,
      level: pr.level,
      line: pr.line,
    })),
  );

  const results: EvalResult[] = [];
  const deterministicTargets: GraderTarget[] = [];
  const aiTargets: GraderTarget[] = [];
  const generationTargets: GraderTarget[] = [];
  const generatedPaths: string[] = [];
  /** "<file> <evalName>" keys whose check script this run generated. */
  const generatedThisRun = new Set<string>();

  // Default deny, with the CLI able to withhold a configured grant but never
  // to widen one: `--allow-execution` on the command line is still an operator
  // act, so it grants; `--no-execution` clears everything for one run.
  const granted = new Set<ExecutionGrant>([
    ...config.execution.allow,
    ...(options.allowExecution ?? []),
  ]);
  if (options.execution === false) granted.clear();
  const allowFrontmatterCommands = granted.has("frontmatter-commands");
  const allowPageEmbeddedSteps = granted.has("page-embedded-steps");

  // Before anything is dispatched: an eval that cannot reach a verdict as
  // configured is a configuration error, and saying so now costs nothing where
  // discovering it at grade time costs a judge call.
  problems.push(
    ...checkFeasibility(plans, {
      allowFrontmatterCommands,
      canGenerate: options.generate !== false && options.generateScripts != null,
      ...(options.deterministicOnly === true ? { deterministicOnly: true } : {}),
      ...(options.aiOnly === true ? { aiOnly: true } : {}),
    }),
  );

  // Now that every page has been diagnosed, narrow what will actually be
  // graded. See the declaration above for why this cannot move earlier.
  if (changed !== null && sinceRef !== undefined) {
    scope = {
      ref: sinceRef,
      pagesTotal: plans.length,
      ...applySinceScope(plans, changed),
    };
  }

  for (const plan of plans) {
    if (plan.problems.some((p) => p.level === "error")) continue;
    for (const ev of plan.evals) {
      if (plan.skip) {
        results.push(skippedResult(plan, ev, "page skipped (evals.skip)"));
        continue;
      }
      if (ev.skip) {
        results.push(skippedResult(plan, ev, "eval skipped"));
        continue;
      }
      if (ev.grader === "human") {
        results.push({
          evalName: ev.name,
          type: ev.type,
          grader: ev.grader,
          file: plan.page.file,
          outcome: "needs-review",
          durationMs: 0,
        });
        continue;
      }
      if (ev.grader === "ai") {
        if (options.deterministicOnly) {
          results.push(skippedResult(plan, ev, "judge skipped (--deterministic-only)"));
        } else if (!options.judge) {
          results.push(skippedResult(plan, ev, "judge unavailable (no provider)"));
        } else {
          aiTargets.push({ plan, eval: ev });
        }
        continue;
      }
      // command / tool:* — deterministic.
      if (options.aiOnly) {
        results.push(skippedResult(plan, ev, "deterministic evals skipped (--ai-only)"));
        continue;
      }
      // Page-authored argv, whatever grader carries it. `command` evals name
      // it in `command`; every `tool:*` adapter also accepts an
      // `options.command` override and hands it to the same `exec`. Gating
      // only the grader left a second spelling of "run this" that reached a
      // shell ungated, which made default-deny decorative — a page that cannot
      // say `grader: command` could say `grader: tool:vale` with the same argv.
      // Config-authored argv is the operator's own and is not content, so the
      // gate is on `source === "page"` rather than on the key's presence.
      const pageAuthoredArgv =
        ev.source === "page" &&
        (ev.grader === "command" || Array.isArray(ev.options.command));
      if (pageAuthoredArgv && !allowFrontmatterCommands) {
        results.push(
          skippedResult(
            plan,
            ev,
            "frontmatter commands not granted (execution.allow: [frontmatter-commands])",
          ),
        );
        continue;
      }
      // The second path from content to a shell: doc-detective executes steps
      // written in the page *body*, which no flag covered before. Same grant
      // model, different capability — an operator who trusts a repo's
      // frontmatter has not thereby trusted arbitrary steps in its prose.
      if (ev.grader === "tool:doc-detective" && !allowPageEmbeddedSteps) {
        results.push(
          skippedResult(
            plan,
            ev,
            "page-embedded steps not granted (execution.allow: [page-embedded-steps])",
          ),
        );
        continue;
      }
      if (ev.grader === "command" && !ev.command) {
        generationTargets.push({ plan, eval: ev });
        continue;
      }
      // Stale generated script: the assertion changed since generation.
      if (
        ev.grader === "command" &&
        ev.command &&
        ev.generatedAssertionHash &&
        ev.assertion &&
        ev.generatedAssertionHash !== sha256(ev.assertion)
      ) {
        if (options.generate !== false && options.generateScripts) {
          generationTargets.push({ plan, eval: ev });
          continue;
        }
        problems.push({
          file: plan.page.file,
          message: `Eval "${ev.name}": assertion changed since its script was generated — run \`manni docevals generate\` to regenerate`,
          level: "warning",
        });
      }
      // ADR 01033: a grader that cannot serve a requested target says so,
      // rather than grading something else and reporting a verdict about
      // bytes nobody asked about. An *error* and not a skip, because a skip
      // keeps the run green and an eval that measured the wrong thing would
      // then read as coverage.
      const unsupported = unsupportedTarget(ev);
      if (unsupported !== undefined) {
        results.push({
          evalName: ev.name,
          type: ev.type,
          grader: ev.grader,
          file: plan.page.file,
          outcome: "error",
          skipReason: unsupported,
          durationMs: 0,
        });
        continue;
      }
      deterministicTargets.push({ plan, eval: ev });
    }
  }

  // Script generation for command evals with no command yet.
  if (generationTargets.length > 0) {
    if (options.generate !== false && options.generateScripts) {
      const gen = await options.generateScripts(
        generationTargets,
        config,
        judgeOptions,
      );
      generatedPaths.push(...gen.generatedPaths);
      // Re-read the targets' evals: generateScripts mutates eval.command in place.
      for (const t of generationTargets) {
        if (t.eval.command) {
          deterministicTargets.push(t);
          // Surfaced by the reporters as "(generated)" on this run's result.
          generatedThisRun.add(resultKey(t.plan.page.file, t.eval.name));
        } else {
          results.push({
            evalName: t.eval.name,
            type: t.eval.type,
            grader: t.eval.grader,
            file: t.plan.page.file,
            outcome: "error",
            skipReason: "script generation failed",
            generated: false,
            durationMs: 0,
          });
        }
      }
    } else {
      for (const t of generationTargets) {
        results.push({
          evalName: t.eval.name,
          type: t.eval.type,
          grader: t.eval.grader,
          file: t.plan.page.file,
          outcome: "error",
          skipReason:
            "no command and script generation unavailable (configure a provider or run `manni docevals generate`)",
          durationMs: 0,
        });
      }
    }
  }

  // Deterministic graders, grouped by kind.
  const byKind = new Map<string, GraderTarget[]>();
  for (const t of deterministicTargets) {
    const list = byKind.get(t.eval.grader) ?? [];
    list.push(t);
    byKind.set(t.eval.grader, list);
  }

  for (const [kind, targets] of byKind) {
    const grader = graderFor(kind);
    if (!grader) {
      for (const t of targets) {
        results.push({
          evalName: t.eval.name,
          type: t.eval.type,
          grader: t.eval.grader,
          file: t.plan.page.file,
          outcome: "error",
          skipReason: `Unknown grader kind "${kind}"`,
          durationMs: 0,
        });
      }
      continue;
    }
    // One invocation per eval *configuration*, not one per grader kind — the
    // engine drives the same partition the batch adapters use internally, so
    // the try/catch below can only ever reach one eval's targets (ADR 01042).
    //
    // The bug this closes: batch graders loop `groupTargetsByEval` *inside*
    // `grade()`, so a throw on the second group unwound the whole function and
    // discarded the first group's already-computed findings. One broken eval
    // erased every sibling eval of the same kind, and every one of them
    // reported the broken eval's message.
    //
    // `groupTargetsByEval` is a pure partition and idempotent, so the adapters
    // keep calling it too: each stays correct when invoked directly, and the
    // isolation boundary is not something a new adapter has to remember.
    for (const group of groupTargetsByEval(targets)) {
      const start = Date.now();
      // A grader is effectively third-party code: tool adapters shell out, and
      // `runValidate` raises on a schema path it cannot read — which
      // `options.schemas` being hand-written makes the likeliest route in.
      // Letting that rejection escape drops every remaining eval on every
      // remaining page with no result and no exit-code signal that anything
      // was skipped. Error its own targets and carry on, the way a failed
      // script generation already does above.
      let findings: Finding[];
      try {
        findings = await grader.grade({ targets: group, config, root: cwd, exec });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        for (const target of group) {
          results.push({
            evalName: target.eval.name,
            suite: target.eval.suite,
            type: target.eval.type,
            grader: target.eval.grader,
            file: target.plan.page.file,
            outcome: "error",
            // Names the eval, not just the kind. With one catch per kind the
            // message described whichever eval happened to throw while sitting
            // on every eval's result, so the name in the result and the name
            // in the message disagreed.
            skipReason: `grader ${kind} failed for eval "${target.eval.name}": ${reason}`,
            durationMs: Date.now() - start,
          });
        }
        continue;
      }
      const durationMs = Date.now() - start;
      const grouped = groupFindings(findings);
      for (const t of group) {
        const key = resultKey(t.plan.page.file, t.eval.name);
        const own = grouped.get(key) ?? [];
        // A diagnostic finding fails the eval regardless of severity: it means
        // the grader could not reach a verdict, and "no verdict" must never
        // read as "pass". Enforced here rather than per-adapter, so a new
        // adapter gets it by default instead of having to remember (ADR 01022).
        const hasError = own.some(
          (f) => f.severity === "error" || f.diagnostic === true,
        );
        results.push({
          evalName: t.eval.name,
          type: t.eval.type,
          grader: t.eval.grader,
          file: t.plan.page.file,
          outcome: hasError ? "fail" : "pass",
          findings: own.length > 0 ? own : undefined,
          generated: generatedThisRun.has(key) ? true : undefined,
          durationMs: Math.round(durationMs / group.length),
        });
      }
    }
  }

  // failFast: a page with an error-severity deterministic failure skips its ai evals.
  let effectiveAiTargets = aiTargets;
  if (config.defaults.failFast) {
    const failedPages = new Set(
      results
        .filter((r) => r.outcome === "fail" || r.outcome === "error")
        .map((r) => r.file),
    );
    effectiveAiTargets = [];
    for (const t of aiTargets) {
      if (failedPages.has(t.plan.page.file)) {
        results.push(
          skippedResult(t.plan, t.eval, "deterministic-precondition-failed"),
        );
      } else {
        effectiveAiTargets.push(t);
      }
    }
  }

  // AI judge stage.
  if (effectiveAiTargets.length > 0 && options.judge) {
    results.push(
      ...(await options.judge(effectiveAiTargets, config, judgeOptions)),
    );
  }

  // A run that ran out of turns has *reduced coverage*, and skipped evals are
  // excluded from the suite pass rate below — so without this it exits 0
  // having judged less than it was asked to, which is the silent-green shape
  // this corpus gate exists to prevent. Warning, not error: the cap was asked
  // for, so tripping it is expected; going quiet about it is not (ADR 01019).
  const budgetSkipped = results.filter((r) => isTurnBudgetSkip(r.skipReason));
  if (budgetSkipped.length > 0) {
    problems.push({
      file: budgetSkipped[0]!.file,
      message:
        `${budgetSkipped.length} eval(s) were not judged: the turn budget ran out. ` +
        `This run covered less than it was asked to — raise --max-turns or narrow the run.`,
      level: "warning",
    });
  }

  // Nothing reached a verdict. Deliberately a warning and not an error:
  // `eval-skip` is a feature, `--deterministic-only` is a standing CI
  // invocation, and a scoped run over a clean tree is a correct answer
  // (ADR 01040). What was missing is anyone saying that the run therefore
  // established nothing — the same omission the turn-budget warning above
  // exists to fill (ADR 01019, ADR 01041).
  //
  // No exception for `--since`, which narrates its own empty scope a few lines
  // later in every reporter. Two lines, one explaining the other, is a better
  // trade than a carve-out: a carve-out is how this class of bug returns.
  //
  // `needs-review` is excluded on purpose: a human-graded eval is work the run
  // produced, not silence, and the reporters already point at `review`.
  //
  // Anchored on the config rather than a page: no single page is at fault, and
  // the config is the run-level file a reader can act on.
  if (!results.some((r) => r.outcome !== "skipped")) {
    problems.push({
      file: config.configPath,
      message:
        `This run graded nothing — no eval reached a verdict, so it established ` +
        `nothing about the corpus. ` +
        (results.length > 0
          ? `All ${results.length} resolved eval(s) were skipped; check the skip ` +
            `reasons above — a page-level \`eval-skip\`, a grader-class flag, or ` +
            `a missing provider.`
          : // With zero results the cause is not always the same, and naming the
            // wrong one sends the reader to the wrong file. An error-level
            // resolution problem makes the plan loop skip that page entirely and
            // also suppresses the empty-plan throw above, so "skipped or scoped
            // out" would contradict the errors printed right beside it.
            problems.some((p) => p.level === "error")
            ? `Every discovered page was dropped by an error-level resolution ` +
              `problem — fix those first; they are listed above.`
            : `Every discovered page was skipped or scoped out of the run.`),
      level: "warning",
    });
  }

  const baselineOutcome = resolveBaseline(results, config, options, cwd, problems);
  // Copy before clearing: when no baseline applies, `resolveBaseline` hands
  // back the very array it was given, and emptying it first would leave the
  // spread with nothing to read — a run reporting zero results, green.
  const baselinedResults = [...baselineOutcome.results];
  results.length = 0;
  results.push(...baselinedResults);

  stampSuites(results, plans);

  // Self-preference reaches the reporters as a problem, not just as a field on
  // the result: a run whose verdicts were formed by the model that wrote the
  // pages should say so where anyone reads it. One per affected eval — the
  // earlier stderr warning deduped by model name and so named only the first
  // page, leaving every other page with the same problem silent.
  for (const r of results) {
    if (!r.selfPreference) continue;
    const { axis, model } = r.selfPreference;
    problems.push({
      file: r.file,
      level: "warning",
      message:
        axis === "content"
          ? `Eval "${r.evalName}" was judged by ${model}, which also generated this page (generated-by). A model favors its own output — judge with a different model, or set \`model:\` on the eval.`
          : `Eval "${r.evalName}" was judged by ${model}, which also proposed the assertion (eval-provenance). Have a human confirm the assertion before trusting the verdict.`,
    });
  }

  // A scoped run measured part of the corpus, which is the same claim-from-a-
  // sample problem `--eval` has — so it reuses ADR 01018's mechanism rather
  // than growing a second, differently-behaved one.
  //
  // `partial` means coverage was actually lost, not that a narrowing flag was
  // present. Deriving it from the flag disabled suite-target enforcement on a
  // `--since` run that happened to touch every page — and since ADR 01040
  // intends `--since` as the CI invocation, that turned the aggregate gate off
  // permanently for anyone who adopted it. `pagesSelected` is already the exact
  // count, so the predicate is free.
  const scopeLostCoverage = scope !== null && scope.pagesSelected < plans.length;
  const suites = summarizeSuites(results, config, filtered || scopeLostCoverage);
  const judged = results.filter((r) => r.consensus != null);
  const totalTokens = judged.reduce(
    (n, r) =>
      n +
      (r.consensus?.runs.reduce(
        (m, run) =>
          m + (run.usage ? run.usage.inputTokens + run.usage.outputTokens : 0),
        0,
      ) ?? 0),
    0,
  );

  const hasFailure =
    results.some((r) => r.outcome === "fail" || r.outcome === "error") ||
    suites.some((s) => s.partial !== true && !s.meetsTarget) ||
    problems.some((p) => p.level === "error") ||
    (options.failOnReview === true &&
      results.some((r) => r.outcome === "needs-review"));

  return {
    pages: plans.length,
    evalResults: results,
    suites,
    usage: {
      totalTokens,
      cachedEvals: judged.filter((r) =>
        r.consensus!.runs.every((run) => run.cached),
      ).length,
      judgedEvals: judged.length,
    },
    generated: generatedPaths,
    exitCode: hasFailure ? 1 : 0,
    problems,
    ...(baselineOutcome.summary ? { baseline: baselineOutcome.summary } : {}),
    ...(scope ? { since: { ...scope, pagesTotal: plans.length } } : {}),
  };
}
