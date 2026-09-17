import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the term tool: exit 2. */
export class TermError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "TermError";
  }
}
