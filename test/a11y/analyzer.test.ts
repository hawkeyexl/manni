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
  loadFailureMessage,
  refreshUrl,
  severityOf,
  toViolation,
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

describe("toViolation", () => {
  const result: Parameters<typeof toViolation>[0] = {
    id: "image-alt",
    impact: "critical",
    tags: ["wcag2a"],
    description: "Ensure <img> elements have alternative text or a role of none or presentation",
    help: "Images must have alternative text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt?application=playwright",
    nodes: [
      {
        target: [["my-card", "img"]],
        html: '<img src="x.png">',
        failureSummary: "Fix any of the following:\n  Element does not have an alt attribute",
        any: [],
        all: [],
        none: [],
      },
    ],
  };

  it("carries axe's description and guide as the violation's guidance", () => {
    const v = toViolation(result, { version: "4.13.0" });
    expect(v.guidance).toEqual({
      id: "axe-core 4.13.0",
      rule: "image-alt",
      description: "Ensure <img> elements have alternative text or a role of none or presentation",
      guide: "https://dequeuniversity.com/rules/axe/4.13/image-alt?application=playwright",
    });
    expect(v.helpUrl).toBe(result.helpUrl);
  });

  it("still flattens a shadow-DOM target", () => {
    const v = toViolation(result, { version: "4.13.0" });
    expect(v.nodes[0]?.target).toBe("my-card img");
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
      if ("redirect" in next) expect.fail(`/next.html was redirected to ${next.redirect}`);
      expect(next.finalUrl).toBe(`${server.url}/next.html`);
    } finally {
      await analyzer.close();
      await server.close();
    }
  }, 60_000);

  it("a page whose close is lost does not hold up the next page", async () => {
    // Chrome answers a close that lands on the tab's own commit and never
    // closes the tab, so an awaited close waits for the browser to exit.
    // These two pages send the browser back and forth as soon as each loads,
    // so a close sent to one lands on a commit about one time in five.
    const hop = (to: string) =>
      page(`<script>addEventListener("load", () => setTimeout(() => location.replace("${to}"), 0));</script>`);
    const server: SchemaServer = await startSchemaServer({
      "/ping.html": hop("/pong.html"),
      "/pong.html": hop("/ping.html"),
    });
    const analyzer = createPlaywrightAnalyzer();
    const opts = { timeout: 15_000, tags: [] };
    try {
      for (let i = 0; i < 20; i++) {
        let timer: NodeJS.Timeout | undefined;
        const stalled = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`analyze ${String(i + 1)} did not return: it waited on the previous page's close`));
          }, 10_000);
        });
        try {
          const next = await Promise.race([analyzer.analyze(`${server.url}/ping.html`, opts), stalled]);
          expect("redirect" in next).toBe(true);
        } finally {
          clearTimeout(timer);
        }
      }
    } finally {
      await analyzer.close();
      await server.close();
    }
    // Above twenty 10s guards, so a stall reports its own message first.
  }, 240_000);
});

describe("loadFailureMessage", () => {
  it("on this machine, says to start the site", () => {
    for (const url of ["http://localhost:4321/", "http://127.0.0.1:8080/a", "http://[::1]:3000/"]) {
      expect(loadFailureMessage(url, "net::ERR_CONNECTION_REFUSED")).toBe(
        `Could not load ${url}: net::ERR_CONNECTION_REFUSED. Start the site with manni site preview, then run the check again.`,
      );
    }
  });

  it("anywhere else, says to check the site is reachable", () => {
    expect(loadFailureMessage("https://example.com/", "Timeout 30000ms exceeded.")).toBe(
      "Could not load https://example.com/: Timeout 30000ms exceeded. Check that the site is up and reachable from this machine.",
    );
  });
});
