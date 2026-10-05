import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the docs domain: exit 2. */
export class DocsError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "DocsError";
  }
}
