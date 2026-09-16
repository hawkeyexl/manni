/** Named three ways in one call, to prove it is imported exactly once. */
export function register({ registerGrader }) {
  registerGrader({
    kind: "dedup-probe",
    validateOptions: () => undefined,
    grade: () => ({ findings: [] }),
  });
}
