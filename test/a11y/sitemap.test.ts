/**
 * Sitemap discovery: robots.txt `Sitemap:` lines first, then the well-known
 * sitemap file names in each directory of the seed's path from nearest to
 * root, sitemap indexes followed, and every failure mode read as "no sitemap"
 * rather than an error. The fetcher is injected, so nothing here touches the
 * network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverSitemap,
  parseSitemapXml,
  type Fetcher,
} from "../../src/a11y/core/sitemap.js";

const ORIGIN = "https://docs.example.com";
const SEED = `${ORIGIN}/`;
const FIXTURES = join(__dirname, "..", "fixtures", "a11y", "site");

type Route = string | number | (() => Promise<string>);

/**
 * A fetcher over a route table: a string body is a 200, a number is that
 * status with an empty body, a function is awaited (so a route can throw).
 * Every request is logged so a test can assert what was (not) fetched.
 */
function fakeFetcher(routes: Record<string, Route>): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return { ok: false, status: 404, text: () => Promise.resolve("") };
    if (typeof route === "number") return { ok: false, status: route, text: () => Promise.resolve("") };
    if (typeof route === "function") {
      const body = await route();
      return { ok: true, status: 200, text: () => Promise.resolve(body) };
    }
    return { ok: true, status: 200, text: () => Promise.resolve(route) };
  };
  return Object.assign(fetcher, { calls });
}

function urlset(...locs: string[]): string {
  return `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<url><loc>${l}</loc></url>`)
    .join("")}</urlset>`;
}

function index(...locs: string[]): string {
  return `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((l) => `<sitemap><loc>${l}</loc></sitemap>`)
    .join("")}</sitemapindex>`;
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8").replaceAll("__ORIGIN__", ORIGIN);
}

describe("parseSitemapXml", () => {
  it("reads a urlset", () => {
    expect(parseSitemapXml(urlset(`${ORIGIN}/a`, `${ORIGIN}/b`))).toEqual({
      kind: "urlset",
      locs: [`${ORIGIN}/a`, `${ORIGIN}/b`],
    });
  });

  it("reads a sitemap index", () => {
    expect(parseSitemapXml(index(`${ORIGIN}/one.xml`))).toEqual({
      kind: "index",
      locs: [`${ORIGIN}/one.xml`],
    });
  });

  it("trims whitespace inside <loc>", () => {
    expect(parseSitemapXml(`<urlset><url><loc>\n  ${ORIGIN}/a \n</loc></url></urlset>`)).toEqual({
      kind: "urlset",
      locs: [`${ORIGIN}/a`],
    });
  });

  it("returns null for garbage, for HTML, and for an unrelated XML root", () => {
    expect(parseSitemapXml("<<< not xml")).toBeNull();
    expect(parseSitemapXml("<!doctype html><html><body>404</body></html>")).toBeNull();
    expect(parseSitemapXml("<rss><channel></channel></rss>")).toBeNull();
    expect(parseSitemapXml("")).toBeNull();
  });
});

describe("discoverSitemap", () => {
  it("uses the robots.txt Sitemap: line over /sitemap.xml", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/robots.txt`]: `User-agent: *\nDisallow: /private\nSitemap: ${ORIGIN}/pages.xml\n`,
      [`${ORIGIN}/pages.xml`]: urlset(`${ORIGIN}/from-robots`),
      [`${ORIGIN}/sitemap.xml`]: urlset(`${ORIGIN}/from-default`),
    });
    const found = await discoverSitemap(SEED, fetcher);
    expect(found).toEqual({ source: `${ORIGIN}/pages.xml`, urls: [`${ORIGIN}/from-robots`] });
    expect(fetcher.calls).not.toContain(`${ORIGIN}/sitemap.xml`);
  });

  it("reads the Sitemap: key case-insensitively", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/robots.txt`]: `SITEMAP: ${ORIGIN}/pages.xml\n`,
      [`${ORIGIN}/pages.xml`]: urlset(`${ORIGIN}/a`),
    });
    expect((await discoverSitemap(SEED, fetcher)).source).toBe(`${ORIGIN}/pages.xml`);
  });

  it("takes the first usable of several Sitemap: lines", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/robots.txt`]: `Sitemap: ${ORIGIN}/gone.xml\nSitemap: ${ORIGIN}/second.xml\n`,
      [`${ORIGIN}/gone.xml`]: 404,
      [`${ORIGIN}/second.xml`]: urlset(`${ORIGIN}/b`),
    });
    expect(await discoverSitemap(SEED, fetcher)).toEqual({
      source: `${ORIGIN}/second.xml`,
      urls: [`${ORIGIN}/b`],
    });
  });

  it("falls back to /sitemap.xml when robots.txt is missing", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/sitemap.xml`]: urlset(`${ORIGIN}/a`),
    });
    expect(await discoverSitemap(SEED, fetcher)).toEqual({
      source: `${ORIGIN}/sitemap.xml`,
      urls: [`${ORIGIN}/a`],
    });
  });

  it("falls back to /sitemap.xml when robots.txt names no sitemap", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/robots.txt`]: "User-agent: *\nDisallow:\n",
      [`${ORIGIN}/sitemap.xml`]: urlset(`${ORIGIN}/a`),
    });
    expect((await discoverSitemap(SEED, fetcher)).source).toBe(`${ORIGIN}/sitemap.xml`);
  });

  it("reads robots.txt from the origin, whatever the seed's path", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/sitemap.xml`]: urlset(`${ORIGIN}/a`),
    });
    const found = await discoverSitemap(`${ORIGIN}/deep/page.html`, fetcher);
    expect(fetcher.calls[0]).toBe(`${ORIGIN}/robots.txt`);
    expect(found.source).toBe(`${ORIGIN}/sitemap.xml`);
  });

  describe("under a path prefix", () => {
    const ROOT_FILES = ["sitemap.xml", "sitemap-index.xml", "sitemap_index.xml"];

    it("finds <prefix>/sitemap-index.xml when the origin has nothing", async () => {
      const fetcher = fakeFetcher({
        [`${ORIGIN}/manni/sitemap-index.xml`]: index(`${ORIGIN}/manni/sitemap-0.xml`),
        [`${ORIGIN}/manni/sitemap-0.xml`]: urlset(`${ORIGIN}/manni/`, `${ORIGIN}/manni/meta/`),
      });
      expect(await discoverSitemap(`${ORIGIN}/manni/`, fetcher)).toEqual({
        source: `${ORIGIN}/manni/sitemap-index.xml`,
        urls: [`${ORIGIN}/manni/`, `${ORIGIN}/manni/meta/`],
      });
    });

    it("tries the nearest directory first, then each parent, and the root last", async () => {
      const fetcher = fakeFetcher({});
      await discoverSitemap(`${ORIGIN}/manni/meta/fix/`, fetcher);
      const dirs = ["/manni/meta/fix/", "/manni/meta/", "/manni/", "/"];
      expect(fetcher.calls).toEqual([
        `${ORIGIN}/robots.txt`,
        ...dirs.flatMap((dir) => ROOT_FILES.map((file) => `${ORIGIN}${dir}${file}`)),
      ]);
    });

    it("starts at the directory of a seed that names a file", async () => {
      const fetcher = fakeFetcher({});
      await discoverSitemap(`${ORIGIN}/manni/page.html`, fetcher);
      expect(fetcher.calls.slice(1, 4)).toEqual(ROOT_FILES.map((file) => `${ORIGIN}/manni/${file}`));
      expect(fetcher.calls).not.toContain(`${ORIGIN}/manni/page.html/sitemap.xml`);
    });

    it("still lets a robots.txt Sitemap: line win over every directory candidate", async () => {
      const fetcher = fakeFetcher({
        [`${ORIGIN}/robots.txt`]: `Sitemap: ${ORIGIN}/pages.xml\n`,
        [`${ORIGIN}/pages.xml`]: urlset(`${ORIGIN}/from-robots`),
        [`${ORIGIN}/manni/sitemap.xml`]: urlset(`${ORIGIN}/manni/from-prefix`),
      });
      expect(await discoverSitemap(`${ORIGIN}/manni/`, fetcher)).toEqual({
        source: `${ORIGIN}/pages.xml`,
        urls: [`${ORIGIN}/from-robots`],
      });
      expect(fetcher.calls).toEqual([`${ORIGIN}/robots.txt`, `${ORIGIN}/pages.xml`]);
    });

    it("produces exactly the three root candidates after robots for a seed at the root", async () => {
      const fetcher = fakeFetcher({});
      await discoverSitemap(SEED, fetcher);
      expect(fetcher.calls).toEqual([
        `${ORIGIN}/robots.txt`,
        ...ROOT_FILES.map((file) => `${ORIGIN}/${file}`),
      ]);
    });

    it("finds sitemap_index.xml", async () => {
      const fetcher = fakeFetcher({
        [`${ORIGIN}/manni/sitemap_index.xml`]: urlset(`${ORIGIN}/manni/a`),
      });
      expect(await discoverSitemap(`${ORIGIN}/manni/`, fetcher)).toEqual({
        source: `${ORIGIN}/manni/sitemap_index.xml`,
        urls: [`${ORIGIN}/manni/a`],
      });
    });

    it("falls through a 2xx unparseable sitemap.xml in the nearest directory", async () => {
      const fetcher = fakeFetcher({
        [`${ORIGIN}/manni/sitemap.xml`]: "<!doctype html><html><body>SPA shell</body></html>",
        [`${ORIGIN}/manni/sitemap-index.xml`]: urlset(`${ORIGIN}/manni/a`),
      });
      expect(await discoverSitemap(`${ORIGIN}/manni/`, fetcher)).toEqual({
        source: `${ORIGIN}/manni/sitemap-index.xml`,
        urls: [`${ORIGIN}/manni/a`],
      });
    });
  });

  it("follows a sitemap index into its children", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/sitemap.xml`]: index(`${ORIGIN}/one.xml`, `${ORIGIN}/two.xml`),
      [`${ORIGIN}/one.xml`]: urlset(`${ORIGIN}/a`),
      [`${ORIGIN}/two.xml`]: urlset(`${ORIGIN}/b`, `${ORIGIN}/a`),
    });
    expect(await discoverSitemap(SEED, fetcher)).toEqual({
      source: `${ORIGIN}/sitemap.xml`,
      urls: [`${ORIGIN}/a`, `${ORIGIN}/b`],
    });
  });

  it("stops recursing into indexes past depth 3", async () => {
    const chain = (n: number): Record<string, Route> => {
      const routes: Record<string, Route> = {};
      let name = `${ORIGIN}/sitemap.xml`;
      for (let i = 0; i < n; i++) {
        const next = `${ORIGIN}/level${i + 1}.xml`;
        routes[name] = index(next);
        name = next;
      }
      routes[name] = urlset(`${ORIGIN}/leaf`);
      return routes;
    };
    expect((await discoverSitemap(SEED, fakeFetcher(chain(3)))).urls).toEqual([`${ORIGIN}/leaf`]);
    expect((await discoverSitemap(SEED, fakeFetcher(chain(4)))).urls).toEqual([]);
  });

  it("reads at most 50 child sitemaps", async () => {
    const children = Array.from({ length: 52 }, (_, i) => `${ORIGIN}/part${i}.xml`);
    const routes: Record<string, Route> = { [`${ORIGIN}/sitemap.xml`]: index(...children) };
    children.forEach((c, i) => {
      routes[c] = urlset(`${ORIGIN}/p${i}`);
    });
    const fetcher = fakeFetcher(routes);
    const found = await discoverSitemap(SEED, fetcher);
    expect(found.urls).toHaveLength(50);
    expect(fetcher.calls.filter((c) => c.includes("/part"))).toHaveLength(50);
  });

  it("keeps only same-host page URLs, normalized and deduped, in document order", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/sitemap.xml`]: urlset(
        `${ORIGIN}/b#frag`,
        "https://example.org/elsewhere.html",
        `https://DOCS.example.com/a`,
        `${ORIGIN}/b`,
        `${ORIGIN}/brochure.pdf`,
        `https://www.docs.example.com/c`,
      ),
    });
    expect((await discoverSitemap(SEED, fetcher)).urls).toEqual([`${ORIGIN}/b`, `${ORIGIN}/a`]);
  });

  it("reports no sitemap on 404", async () => {
    expect(await discoverSitemap(SEED, fakeFetcher({}))).toEqual({ source: null, urls: [] });
  });

  it("reports no sitemap on a 5xx", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/robots.txt`]: 500,
      [`${ORIGIN}/sitemap.xml`]: 503,
    });
    expect(await discoverSitemap(SEED, fetcher)).toEqual({ source: null, urls: [] });
  });

  it("reports no sitemap when the fetch throws", async () => {
    const fetcher: Fetcher = () => Promise.reject(new Error("ECONNREFUSED"));
    expect(await discoverSitemap(SEED, fetcher)).toEqual({ source: null, urls: [] });
  });

  it("reports no sitemap when the body does not parse", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/sitemap.xml`]: "<!doctype html><html><body>Not found</body></html>",
    });
    expect(await discoverSitemap(SEED, fetcher)).toEqual({ source: null, urls: [] });
  });

  it("skips an index child that fails and keeps the rest", async () => {
    const fetcher = fakeFetcher({
      [`${ORIGIN}/sitemap.xml`]: index(`${ORIGIN}/broken.xml`, `${ORIGIN}/ok.xml`),
      [`${ORIGIN}/broken.xml`]: () => Promise.reject(new Error("boom")),
      [`${ORIGIN}/ok.xml`]: urlset(`${ORIGIN}/a`),
    });
    expect((await discoverSitemap(SEED, fetcher)).urls).toEqual([`${ORIGIN}/a`]);
  });

  describe("against the fixture site", () => {
    it("finds the sitemap through robots.txt and lists the three same-host pages", async () => {
      const fetcher = fakeFetcher({
        [`${ORIGIN}/robots.txt`]: fixture("robots.txt"),
        [`${ORIGIN}/sitemap.xml`]: fixture("sitemap.xml"),
      });
      expect(await discoverSitemap(SEED, fetcher)).toEqual({
        source: `${ORIGIN}/sitemap.xml`,
        urls: [`${ORIGIN}/index.html`, `${ORIGIN}/about.html`, `${ORIGIN}/orphan.html`],
      });
    });

    it("follows sitemap-index.xml to sitemap.xml", async () => {
      const fetcher = fakeFetcher({
        [`${ORIGIN}/robots.txt`]: `Sitemap: ${ORIGIN}/sitemap-index.xml\n`,
        [`${ORIGIN}/sitemap-index.xml`]: fixture("sitemap-index.xml"),
        [`${ORIGIN}/sitemap.xml`]: fixture("sitemap.xml"),
      });
      const found = await discoverSitemap(SEED, fetcher);
      expect(found.source).toBe(`${ORIGIN}/sitemap-index.xml`);
      expect(found.urls).toEqual([`${ORIGIN}/index.html`, `${ORIGIN}/about.html`, `${ORIGIN}/orphan.html`]);
    });
  });
});
