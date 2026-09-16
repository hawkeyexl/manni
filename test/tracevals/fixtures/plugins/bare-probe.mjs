/**
 * Re-exported by a package assembled in a temp directory, to prove a bare name
 * resolves from the config's directory rather than from beside this package.
 */
export function register({ registerGrader }) {
  registerGrader({
    kind: "bare-probe",
    validateOptions: () => undefined,
    grade: () => ({ findings: [] }),
  });
}
