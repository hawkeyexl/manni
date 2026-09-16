/**
 * The side-effect form the extend guide documents: import `registerGrader`
 * from the package and call it while the module evaluates.
 *
 * This only works when the specifier resolves to the *same* copy of
 * manni tracevals the CLI is running — which is why it is exercised through the
 * built CLI rather than from the unit suite, where `@hawkeyexl/manni/tracevals` resolves to
 * `dist/` and the tests run out of `src/`.
 */
import { registerGrader } from "@hawkeyexl/manni/tracevals";

registerGrader({
  kind: "wrote-something",
  validateOptions: () => undefined,
  grade: ({ trace, plan }) =>
    trace.fileAccesses.some((a) => a.op !== "read")
      ? { findings: [] }
      : {
          findings: [
            {
              evalName: plan.evalName,
              artifact: plan.artifact.path,
              message: "the session wrote no file",
              severity: plan.severity,
            },
          ],
        },
});
