/**
 * The check core: validates the seeds, finds the sitemap, runs the crawl,
 * filters by severity, scores each page, and totals the summary. The analyzer
 * and the fetcher are injected; nothing here launches a browser.
 */
import { describe, expect, it } from "vitest";
import { CHECK_DEFAULTS, runCheck, type CheckOptions } from "../../src/a11y/commands/check.js";
import type { Fetcher } from "../../src/a11y/core/sitemap.js";
import { A11yError, type ProgressEvent } from "../../src/a11y/types.js";
import { fakeAnalyzer, violation, type FakeSite } from "../helpers/fake-analyzer.js";

const S = "https://site.example";

function opts(over: Partial<CheckOptions>): CheckOptions {
  return { urls: [`${S}/`], ...CHECK_DEFAULTS, ...over };
}

/** A fetcher that never finds a sitemap and records what it was asked for. */
function noSitemap(): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (url: string) => {
    calls.push(url);
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
  };
  return Object.assign(fetcher, { calls });
}

function sitemapFetcher(routes: Record<string, string>): Fetcher {
  return (url) => {
    const body = routes[url];
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
    }
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
  };
}

describe("CHECK_DEFAULTS", () => {
  it("matches the documented defaults", () => {
    expect(CHECK_DEFAULTS).toEqual({
      crawl: true,
      maxPages: 100,
      tags: [],
      severity: "minor",
      timeout: 30000,
    });
  });
});

describe("runCheck input validation", () => {
  it("rejects zero URLs with the config hint", async () => {
    const analyzer = fakeAnalyzer({});
    await expect(runCheck(opts({ urls: [] }), { analyzer, fetcher: noSitemap() })).rejects.toThrow(
      new A11yError(
        "No URLs to check. Pass one or more, or set `a11y.urls` in manni.config.yaml.",
      ),
    );
    expect(analyzer.calls).toEqual([]);
  });

  it.each(["ftp://site.example/", "site.example", "not-a-url", "mailto:x@y.z"])(
    "rejects %s as not http(s)",
    async (url) => {
      const analyzer = fakeAnalyzer({});
      await expect(
        runCheck(opts({ urls: [`${S}/`, url] }), { analyzer, fetcher: noSitemap() }),
      ).rejects.toThrow(new A11yError(`Not an http(s) URL: "${url}".`));
      expect(analyzer.calls).toEqual([]);
    },
  );

  it("still closes the analyzer when validation fails", async () => {
    const analyzer = fakeAnalyzer({});
    await expect(runCheck(opts({ urls: [] }), { analyzer })).rejects.toThrow(A11yError);
    expect(analyzer.closed).toBe(1);
  });
});

describe("runCheck severity filtering and score", () => {
  it("drops violations below the floor before scoring and counting", async () => {
    const site: FakeSite = {
      [`${S}/`]: {
        passes: 7,
        violations: [
          violation("color-contrast", "serious"),
          violation("region", "moderate"),
          violation("landmark-one-main", "minor"),
          violation("image-alt", "critical"),
        ],
      },
    };
    const run = await runCheck(opts({ severity: "serious" }), {
      analyzer: fakeAnalyzer(site),
      fetcher: noSitemap(),
    });
    const page = run.results[0];
    expect(page?.violations.map((v) => v.id)).toEqual(["color-contrast", "image-alt"]);
    // round(100 * 7 / (7 + 2))
    expect(page?.score).toBe(78);
    expect(run.summary.violations).toBe(2);
    expect(run.summary.failed).toBe(1);
  });

  it("scores 100 for a clean page and keeps the pass and incomplete counts", async () => {
    const run = await runCheck(opts({}), {
      analyzer: fakeAnalyzer({ [`${S}/`]: { passes: 12, incomplete: 3 } }),
      fetcher: noSitemap(),
    });
    expect(run.results[0]).toMatchObject({
      url: `${S}/`,
      source: "seed",
      violations: [],
      passes: 12,
      incomplete: 3,
      score: 100,
    });
    expect(run.results[0]?.error).toBeUndefined();
    expect(run.summary.failed).toBe(0);
  });

  it("scores null when no rule applied", async () => {
    const run = await runCheck(opts({}), {
      analyzer: fakeAnalyzer({ [`${S}/`]: { passes: 0, violations: [] } }),
      fetcher: noSitemap(),
    });
    expect(run.results[0]?.score).toBeNull();
    expect(run.summary.failed).toBe(0);
  });

  it("scores null when only filtered-out violations applied", async () => {
    const run = await runCheck(opts({ severity: "critical" }), {
      analyzer: fakeAnalyzer({
        [`${S}/`]: { passes: 0, violations: [violation("region", "minor")] },
      }),
      fetcher: noSitemap(),
    });
    expect(run.results[0]?.score).toBeNull();
    expect(run.results[0]?.violations).toEqual([]);
  });

  it("scores 0 when every applicable rule failed", async () => {
    const run = await runCheck(opts({}), {
      analyzer: fakeAnalyzer({
        [`${S}/`]: { passes: 0, violations: [violation("image-alt", "critical")] },
      }),
      fetcher: noSitemap(),
    });
    expect(run.results[0]?.score).toBe(0);
  });

  it("scores null for a page that could not load and counts it as failed", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/broken`] },
      [`${S}/broken`]: new A11yError(`Could not load ${S}/broken: timeout`),
    };
    const run = await runCheck(opts({}), { analyzer: fakeAnalyzer(site), fetcher: noSitemap() });
    expect(run.results[1]).toEqual({
      url: `${S}/broken`,
      source: "link",
      violations: [],
      passes: 0,
      incomplete: 0,
      score: null,
      error: `Could not load ${S}/broken: timeout`,
    });
    expect(run.summary).toMatchObject({ checked: 2, failed: 1, violations: 0 });
  });
});

describe("runCheck options through to the analyzer", () => {
  it("passes tags and timeout to every analyze call", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: { links: [`${S}/a`] }, [`${S}/a`]: {} });
    await runCheck(opts({ tags: ["wcag2a", "wcag2aa"], timeout: 5000 }), {
      analyzer,
      fetcher: noSitemap(),
    });
    expect(analyzer.calls).toHaveLength(2);
    for (const call of analyzer.calls) {
      expect(call.opts).toEqual({ tags: ["wcag2a", "wcag2aa"], timeout: 5000 });
    }
  });

  it("normalizes the seeds before crawling", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: {} });
    const run = await runCheck(opts({ urls: [`HTTPS://Site.Example/#top`] }), {
      analyzer,
      fetcher: noSitemap(),
    });
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`]);
    expect(run.results[0]?.url).toBe(`${S}/`);
  });

  it("honours maxPages and reports the rest as skipped", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/a`, `${S}/b`] },
      [`${S}/a`]: {},
      [`${S}/b`]: {},
    };
    const run = await runCheck(opts({ maxPages: 1 }), {
      analyzer: fakeAnalyzer(site),
      fetcher: noSitemap(),
    });
    expect(run.results).toHaveLength(1);
    expect(run.summary).toMatchObject({ discovered: 3, checked: 1, skipped: 2 });
  });

  it("counts the URLs dropped as duplicates in the summary", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/r`, `${S}/z`] },
      [`${S}/r`]: { finalUrl: `${S}/z/` },
      [`${S}/z`]: {},
    };
    const run = await runCheck(opts({}), { analyzer: fakeAnalyzer(site), fetcher: noSitemap() });
    expect(run.results.map((r) => r.url)).toEqual([`${S}/`, `${S}/r`]);
    expect(run.summary).toMatchObject({ discovered: 3, checked: 2, skipped: 0, duplicates: 1 });
  });
});

describe("runCheck and the sitemap", () => {
  it("uses the sitemap of the first seed as the page list", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [] },
      [`${S}/orphan`]: {},
    };
    const fetcher = sitemapFetcher({
      [`${S}/sitemap.xml`]: `<urlset><url><loc>${S}/orphan</loc></url><url><loc>https://example.org/</loc></url></urlset>`,
    });
    const run = await runCheck(opts({}), { analyzer: fakeAnalyzer(site), fetcher });
    expect(run.results.map((r) => [r.url, r.source])).toEqual([
      [`${S}/`, "seed"],
      [`${S}/orphan`, "sitemap"],
    ]);
    expect(run.summary.sitemap).toBe(`${S}/sitemap.xml`);
  });

  it("looks up one sitemap per run, from the first seed only", async () => {
    const other = "https://blog.example";
    const fetcher = noSitemap();
    await runCheck(opts({ urls: [`${S}/docs/`, `${other}/`] }), {
      analyzer: fakeAnalyzer({ [`${S}/docs/`]: {}, [`${other}/`]: {} }),
      fetcher,
    });
    // robots.txt at the first seed's origin comes first; every later candidate
    // walks that seed's path, and the second seed's host is never asked.
    expect(fetcher.calls[0]).toBe(`${S}/robots.txt`);
    expect(fetcher.calls.length).toBeGreaterThan(1);
    expect(fetcher.calls.every((c) => c.startsWith(`${S}/`))).toBe(true);
  });

  it("reports sitemap null when none was found", async () => {
    const run = await runCheck(opts({}), {
      analyzer: fakeAnalyzer({ [`${S}/`]: {} }),
      fetcher: noSitemap(),
    });
    expect(run.summary.sitemap).toBeNull();
    expect(run.summary.crawl).toBe(true);
  });

  it("skips the sitemap lookup entirely with crawl false", async () => {
    const fetcher = noSitemap();
    const run = await runCheck(opts({ crawl: false }), {
      analyzer: fakeAnalyzer({ [`${S}/`]: { links: [`${S}/a`] } }),
      fetcher,
    });
    expect(fetcher.calls).toEqual([]);
    expect(run.results).toHaveLength(1);
    expect(run.summary.sitemap).toBeNull();
    // Reporters tell "no crawl" from "crawled, no sitemap" by this flag.
    expect(run.summary.crawl).toBe(false);
  });
});

describe("runCheck summary", () => {
  it("totals violations by severity with all four keys present", async () => {
    const site: FakeSite = {
      [`${S}/`]: {
        links: [`${S}/a`],
        violations: [violation("image-alt", "critical"), violation("region", "moderate")],
      },
      [`${S}/a`]: {
        violations: [violation("color-contrast", "serious"), violation("image-alt", "critical")],
      },
    };
    const run = await runCheck(opts({}), { analyzer: fakeAnalyzer(site), fetcher: noSitemap() });
    expect(run.summary).toEqual({
      discovered: 2,
      checked: 2,
      skipped: 0,
      duplicates: 0,
      failed: 2,
      violations: 4,
      bySeverity: { minor: 0, moderate: 1, serious: 1, critical: 2 },
      sitemap: null,
      crawl: true,
    });
  });

  it("zero-fills bySeverity on a clean run", async () => {
    const run = await runCheck(opts({}), {
      analyzer: fakeAnalyzer({ [`${S}/`]: {} }),
      fetcher: noSitemap(),
    });
    expect(run.summary.bySeverity).toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 });
    expect(run.summary.failed).toBe(0);
  });

  it("counts a page once in failed even with several violations", async () => {
    const run = await runCheck(opts({}), {
      analyzer: fakeAnalyzer({
        [`${S}/`]: { violations: [violation("a", "minor"), violation("b", "minor")] },
      }),
      fetcher: noSitemap(),
    });
    expect(run.summary).toMatchObject({ failed: 1, violations: 2 });
  });
});

describe("runCheck closes the analyzer", () => {
  it("after a successful run", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: {} });
    await runCheck(opts({}), { analyzer, fetcher: noSitemap() });
    expect(analyzer.closed).toBe(1);
  });

  it("when the crawl throws on the seed", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: new A11yError("Could not load: refused") });
    await expect(runCheck(opts({}), { analyzer, fetcher: noSitemap() })).rejects.toThrow(
      "Could not load: refused",
    );
    expect(analyzer.closed).toBe(1);
  });

  it("when the fetcher itself throws synchronously", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: {} });
    const fetcher: Fetcher = () => {
      throw new Error("fetch exploded");
    };
    // A throwing fetcher is "no sitemap", never a failed run.
    const run = await runCheck(opts({}), { analyzer, fetcher });
    expect(run.summary.sitemap).toBeNull();
    expect(analyzer.closed).toBe(1);
  });
});

describe("runCheck progress", () => {
  it("reports the sitemap first when crawling, then the crawl's own events", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [] },
      [`${S}/orphan`]: {},
    };
    const fetcher = sitemapFetcher({
      [`${S}/sitemap.xml`]: `<urlset><url><loc>${S}/orphan</loc></url></urlset>`,
    });
    const events: ProgressEvent[] = [];
    await runCheck(opts({}), {
      analyzer: fakeAnalyzer(site),
      fetcher,
      onProgress: (e) => events.push(e),
    });
    expect(events).toEqual([
      { kind: "sitemap", source: `${S}/sitemap.xml`, urls: 1 },
      { kind: "browser" },
      { kind: "page", index: 1, queued: 2, url: `${S}/` },
      { kind: "checked", index: 1, url: `${S}/`, violations: 0 },
      { kind: "page", index: 2, queued: 2, url: `${S}/orphan` },
      { kind: "checked", index: 2, url: `${S}/orphan`, violations: 0 },
      { kind: "done", checked: 2, skipped: 0 },
    ]);
  });

  it("reports a null sitemap when none was found", async () => {
    const events: ProgressEvent[] = [];
    await runCheck(opts({}), {
      analyzer: fakeAnalyzer({ [`${S}/`]: {} }),
      fetcher: noSitemap(),
      onProgress: (e) => events.push(e),
    });
    expect(events[0]).toEqual({ kind: "sitemap", source: null, urls: 0 });
  });

  it("skips the sitemap event with crawl false", async () => {
    const events: ProgressEvent[] = [];
    await runCheck(opts({ crawl: false }), {
      analyzer: fakeAnalyzer({ [`${S}/`]: { links: [`${S}/a`] } }),
      fetcher: noSitemap(),
      onProgress: (e) => events.push(e),
    });
    expect(events.map((e) => e.kind)).toEqual(["browser", "page", "checked", "done"]);
  });

  it("reports the violation count before the severity floor is applied", async () => {
    const events: ProgressEvent[] = [];
    const run = await runCheck(opts({ severity: "critical" }), {
      analyzer: fakeAnalyzer({
        [`${S}/`]: {
          violations: [violation("region", "minor"), violation("image-alt", "critical")],
        },
      }),
      fetcher: noSitemap(),
      onProgress: (e) => events.push(e),
    });
    expect(events.find((e) => e.kind === "checked")).toMatchObject({ violations: 2 });
    expect(run.results[0]?.violations).toHaveLength(1);
  });

  it("runs without a listener", async () => {
    const run = await runCheck(opts({}), {
      analyzer: fakeAnalyzer({ [`${S}/`]: {} }),
      fetcher: noSitemap(),
    });
    expect(run.summary.checked).toBe(1);
  });
});
