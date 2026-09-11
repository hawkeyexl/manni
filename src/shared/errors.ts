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

/**
 * The message a caught value carries, whatever was thrown.
 *
 * JavaScript can throw anything, so `(err as Error).message` is `undefined`
 * for a thrown string, number or `null`, and "undefined" is what the user
 * reads. An Error, or anything with a string `message`, gives that message.
 * A string is its own message. Anything else gives its JSON text, or its
 * `String()` form when it will not serialise.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof err.message === "string"
  ) {
    return err.message;
  }
  try {
    // Typed as returning a string, but `undefined`, a function or a symbol
    // gives `undefined`.
    const json = JSON.stringify(err) as string | undefined;
    if (json !== undefined) return json;
  } catch {
    // A cycle, or a BigInt: fall through to the one form that always exists.
  }
  return String(err);
}
