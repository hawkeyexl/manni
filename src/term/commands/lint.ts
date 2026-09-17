/**
 * `manni term lint`: each entry's prose through Vale (proposal 0052 § 6). The
 * process seam is `lintTermSet`'s; this core resolves Vale's config from the
 * family `tools:` and shapes the report `check` shares.
 */
import { lintTermSet, type LintTermSetOptions } from "../core/lint.js";
import { summarize, toResults, reportedFindings, type TermReport } from "./findings.js";
import { loadTerms, valeConfigFor, type TermCommandOptions } from "./run.js";

export interface LintOptions extends TermCommandOptions {
  /** The Vale seam. Tests hand in a stub. */
  runVale?: LintTermSetOptions["runVale"];
}

export async function runLint(opts: LintOptions): Promise<TermReport> {
  const { cwd, run, set } = await loadTerms(opts);
  const valeConfig = valeConfigFor(run);
  const findings = await lintTermSet(set, {
    cwd,
    ...(valeConfig === undefined ? {} : { valeConfig }),
    ...(opts.runVale === undefined ? {} : { runVale: opts.runVale }),
  });
  const { results, origin } = toResults(set, findings);
  return {
    findings: reportedFindings(results, origin),
    results,
    summary: summarize(results),
    frame: { cwd, base: run.configDir ?? cwd, runBase: run.base },
    terms: set.terms.length,
    references: set.references.length,
    found: findings.length,
    cwd,
  };
}
