import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the site domain: exit 2. */
export class SiteError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "SiteError";
  }
}
