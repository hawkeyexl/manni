import { describe, expect, it } from "vitest";
import { TracevalsError } from "../../../src/tracevals/types.js";

describe("package skeleton", () => {
  it("exposes TracevalsError with the operational-error name", () => {
    const err = new TracevalsError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TracevalsError");
    expect(err.message).toBe("boom");
  });
});
