/**
 * The crawl: a BFS over a same-host frontier, seeds first, then the sitemap
 * pages, then links in the order each page listed them. Pages run one at a
 * time; a seed that will not load is fatal, any other page records its error
 * and the crawl goes on.
 */
import { describe, expect, it } from "vitest";
import { crawl, type CrawlOptions } from "../../src/a11y/core/crawl.js";
import { A11yError } from "../../src/a11y/types.js";
import { fakeAnalyzer, type FakeSite } from "../helpers/fake-analyzer.js";

const S = "https://site.example";
const ANALYZE = { tags: [], timeout: 1000 };

function options(over: Partial<CrawlOptions>): CrawlOptions {
  return {
    seeds: [`${S}/`],
    crawl: true,
    maxPages: 100,
    extra: [],
    analyze: ANALYZE,
    ...over,
  };
}

describe("crawl", () => {
  it("visits pages breadth-first, in the order each page listed its links", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/a`, `${S}/b`] },
      [`${S}/a`]: { links: [`${S}/c`] },
      [`${S}/b`]: { links: [`${S}/d`, `${S}/a`] },
      [`${S}/c`]: {},
      [`${S}/d`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({}), analyzer);
    expect(out.pages.map((p) => p.url)).toEqual([`${S}/`, `${S}/a`, `${S}/b`, `${S}/c`, `${S}/d`]);
    expect(out.pages.map((p) => p.source)).toEqual(["seed", "link", "link", "link", "link"]);
    expect(out).toMatchObject({ discovered: 5, skipped: 0 });
  });

  it("dedupes across fragments and hostname case", async () => {
    const site: FakeSite = {
      [`${S}/`]: {
        links: [`${S}/a#one`, `https://SITE.example/a`, `${S}/a`, `${S}/a#two`, `${S}/`],
      },
      [`${S}/a`]: { links: [`${S}/#top`] },
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({}), analyzer);
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`, `${S}/a`]);
    expect(out.discovered).toBe(2);
  });

  it("never visits an off-host link, an asset, or a non-http scheme", async () => {
    const site: FakeSite = {
      [`${S}/`]: {
        links: [
          "https://example.org/",
          `https://www.site.example/`,
          `${S}/styles.css`,
          `${S}/brochure.pdf`,
          "mailto:someone@example.com",
          "tel:+15555550100",
          "javascript:void(0)",
          `${S}/about`,
        ],
      },
      [`${S}/about`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({}), analyzer);
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`, `${S}/about`]);
    expect(out.discovered).toBe(2);
  });

  it("follows links that are on the host of any seed", async () => {
    const other = "https://blog.example";
    const site: FakeSite = {
      [`${S}/`]: { links: [`${other}/post`, "https://example.org/"] },
      [`${other}/`]: {},
      [`${other}/post`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({ seeds: [`${S}/`, `${other}/`] }), analyzer);
    expect(out.pages.map((p) => p.url)).toEqual([`${S}/`, `${other}/`, `${other}/post`]);
  });

  it("visits extra URLs after the seeds and before links, with source sitemap", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/linked`] },
      [`${S}/orphan`]: {},
      [`${S}/linked`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({ extra: [`${S}/orphan`] }), analyzer);
    expect(out.pages.map((p) => [p.url, p.source])).toEqual([
      [`${S}/`, "seed"],
      [`${S}/orphan`, "sitemap"],
      [`${S}/linked`, "link"],
    ]);
  });

  it("keeps a URL that is both a seed and in extra as a seed", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: {} });
    const out = await crawl(options({ extra: [`${S}/#top`, `${S}/`] }), analyzer);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]?.source).toBe("seed");
  });

  it("filters extra URLs like links: off-host and assets are dropped", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: {}, [`${S}/p`]: {} });
    const out = await crawl(
      options({ extra: ["https://example.org/x", `${S}/file.pdf`, `${S}/p`] }),
      analyzer,
    );
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`, `${S}/p`]);
    expect(out.discovered).toBe(2);
  });

  it("stops at maxPages and reports the frontier left behind as skipped", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/a`, `${S}/b`, `${S}/c`] },
      [`${S}/a`]: { links: [`${S}/d`] },
      [`${S}/b`]: {},
      [`${S}/c`]: {},
      [`${S}/d`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({ maxPages: 2 }), analyzer);
    expect(out.pages.map((p) => p.url)).toEqual([`${S}/`, `${S}/a`]);
    expect(out).toMatchObject({ discovered: 5, skipped: 3 });
    expect(analyzer.calls).toHaveLength(2);
  });

  it("with crawl false, checks exactly the seeds: no extra, no links", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/a`] },
      [`${S}/b`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(
      options({ seeds: [`${S}/`, `${S}/b`], crawl: false, extra: [`${S}/orphan`] }),
      analyzer,
    );
    expect(out.pages.map((p) => [p.url, p.source])).toEqual([
      [`${S}/`, "seed"],
      [`${S}/b`, "seed"],
    ]);
    expect(out).toMatchObject({ discovered: 2, skipped: 0 });
  });

  it("with crawl false, still normalizes and dedupes the seeds", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: {} });
    const out = await crawl(
      options({ seeds: [`${S}/#a`, `https://SITE.example/`, `${S}/`], crawl: false }),
      analyzer,
    );
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`]);
    expect(out.pages).toHaveLength(1);
  });

  it("records a crawled page that fails and keeps going", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/broken`, `${S}/ok`] },
      [`${S}/broken`]: new A11yError(`Could not load ${S}/broken: timeout`),
      [`${S}/ok`]: {},
    };
    const out = await crawl(options({}), fakeAnalyzer(site));
    expect(out.pages.map((p) => p.url)).toEqual([`${S}/`, `${S}/broken`, `${S}/ok`]);
    expect(out.pages[1]).toEqual({
      url: `${S}/broken`,
      source: "link",
      violations: [],
      passes: 0,
      incomplete: 0,
      error: `Could not load ${S}/broken: timeout`,
    });
    expect(out.pages[2]?.error).toBeUndefined();
  });

  it("rethrows when a seed fails", async () => {
    const site: FakeSite = {
      [`${S}/`]: new A11yError(`Could not load ${S}/: net::ERR_CONNECTION_REFUSED`),
    };
    await expect(crawl(options({}), fakeAnalyzer(site))).rejects.toThrow(
      /Could not load .*ERR_CONNECTION_REFUSED/,
    );
  });

  it("rethrows when a later seed fails, even after an earlier one loaded", async () => {
    const site: FakeSite = {
      [`${S}/`]: {},
      [`${S}/second`]: new Error("boom"),
    };
    await expect(
      crawl(options({ seeds: [`${S}/`, `${S}/second`] }), fakeAnalyzer(site)),
    ).rejects.toThrow("boom");
  });

  it("hands the analyze options through unchanged", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: {} });
    const analyze = { tags: ["wcag2a", "wcag2aa"], timeout: 12345 };
    await crawl(options({ analyze }), analyzer);
    expect(analyzer.calls[0]?.opts).toEqual(analyze);
  });

  it("reports each page under its normalized frontier URL", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/A`]: {} });
    const out = await crawl(options({ seeds: [`HTTPS://Site.Example/A#x`] }), analyzer);
    expect(out.pages[0]?.url).toBe(`${S}/A`);
  });
});
