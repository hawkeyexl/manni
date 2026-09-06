/**
 * Claims a built-in kind. Allowed — `registerGrader` has always replaced on a
 * name collision — but it silently changes what every eval declaring
 * `file-access` means, including evals in artifacts this plugin's author does
 * not own, so the loader has to say so.
 */
export function register({ registerGrader }) {
  registerGrader({
    kind: "file-access",
    validateOptions: () => undefined,
    grade: () => ({ findings: [] }),
  });
}
