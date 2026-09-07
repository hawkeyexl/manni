/**
 * GitHub Actions workflow-command primitives, for meta's renderers.
 *
 * The functions live in `src/shared/github.ts` now, since the a11y reporter
 * emits the same commands. Re-exported here so meta's callers and tests keep
 * their import path.
 */
export {
  escapeWorkflowCommandMessage,
  escapeWorkflowCommandProperty,
} from "../../shared/github.js";
