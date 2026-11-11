/** Shared types for manni vector. */
import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the vector domain: exit 2. */
export class VectorError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "VectorError";
  }
}
