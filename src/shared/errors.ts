/**
 * The error every tool under the umbrella throws for an operational failure.
 *
 * Each tool keeps its own subclass (`DocmetaError`, …) so its tests and
 * library callers can match on it. The base is what the shared bin runner
 * matches on: a `ToolError` is reported as one line and exit 2, anything else
 * is a bug and keeps its stack trace.
 */
export class ToolError extends Error {
  /** clig.dev: 2 is operational/usage; 1 is reserved for findings. */
  readonly exitCode: number = 2;

  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}
