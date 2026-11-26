/**
 * `baseIri:`, the family-level prefix of every node IRI (proposal 0128 §1).
 * One value for every domain that mints ids, so their ids join. Its
 * normalization is covered through graph's re-export, in test/graph/unit/iri.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseBaseIri } from "../../src/shared/base-iri.js";

const SOURCE = "manni.config.yaml";
const toError = (message: string): Error => new Error(message);

describe("parseBaseIri", () => {
  it("keeps the value as written", () => {
    expect(parseBaseIri("https://example.com/id", SOURCE, toError)).toBe(
      "https://example.com/id",
    );
  });

  it.each([[""], [null], [42], [["https://example.com/"]], [{}]])(
    "refuses %j",
    (raw) => {
      expect(() => parseBaseIri(raw, SOURCE, toError)).toThrow(
        'manni.config.yaml: "baseIri" must be a non-empty string.',
      );
    },
  );
});
