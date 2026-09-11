import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the key domain: exit 2. */
export class KeyError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "KeyError";
  }
}
