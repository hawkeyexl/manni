/**
 * `noticeOnce`: a notice about a condition the run meets many times, such as
 * `--local` replacing the provider an eval names, said once per message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noticeOnce, resetWarnings } from "../src/shared/warn.js";

describe("noticeOnce", () => {
  let written: string[];

  beforeEach(() => {
    resetWarnings();
    written = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetWarnings();
  });

  it("writes each distinct message to stderr once", () => {
    noticeOnce("first");
    noticeOnce("second");
    noticeOnce("first");
    expect(written).toHaveLength(2);
    expect(written[0]).toMatch(/: first\n$/);
    expect(written[1]).toMatch(/: second\n$/);
  });

  it("says a message again after resetWarnings", () => {
    noticeOnce("again");
    resetWarnings();
    noticeOnce("again");
    expect(written).toHaveLength(2);
  });
});
