import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the test domain: exit 2. */
export class TestError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "TestError";
  }
}
