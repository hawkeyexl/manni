/**
 * The crawl: a BFS over a same-host frontier, seeds first, then the sitemap
 * pages, then links in the order each page listed them. Pages run one at a
 * time; a seed that will not load is fatal, any other page records its error
 * and the crawl goes on.
 */
import { describe, expect, it } from "vitest";
import { crawl, type CrawlOptions } from "../../src/a11y/core/crawl.js";
import { A11yError, type ProgressEvent } from "../../src/a11y/types.js";
import { fakeAnalyzer, violation, type FakeSite } from "../helpers/fake-analyzer.js";

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

describe("crawl and the trailing slash", () => {
  it("treats a seed of /x/ and a sitemap entry of /x as one page", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/x/`]: {} });
    const out = await crawl(options({ seeds: [`${S}/x/`], extra: [`${S}/x`] }), analyzer);
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/x/`]);
    expect(out.pages.map((p) => [p.url, p.source])).toEqual([[`${S}/x/`, "seed"]]);
    expect(out).toMatchObject({ discovered: 1, skipped: 0, duplicates: 0 });
  });

  it("keeps the spelling that came first: the seed's, then the sitemap's", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: { links: [`${S}/y/`] }, [`${S}/y`]: {} });
    const out = await crawl(options({ extra: [`${S}/y`] }), analyzer);
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`, `${S}/y`]);
    expect(out.pages.map((p) => p.source)).toEqual(["seed", "sitemap"]);
  });

  it("does not load a link to /y after /y/ was checked", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/y/`] },
      [`${S}/y/`]: { links: [`${S}/y`, `${S}/z`] },
      [`${S}/z`]: { links: [`${S}/z/`, `${S}/`] },
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({}), analyzer);
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`, `${S}/y/`, `${S}/z`]);
    expect(out.discovered).toBe(3);
  });

  it("counts discovered by key, not by spelling", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: { links: [`${S}/a`, `${S}/a/`, `${S}/b/`, `${S}/b`] } });
    const out = await crawl(options({ maxPages: 1 }), analyzer);
    expect(out).toMatchObject({ discovered: 3, skipped: 2, duplicates: 0 });
  });
});

describe("crawl and redirects", () => {
  it("drops a queued URL whose key the browser already landed on", async () => {
    // /r redirects to /z/. /z was queued before /r was analyzed, so it is
    // still in the frontier when its turn comes, and is dropped then.
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/r`, `${S}/z`] },
      [`${S}/r`]: { finalUrl: `${S}/z/` },
      [`${S}/z`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({}), analyzer);
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`, `${S}/r`]);
    expect(out.pages.map((p) => p.url)).toEqual([`${S}/`, `${S}/r`]);
    expect(out).toMatchObject({ discovered: 3, skipped: 0, duplicates: 1 });
  });

  it("never queues a link to a redirect target learned earlier", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/r`] },
      [`${S}/r`]: { finalUrl: `${S}/z/`, links: [`${S}/z`] },
      [`${S}/z`]: {},
    };
    const analyzer = fakeAnalyzer(site);
    const out = await crawl(options({}), analyzer);
    expect(analyzer.calls.map((c) => c.url)).toEqual([`${S}/`, `${S}/r`]);
    expect(out).toMatchObject({ discovered: 2, skipped: 0, duplicates: 0 });
  });

  it("reports the page under the URL it was asked for, not where it landed", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/old`]: { finalUrl: `${S}/new/` } });
    const out = await crawl(options({ seeds: [`${S}/old`] }), analyzer);
    expect(out.pages[0]?.url).toBe(`${S}/old`);
  });

  it("a duplicate counts as neither checked nor skipped", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/r`, `${S}/z`, `${S}/w`] },
      [`${S}/r`]: { finalUrl: `${S}/z/` },
      [`${S}/w`]: {},
    };
    const events: ProgressEvent[] = [];
    const out = await crawl(options({ onProgress: (e) => events.push(e) }), fakeAnalyzer(site));
    expect(out.pages.map((p) => p.url)).toEqual([`${S}/`, `${S}/r`, `${S}/w`]);
    expect(out).toMatchObject({ discovered: 4, skipped: 0, duplicates: 1 });
    // The page counter never names the dropped URL.
    expect(events.filter((e) => e.kind === "page").map((e) => e.url)).toEqual([
      `${S}/`,
      `${S}/r`,
      `${S}/w`,
    ]);
    expect(events.at(-1)).toEqual({ kind: "done", checked: 3, skipped: 0 });
  });

  it("ignores a final URL that does not parse", async () => {
    const analyzer = fakeAnalyzer({ [`${S}/`]: { finalUrl: "not a url" } });
    const out = await crawl(options({}), analyzer);
    expect(out.pages).toHaveLength(1);
  });
});

describe("crawl progress", () => {
  it("reports the browser, then each page before and after, then done", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/a`] },
      [`${S}/a`]: {
        violations: [violation("image-alt", "critical"), violation("region", "minor")],
      },
    };
    const events: ProgressEvent[] = [];
    await crawl(options({ onProgress: (e) => events.push(e) }), fakeAnalyzer(site));
    expect(events).toEqual([
      { kind: "browser" },
      // The seed is the only URL discovered until its links are read.
      { kind: "page", index: 1, queued: 1, url: `${S}/` },
      { kind: "checked", index: 1, url: `${S}/`, violations: 0 },
      { kind: "page", index: 2, queued: 2, url: `${S}/a` },
      // Counted before the severity floor: both of /a's violations.
      { kind: "checked", index: 2, url: `${S}/a`, violations: 2 },
      { kind: "done", checked: 2, skipped: 0 },
    ]);
  });

  it("reports the browser once, before the first page", async () => {
    const events: ProgressEvent[] = [];
    await crawl(
      options({ seeds: [`${S}/`, `${S}/b`], onProgress: (e) => events.push(e) }),
      fakeAnalyzer({ [`${S}/`]: {}, [`${S}/b`]: {} }),
    );
    expect(events.filter((e) => e.kind === "browser")).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "browser" });
  });

  it("reports a crawled page that failed with its error", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/broken`] },
      [`${S}/broken`]: new A11yError(`Could not load ${S}/broken: timeout`),
    };
    const events: ProgressEvent[] = [];
    await crawl(options({ onProgress: (e) => events.push(e) }), fakeAnalyzer(site));
    expect(events[4]).toEqual({
      kind: "checked",
      index: 2,
      url: `${S}/broken`,
      violations: 0,
      error: `Could not load ${S}/broken: timeout`,
    });
    expect(events.at(-1)).toEqual({ kind: "done", checked: 2, skipped: 0 });
  });

  it("counts the frontier left behind in done", async () => {
    const site: FakeSite = {
      [`${S}/`]: { links: [`${S}/a`, `${S}/b`] },
      [`${S}/a`]: {},
      [`${S}/b`]: {},
    };
    const events: ProgressEvent[] = [];
    await crawl(options({ maxPages: 1, onProgress: (e) => events.push(e) }), fakeAnalyzer(site));
    expect(events.at(-1)).toEqual({ kind: "done", checked: 1, skipped: 2 });
  });

  it("stops reporting when a seed fails: no checked, no done", async () => {
    // The seed's failure is the run's error, and the CLI prints it; a
    // `checked` here would say the same thing twice on stderr.
    const events: ProgressEvent[] = [];
    await expect(
      crawl(
        options({ onProgress: (e) => events.push(e) }),
        fakeAnalyzer({ [`${S}/`]: new A11yError("Could not load: refused") }),
      ),
    ).rejects.toThrow("Could not load: refused");
    expect(events).toEqual([
      { kind: "browser" },
      { kind: "page", index: 1, queued: 1, url: `${S}/` },
    ]);
  });

  it("says nothing without a listener", async () => {
    const out = await crawl(options({}), fakeAnalyzer({ [`${S}/`]: {} }));
    expect(out.pages).toHaveLength(1);
  });
});
