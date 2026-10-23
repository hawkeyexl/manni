import { ToolError } from "../shared/errors.js";

/** An operational or usage error in the strategy tool: exit 2. */
export class StrategyError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "StrategyError";
  }
}
