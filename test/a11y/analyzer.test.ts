/**
 * The analyzer's mapping from axe's impact onto the family severity scale,
 * and the one browser-backed case the built bin cannot pin down: a page's
 * own late navigation reaching the next page. The rest of the browser path
 * is exercised in `cli.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  createPlaywrightAnalyzer,
  findBrowser,
  refreshUrl,
  severityOf,
} from "../../src/a11y/core/analyzer.js";
import { startSchemaServer, type SchemaServer } from "../helpers/schema-server.js";

const browser = await findBrowser();

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

describe.skipIf(browser === null)("one page's navigation and the next page (real browser)", () => {
  const page = (script = "") => ({
    body: `<!doctype html><html lang="en"><head><title>Page</title>${script}</head><body><main><h1>Page</h1></main></body></html>`,
    contentType: "text/html",
  });

  it("a page that navigates after it was analyzed does not abort the next page's load", async () => {
    // `/late.html` sends the browser elsewhere only once the next page has
    // been requested, so its navigation always overlaps the next load. The
    // next page answers slowly to hold that overlap open.
    const late = `<script>setInterval(async () => {
      if ((await (await fetch("/go")).text()) === "go") location.replace("/elsewhere.html");
    }, 20);</script>`;
    const server: SchemaServer = await startSchemaServer({
      "/late.html": page(late),
      "/go": () => ({ body: server.hits("/next.html") > 0 ? "go" : "wait", contentType: "text/plain" }),
      "/next.html": { ...page(), delayMs: 1000 },
      "/elsewhere.html": page(),
    });
    const analyzer = createPlaywrightAnalyzer();
    const opts = { timeout: 15_000, tags: [] };
    try {
      const first = await analyzer.analyze(`${server.url}/late.html`, opts);
      expect("result" in first).toBe(true);
      const next = await analyzer.analyze(`${server.url}/next.html`, opts);
      expect("redirect" in next ? next.redirect : next.finalUrl).toBe(`${server.url}/next.html`);
    } finally {
      await analyzer.close();
      await server.close();
    }
  }, 60_000);
});
