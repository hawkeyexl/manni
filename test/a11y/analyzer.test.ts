/**
 * The analyzer's mapping from axe's impact onto the family severity scale.
 * The browser-backed path is exercised in `cli.integration.test.ts`; this
 * file pins the one pure function the analyzer exports.
 */
import { describe, expect, it } from "vitest";
import { refreshUrl, severityOf } from "../../src/a11y/core/analyzer.js";

describe("severityOf", () => {
  it("maps axe's four impacts onto the three family levels", () => {
    expect(severityOf("critical")).toBe("error");
    expect(severityOf("serious")).toBe("error");
    expect(severityOf("moderate")).toBe("warning");
    expect(severityOf("minor")).toBe("notice");
  });

  it("treats a missing impact as the lowest level", () => {
    expect(severityOf(null)).toBe("notice");
    expect(severityOf(undefined)).toBe("notice");
  });
});

describe("refreshUrl", () => {
  it("reads the URL from a meta refresh's content", () => {
    expect(refreshUrl("0;url=/x")).toBe("/x");
    expect(refreshUrl("0; url=/x")).toBe("/x");
  });

  it("is case-insensitive and drops quotes around the URL", () => {
    expect(refreshUrl("5; URL='x'")).toBe("x");
    expect(refreshUrl('5;Url="/y/z"')).toBe("/y/z");
  });

  it("takes a comma as the separator too", () => {
    expect(refreshUrl("0, url=/y")).toBe("/y");
  });

  it("takes a URL with no url= in front of it", () => {
    expect(refreshUrl("0; /plain")).toBe("/plain");
  });

  it("finds no URL in a bare delay, which is a reload", () => {
    expect(refreshUrl("5")).toBeNull();
    expect(refreshUrl("0;")).toBeNull();
    expect(refreshUrl("0; url=")).toBeNull();
    expect(refreshUrl("")).toBeNull();
  });
});
