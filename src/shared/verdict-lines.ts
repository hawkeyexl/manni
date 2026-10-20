/**
 * The judged block docevals and tracevals print under a judged eval
 * (proposal 0089, C2): the verdict and what to do, then what the judge
 * observed and why. Every reporter of both tools renders it from here.
 */
import type { ConsensusResult, JudgeVerdict } from "@hawkeyexl/inference";

/**
 * The run a report quotes: the first whose verdict did not pass, else the
 * first with a verdict. A failing consensus can hold a passing run, and
 * quoting it would argue against the verdict it sits under.
 */
export function evidenceVerdict(consensus: ConsensusResult): JudgeVerdict | undefined {
  const withVerdict = consensus.runs.filter((r) => r.verdict !== undefined);
  return (withVerdict.find((r) => r.verdict?.match !== "pass") ?? withVerdict[0])?.verdict;
}

/**
 * `AI judge: <verdict> (confidence N). <direction>`, then `Observed: …` and
 * `Reasoning: …` when the quoted run has them.
 */
export function verdictLines(
  consensus: ConsensusResult,
  verdict: string,
  direction: string,
): string[] {
  const v = evidenceVerdict(consensus);
  return [
    `AI judge: ${verdict} (confidence ${consensus.meanConfidence.toFixed(2)}). ${direction}`,
    ...(v?.observed ? [`Observed: ${v.observed}`] : []),
    ...(v?.reasoning ? [`Reasoning: ${v.reasoning}`] : []),
  ];
}
