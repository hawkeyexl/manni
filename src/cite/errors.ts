import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the citation tool: exit 2. */
export class CiteError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "CiteError";
  }
}
