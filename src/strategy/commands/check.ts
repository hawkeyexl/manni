/**
 * `manni strategy check`: the pages against the records, and the records
 * against each other, with the baseline ratchet term and cite use.
 *
 * `--baseline` records the findings when the file is not there yet, and after
 * that fails only on findings it does not hold. A configured
 * `strategy.baseline` compares without the flag.
 */
import { existsSync } from "node:fs";
import { resolveBaselineRequest, settleBaseline } from "../../meta/internal.js";
import { checkStrategySet } from "../core/check.js";
import { DEFAULT_STRATEGY_BASELINE_PATH } from "../core/config.js";
import { StrategyError } from "../errors.js";
import { reportedFindings, summarize, toResults, type StrategyReport } from "./findings.js";
import { displayPath, loadStrategy, type StrategyCommandOptions } from "./run.js";

export interface CheckOptions extends StrategyCommandOptions {
  /** `--baseline`. */
  baseline?: boolean;
}

export async function runCheck(opts: CheckOptions): Promise<StrategyReport> {
  const { cwd, run, set, steps, owns } = await loadStrategy(opts);
  const config = run.config;
  const findings = checkStrategySet(set, {
    ...(config?.severity === undefined ? {} : { severity: config.severity }),
    steps,
    pagePath: (page) => displayPath(page, cwd, run.base),
    owns,
  });
  const { results, origin } = toResults(set, findings, owns);

  // Fingerprints must not depend on where the command was run from.
  const frame = { cwd, base: run.configDir ?? cwd, runBase: run.base };
  let request = resolveBaselineRequest(
    opts.baseline === true ? { baseline: true } : {},
    config?.baseline,
    run.configDir,
    cwd,
    { current: DEFAULT_STRATEGY_BASELINE_PATH },
  );
  if (request !== null && !existsSync(request.absPath)) {
    if (opts.baseline !== true) {
      throw new StrategyError(`Baseline "${request.label}" not found. Record one with \`manni strategy check --baseline\`.`);
    }
    request = { ...request, write: true };
  }
  const { results: reported, baseline } = await settleBaseline(results, request, frame);

  const parents = set.records.reduce((n, r) => n + r.parents.length, 0);
  return {
    findings: reportedFindings(reported, origin, findings),
    results: reported,
    origin,
    summary: summarize(reported, baseline),
    frame,
    records: set.records.length,
    borrowed: set.records.filter((r) => !owns(r.file)).length,
    // Two kinds, both resolved: every audiences:, personas: and journeys:
    // value (pages and records alike), plus each value of a record's own
    // parent field, which load-set keeps out of the references.
    references: set.references.length + parents,
    // Only an owned journey's steps are held to their pages.
    steps: [...steps].reduce((n, [record, s]) => n + (owns(record.file) ? s.length : 0), 0),
    ...(baseline === undefined ? {} : { baseline }),
    found: findings.length,
    cwd,
    base: run.base,
  };
}
