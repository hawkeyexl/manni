/**
 * `parseSpecBatch`: reading a `git cat-file --batch` answer. A header that
 * cannot be read, or an answer cut short, is refused rather than read as the
 * rest of the specs being absent, which would report their stamps stale.
 */
import { describe, expect, it } from "vitest";
import { parseSpecBatch } from "../src/meta/core/derive/git.js";

const SHA = "a".repeat(40);
const batch = (...parts: string[]): Buffer => Buffer.from(parts.join(""), "utf8");

describe("parseSpecBatch", () => {
  it("reads each spec's blob in input order and skips a missing one", () => {
    const out = batch(`${SHA} blob 5\nhello\n`, "HEAD:gone.md missing\n", `${SHA} blob 3\nbye\n`);
    const found = parseSpecBatch(out, ["HEAD:a.md", "HEAD:gone.md", "HEAD:b.md"]);
    expect([...found]).toEqual([
      ["HEAD:a.md", "hello"],
      ["HEAD:b.md", "bye"],
    ]);
  });

  it("refuses a header it cannot read instead of dropping the specs after it", () => {
    const out = batch(`${SHA} blob 5\nhello\n`, "garbled\n", `${SHA} blob 3\nbye\n`);
    expect(() => parseSpecBatch(out, ["HEAD:a.md", "HEAD:b.md", "HEAD:c.md"])).toThrow(
      "unreadable header for HEAD:b.md: garbled",
    );
  });

  it("refuses an answer that ends before every spec is answered", () => {
    const out = batch(`${SHA} blob 5\nhello\n`);
    expect(() => parseSpecBatch(out, ["HEAD:a.md", "HEAD:b.md"])).toThrow(
      "the answer ends before HEAD:b.md",
    );
  });
});
