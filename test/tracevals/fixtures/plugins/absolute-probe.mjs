/**
 * Exists so the absolute-path case loads a module no other case has. Plugins
 * load once per process, so reusing one fixture across the resolution cases
 * would leave every case after the first asserting nothing.
 */
export function register({ registerGrader }) {
  registerGrader({
    kind: "absolute-probe",
    validateOptions: () => undefined,
    grade: () => ({ findings: [] }),
  });
}
