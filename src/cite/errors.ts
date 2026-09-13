import { ToolError } from "../shared/errors.js";
import { LineRangeError } from "../shared/pin.js";

/** An operational or usage error in the citation tool: exit 2. */
export class CiteError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "CiteError";
  }
}

/**
 * Run a shared pin-engine call under cite's error contract: a
 * `LineRangeError` comes back as a `CiteError` with the same message, which is
 * what cite's callers (and library users of the `cite` namespace) match on.
 */
export function asCiteError<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    if (error instanceof LineRangeError) throw new CiteError(error.message);
    throw error;
  }
}
