/**
 * `manni term check`: the referential integrity of the set (proposal 0052 § 7),
 * with the baseline ratchet meta and cite use.
 *
 * `--baseline` is one flag for both halves of the ratchet. When the baseline
 * file is not there yet, the run records one and exits 0: that is how a docset
 * whose terms were never checked ramps in. When it is there, the run fails only
 * on findings it does not hold. A configured `term.baseline` compares without
 * the flag, as `cite.baseline` does.
 */
import { existsSync } from "node:fs";
import { resolveBaselineRequest, settleBaseline } from "../../meta/internal.js";
import { checkTermSet } from "../core/check.js";
import { DEFAULT_TERM_BASELINE_PATH } from "../core/config.js";
import { TermError } from "../errors.js";
import { reportedFindings, summarize, toResults, type TermReport } from "./findings.js";
import { loadTerms, type TermCommandOptions } from "./run.js";

export interface CheckOptions extends TermCommandOptions {
  /** `--baseline`. */
  baseline?: boolean;
}

export async function runCheck(opts: CheckOptions): Promise<TermReport> {
  const { cwd, run, set } = await loadTerms(opts);
  const config = run.config;
  const findings = checkTermSet(set, {
    ...(config?.severity === undefined ? {} : { severity: config.severity }),
    ...(config?.abstractMaxLength === undefined ? {} : { abstractMaxLength: config.abstractMaxLength }),
  });
  const { results, origin } = toResults(set, findings);

  // Fingerprints must not depend on where the command was run from.
  const frame = { cwd, base: run.configDir ?? cwd, runBase: run.base };
  let request = resolveBaselineRequest(
    opts.baseline === true ? { baseline: true } : {},
    config?.baseline,
    run.configDir,
    cwd,
    { current: DEFAULT_TERM_BASELINE_PATH },
  );
  if (request !== null && !existsSync(request.absPath)) {
    if (opts.baseline !== true) {
      throw new TermError(
        `Baseline "${request.label}" not found. Record one with \`manni term check --baseline\`.`,
      );
    }
    request = { ...request, write: true };
  }
  const { results: reported, baseline } = await settleBaseline(results, request, frame);

  return {
    findings: reportedFindings(reported, origin),
    results: reported,
    summary: summarize(reported, baseline),
    frame,
    terms: set.terms.length,
    references: set.references.length,
    ...(baseline === undefined ? {} : { baseline }),
    found: findings.length,
    cwd,
  };
}
