/**
 * `manni docevals calibrate` — measure judge agreement against a human-verified
 * golden set (the book's step 3: calibrate judges before trusting them).
 * Golden cases live in YAML files under .manni/docevals/golden/ by default:
 *
 *   - file: docs/install.md
 *     eval: no-future-promises      # ai-graded eval resolvable on that page
 *     expected: pass
 *     rationale: Mentions only shipped features.
 *
 * Below 70% agreement the command exits 1 — the criteria (usually) need to be
 * more specific, not the grading mechanism. A false-positive rate above
 * judge.falsePositiveAlert flags retuning.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fg from "fast-glob";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import pc from "picocolors";
import { DocevalsError } from "../types.js";
import { loadConfig } from "../core/config.js";
import { readPage } from "../core/discover.js";
import { resolvePage } from "../core/resolve.js";
import { contentHash, loadReviews } from "../core/reviews.js";
import { makeJudge } from "../judge/judge.js";
import { isTurnBudgetSkip } from "../judge/budget.js";
import { makeProvider } from "../judge/provider.js";
import type { JudgeFn } from "../core/engine.js";
import type { GraderTarget } from "../graders/types.js";

export const AGREEMENT_THRESHOLD = 0.7;

/** Default golden directory, relative to the working directory. */
export const GOLDEN_DIR = join(".manni/docevals", "golden");

/** File `--seed` writes. Named so a hand-authored set beside it stays distinct. */
export const SEEDED_GOLDEN_FILE = "from-reviews.yaml";

export interface GoldenCase {
  file: string;
  eval: string;
  expected: "pass" | "fail";
  rationale?: string;
  /**
   * Whether a human has confirmed this case belongs in the golden set.
   *
   * Absent means `false`, deliberately. This is the instrument that measures
   * the judge, so a back-compatible default would silently bless every case
   * that already exists — including the seeded ones the bit exists to surface.
   */
  reviewed: boolean;
  /** Page body hash when the verdict was formed; mismatch means stale. */
  contentHash?: string;
  source?: "review" | "manual";
  reviewedBy?: string;
}

export interface CalibrationCaseResult extends GoldenCase {
  judged?: "pass" | "fail";
  agrees?: boolean;
  error?: string;
  /**
   * Set when the turn budget, not the judge, is why this case has no verdict.
   * A flag rather than a substring of `error`: the message is user-facing and
   * interpolates a golden case's own `eval` value, so matching on it both
   * broke when the wording changed and miscounted a case named after it.
   */
  budgetSkipped?: boolean;
  /** The page no longer hashes to what this case was verified against. */
  stale?: boolean;
}

export interface CalibrationReport {
  cases: CalibrationCaseResult[];
  total: number;
  agreements: number;
  agreementRate: number;
  falsePositives: number;
  falsePositiveRate: number;
  falseNegatives: number;
  /**
   * True when `agreementRate >= AGREEMENT_THRESHOLD` — a statement about
   * the cases that were *judged*, and nothing else.
   *
   * Read `unjudged === 0` alongside it. A budget-truncated or partly
   * unresolvable run can meet the rate on the sample it measured while
   * `unjudged > 0` says it measured less than the set. The CLI gates on both;
   * a consumer reading this field alone gets a pass on a partial run.
   */
  meetsThreshold: boolean;
  /** Judged cases a human marked `expected: pass`. */
  expectedPass: number;
  /** Judged cases a human marked `expected: fail`. */
  expectedFail: number;
  /**
   * True when both classes are represented among the judged cases.
   *
   * A golden set of only-passes certifies a judge that always answers pass:
   * agreement 100%, false negatives 0, threshold met. The measurement is
   * vacuous, not good. Kept out of `meetsThreshold` for the same reason
   * `unjudged` is (ADR 01018) — that stays a statement about agreement, and
   * this is a statement about whether the set could have detected a
   * disagreement at all. The CLI gates on all three.
   */
  balanced: boolean;
  fpAlert: boolean;
  /** Judged cases no human has confirmed. Counted, but reported. */
  unreviewed: number;
  /** Judged cases whose page has changed since verification. */
  stale: number;
  /** Cases the turn budget prevented from being judged at all. */
  budgetSkipped: number;
  /**
   * Cases that never reached a verdict, for any reason: a missing page, an
   * unresolvable eval, an errored judge, or the turn budget. The agreement
   * rate is over the rest, so a non-zero value means it measured a sample.
   *
   * Kept separate from `meetsThreshold` rather than folded into it, following
   * ADR 01018: the verdict stays a statement about agreement, and this stays a
   * statement about coverage. Overloading one boolean made the report print
   * "refine your assertions" at 100% agreement.
   */
  unjudged: number;
}

export interface CalibrateOptions {
  config?: string;
  golden?: string;
  provider?: string;
  model?: string;
  runs?: number;
  maxTurns?: number | null;
  noCache?: boolean;
  cwd?: string;
  /** Injectable judge for tests. */
  judge?: JudgeFn;
}

/** File keys are kebab-case (ADR 01010); everything downstream is camelCase. */
function normalizeGoldenCase(raw: Record<string, unknown>): GoldenCase {
  return {
    file: raw.file as string,
    eval: raw.eval as string,
    expected: raw.expected as "pass" | "fail",
    ...(typeof raw.rationale === "string" ? { rationale: raw.rationale } : {}),
    reviewed: raw.reviewed === true,
    ...(typeof raw["content-hash"] === "string"
      ? { contentHash: raw["content-hash"] }
      : {}),
    ...(raw.source === "review" || raw.source === "manual"
      ? { source: raw.source }
      : {}),
    ...(typeof raw["reviewed-by"] === "string"
      ? { reviewedBy: raw["reviewed-by"] }
      : {}),
  };
}

/** camelCase back out to the kebab file vocabulary, dropping empty fields. */
function serializeGoldenCase(c: GoldenCase): Record<string, unknown> {
  return {
    file: c.file,
    eval: c.eval,
    expected: c.expected,
    ...(c.rationale === undefined ? {} : { rationale: c.rationale }),
    reviewed: c.reviewed,
    ...(c.contentHash === undefined ? {} : { "content-hash": c.contentHash }),
    ...(c.source === undefined ? {} : { source: c.source }),
    ...(c.reviewedBy === undefined ? {} : { "reviewed-by": c.reviewedBy }),
  };
}

export function loadGoldenCases(dir: string): GoldenCase[] {
  if (!existsSync(dir)) {
    throw new DocevalsError(
      `Golden set directory not found: ${dir} — seed it from recorded reviews with ` +
        `\`manni docevals calibrate --seed\`, or hand-author 20-50 verified cases`,
    );
  }
  const files = fg.sync("*.{yaml,yml}", { cwd: dir, absolute: true });
  const cases: GoldenCase[] = [];
  for (const file of files) {
    const raw = parseYaml(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      const c = item as Record<string, unknown>;
      if (
        typeof c.file === "string" &&
        typeof c.eval === "string" &&
        (c.expected === "pass" || c.expected === "fail")
      ) {
        cases.push(normalizeGoldenCase(c));
      } else {
        throw new DocevalsError(
          `Invalid golden case in ${file}: needs file, eval, expected: pass|fail`,
        );
      }
    }
  }
  if (cases.length === 0) {
    throw new DocevalsError(`No golden cases found in ${dir}`);
  }
  return cases;
}

export interface SeedResult {
  path: string;
  added: number;
  updated: number;
  total: number;
  /** Cases in the written file still awaiting human confirmation. */
  unreviewed: number;
}

/**
 * Turn recorded human reviews into golden *candidates* (ADR 01016).
 *
 * Judges nothing and constructs no provider, which is what lets this run in CI
 * where there is no API key. Every case lands `reviewed: false`: a `review`
 * verdict is a call made on one page to clear a queue, and promoting it to
 * calibration ground truth without a second look conflates "I unblocked this
 * build" with "this is what correct looks like".
 */
export function seedGoldenCases(options: CalibrateOptions = {}): SeedResult {
  const cwd = options.cwd ?? process.cwd();
  const dir = resolve(cwd, options.golden ?? GOLDEN_DIR);
  const path = join(dir, SEEDED_GOLDEN_FILE);

  // An emptied or hand-broken seed file degrades to "nothing recorded yet"
  // rather than throwing, the same way `loadReviews` treats its own store: the
  // next seed then rebuilds it, where a throw would strand the user.
  const priorRaw: unknown = existsSync(path)
    ? parseYaml(readFileSync(path, "utf8"))
    : null;
  const existing: GoldenCase[] = Array.isArray(priorRaw)
    ? priorRaw
        .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
        .map(normalizeGoldenCase)
    : [];

  // NUL-separated, as docmeta's fingerprint keys are, and for the same reason:
  // a printable separator lets ("a b", "c") and ("a", "b c") collide into one
  // key. A file path may contain a space; nothing may contain a NUL.
  const byKey = new Map(existing.map((c) => [`${c.file}\0${c.eval}`, c]));
  let added = 0;
  let updated = 0;

  for (const review of loadReviews(cwd)) {
    const key = `${review.file}\0${review.evalName}`;
    const prior = byKey.get(key);
    // Re-seeding as reviews accumulate must not duplicate, and must not
    // silently un-review a case a human has already confirmed. But a confirmed
    // bit describes a *verdict*, not a filename: if the recorded verdict has
    // flipped since, this is materially a different case and has to be read
    // again. Carrying the bit across a flip would let `expected` change under a
    // human's signature.
    const confirmedStillApplies =
      prior?.reviewed === true && prior.expected === review.verdict;
    const next: GoldenCase = {
      file: review.file,
      eval: review.evalName,
      expected: review.verdict,
      // A review's note wins when it has one; otherwise keep whatever the
      // human wrote into the file. Rebuilding the entry from the review alone
      // erased the reasoning behind a case the same human had just marked
      // `reviewed: true` -- and it is the field renderCalibration prints on
      // every disagreement.
      ...(review.note !== undefined
        ? { rationale: review.note }
        : prior?.rationale !== undefined
          ? { rationale: prior.rationale }
          : {}),
      reviewed: confirmedStillApplies,
      contentHash: review.contentHash,
      source: "review",
      ...(confirmedStillApplies && prior.reviewedBy !== undefined
        ? { reviewedBy: prior.reviewedBy }
        : {}),
    };
    byKey.set(key, next);
    // A re-seed rewrites every case, but only a *changed* one is an update.
    // Counting every key that already existed made `updated` report movement
    // on a run that moved nothing — and the two counts are separate
    // (ADR 01016) precisely so the difference between runs is visible.
    if (!prior) added += 1;
    else if (
      JSON.stringify(serializeGoldenCase(prior)) !==
      JSON.stringify(serializeGoldenCase(next))
    ) {
      updated += 1;
    }
  }

  const cases = [...byKey.values()];
  if (cases.length > 0) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, stringifyYaml(cases.map(serializeGoldenCase)));
  }
  return {
    path,
    added,
    updated,
    total: cases.length,
    unreviewed: cases.filter((c) => !c.reviewed).length,
  };
}

export async function runCalibrate(
  options: CalibrateOptions = {},
): Promise<CalibrationReport> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(options.config, cwd);
  const goldenDir = resolve(cwd, options.golden ?? GOLDEN_DIR);
  const cases = loadGoldenCases(goldenDir);

  // Resolve every case to a target first, then judge the whole set in one call
  // (ADR 01016). Judging case-by-case left the bounded-concurrency pool inside
  // makeJudge with one target at a time, and made a turn budget mean *per case*.
  const results: CalibrationCaseResult[] = [];
  const targets: GraderTarget[] = [];
  const targetIndex: number[] = [];

  for (const goldenCase of cases) {
    const absPath = resolve(cwd, goldenCase.file);
    if (!existsSync(absPath)) {
      results.push({ ...goldenCase, error: "page not found" });
      continue;
    }
    const page = readPage(absPath, cwd);
    const plan = resolvePage(page, config);
    const ev = plan.evals.find(
      (e) => e.name === goldenCase.eval && e.grader === "ai",
    );
    if (!ev) {
      results.push({
        ...goldenCase,
        error: `ai-graded eval "${goldenCase.eval}" not resolvable on this page`,
      });
      continue;
    }
    // A verdict is about the words a human read. Once the page no longer
    // hashes to what was verified, the case describes a document that no
    // longer exists — the same rule `findReview` applies to a review.
    const stale =
      goldenCase.contentHash !== undefined &&
      goldenCase.contentHash !== contentHash(plan.page.body);

    targetIndex.push(results.length);
    results.push({ ...goldenCase, ...(stale ? { stale } : {}) });
    targets.push({ plan, eval: ev });
  }

  if (targets.length > 0) {
    const judge =
      options.judge ??
      makeJudge({
        provider: makeProvider(config, {
          provider: options.provider,
          model: options.model,
        }),
        root: cwd,
      });
    const judged = await judge(targets, config, {
      runs: options.runs,
      noCache: options.noCache,
      maxTurns: options.maxTurns,
    });
    for (const [i, at] of targetIndex.entries()) {
      const slot = results[at]!;
      const consensus = judged[i]?.consensus;
      if (!consensus) {
        // Distinguish "the budget ran out" from "the judge failed": the
        // first is a coverage problem that must not be allowed to certify
        // anything, and it used to disappear into the same error bucket.
        const reason = judged[i]?.skipReason;
        const fromBudget = isTurnBudgetSkip(reason);
        results[at] = {
          ...slot,
          ...(fromBudget ? { budgetSkipped: true } : {}),
          error: fromBudget ? `not judged: ${reason}` : "judge returned no consensus",
        };
        continue;
      }
      const verdict = consensus.verdict === "pass" ? "pass" : "fail";
      results[at] = {
        ...slot,
        judged: verdict,
        agrees: verdict === slot.expected,
      };
    }
  }

  const judgedCases = results.filter((r) => r.judged != null);
  const agreements = judgedCases.filter((r) => r.agrees).length;
  const expectedPass = judgedCases.filter((r) => r.expected === "pass");
  // False positive: the judge flags a failure a human verified as passing.
  const falsePositives = expectedPass.filter((r) => r.judged === "fail").length;
  const expectedFailCases = judgedCases.filter((r) => r.expected === "fail");
  const falseNegatives = expectedFailCases.filter(
    (r) => r.judged === "pass",
  ).length;
  const agreementRate = judgedCases.length > 0 ? agreements / judgedCases.length : 0;
  const falsePositiveRate =
    expectedPass.length > 0 ? falsePositives / expectedPass.length : 0;

  // A budget-truncated run measured a sample, and the agreement rate is over
  // that sample — so the run must not certify. The guard is in
  // `src/cli.ts` (`meetsThreshold && unjudged === 0`), not in `meetsThreshold`
  // itself: ADR 01018 keeps the verdict a statement about agreement and this a
  // statement about coverage. This is the same silent-green shape `runEvals`
  // guards against; `calibrate` is the command whose whole output is a trust
  // claim, so there it fails the run rather than merely warning.
  const budgetSkipped = results.filter((r) => r.budgetSkipped === true).length;
  const unjudged = results.length - judgedCases.length;

  return {
    cases: results,
    budgetSkipped,
    unjudged,
    unreviewed: judgedCases.filter((r) => !r.reviewed).length,
    stale: judgedCases.filter((r) => r.stale === true).length,
    total: results.length,
    agreements,
    agreementRate,
    falsePositives,
    falsePositiveRate,
    falseNegatives,
    meetsThreshold: agreementRate >= AGREEMENT_THRESHOLD,
    expectedPass: expectedPass.length,
    expectedFail: expectedFailCases.length,
    balanced: expectedPass.length > 0 && expectedFailCases.length > 0,
    fpAlert: falsePositiveRate > config.judge.falsePositiveAlert,
  };
}

export function renderCalibration(report: CalibrationReport): string {
  const lines: string[] = [];
  for (const c of report.cases) {
    if (c.error) {
      lines.push(`${pc.red("error")} ${c.file} ${c.eval}: ${c.error}`);
      continue;
    }
    const tag = c.agrees ? pc.green("agree") : pc.red("DISAGREE");
    const flags = [
      c.reviewed ? "" : pc.yellow(" [unreviewed]"),
      c.stale ? pc.yellow(" [stale]") : "",
    ].join("");
    lines.push(
      `${tag} ${c.file} ${pc.bold(c.eval)}${flags}: judge=${c.judged ?? "(no verdict)"} human=${c.expected}` +
        (!c.agrees && c.rationale ? pc.dim(` — human: ${c.rationale}`) : ""),
    );
  }
  lines.push("");
  // Denominator stated explicitly: the rate is over the cases that were
  // actually judged, which is not `total` when pages are missing or the budget
  // ran out. Printing "1/30 (100%)" left those two numbers contradicting.
  const judged = report.cases.filter((c) => c.judged != null).length;
  lines.push(
    `Agreement: ${report.agreements}/${judged} judged (${(report.agreementRate * 100).toFixed(0)}%) — threshold ${(AGREEMENT_THRESHOLD * 100).toFixed(0)}%` +
      (judged === report.total ? "" : ` — ${report.total - judged} of ${report.total} case(s) not judged`),
  );
  lines.push(
    `False positives: ${report.falsePositives} (${(report.falsePositiveRate * 100).toFixed(0)}% of human-passes), false negatives: ${report.falseNegatives}`,
  );
  if (report.unjudged > 0) {
    lines.push(
      pc.red(
        `
${report.unjudged} of ${report.total} case(s) never reached a verdict, so the rate above ` +
          `is over a sample. A calibration measured on part of the set does not certify the judge.`,
      ),
    );
  }
  if (judged > 0 && !report.balanced) {
    const missing = report.expectedFail === 0 ? "fail" : "pass";
    const always = missing === "fail" ? "pass" : "fail";
    lines.push(
      pc.red(
        `
No \`expected: ${missing}\` cases among the ${judged} judged. A judge that answered ` +
          `"${always}" every time would score 100% here, so this run cannot certify anything. ` +
          `Add at least one case the judge should ${missing === "fail" ? "reject" : "accept"}.`,
      ),
    );
  }
  // Only when something was actually measured. "Refine the eval criteria" is
  // advice about a rate, and there is no rate over zero judged cases.
  if (judged > 0 && !report.meetsThreshold) {
    lines.push(
      pc.red(
        "\nAgreement is below threshold. Refine the eval criteria first — make assertions more specific — before changing the grading mechanism.",
      ),
    );
  }
  if (report.budgetSkipped > 0) {
    lines.push(
      pc.red(
        `
${report.budgetSkipped} case(s) were never judged: the turn budget ran out. ` +
          `A rate measured over the rest is not a calibration — raise --max-turns and re-run.`,
      ),
    );
  }
  if (report.fpAlert) {
    lines.push(
      pc.yellow(
        "\nFalse-positive rate exceeds judge.falsePositiveAlert — the judge is flagging content humans accept. Consider tightening assertions or examples.",
      ),
    );
  }
  // Counted, but never quietly. The rate above is the artifact handed to a
  // skeptic; a reader has to be able to discount it by exactly this much
  // (ADR 01016).
  if (report.unreviewed > 0) {
    lines.push(
      pc.yellow(
        `\n${report.unreviewed} of ${report.total} case(s) are unreviewed — they count toward the rate above, ` +
          `but no human has confirmed they belong in the golden set. Read them and set \`reviewed: true\`.`,
      ),
    );
  }
  if (report.stale > 0) {
    lines.push(
      pc.yellow(
        `\n${report.stale} case(s) are stale: the page changed since the verdict was recorded, so the case ` +
          `describes a document that no longer exists. Re-verify and update \`content-hash\`.`,
      ),
    );
  }
  return lines.join("\n");
}
