/**
 * URL helpers for the a11y crawl: the canonical spelling used for dedupe,
 * the same-site test that keeps a crawl on its host, and the filter that
 * keeps assets and non-http schemes out of the frontier.
 */
import { describe, expect, it } from "vitest";
import {
  ASSET_EXTENSIONS,
  dedupeKey,
  isHttpUrl,
  isPageLink,
  normalizeUrl,
  sameHost,
} from "../../src/a11y/core/url.js";
import { A11yError } from "../../src/a11y/types.js";

describe("dedupeKey", () => {
  it("drops one trailing slash from the path", () => {
    expect(dedupeKey("https://example.com/a/")).toBe("https://example.com/a");
    expect(dedupeKey("https://example.com/a")).toBe("https://example.com/a");
    expect(dedupeKey("https://example.com/docs/guide/")).toBe("https://example.com/docs/guide");
  });

  it("keeps the root path as /", () => {
    expect(dedupeKey("https://example.com/")).toBe("https://example.com/");
    expect(dedupeKey("https://example.com")).toBe("https://example.com/");
  });

  it("keeps the query string", () => {
    expect(dedupeKey("https://example.com/a/?b=1&c=2")).toBe("https://example.com/a?b=1&c=2");
    expect(dedupeKey("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(dedupeKey("https://example.com/?b=1")).toBe("https://example.com/?b=1");
  });

  it("normalizes the fragment and the host case first", () => {
    expect(dedupeKey("HTTPS://Example.COM/A/#top")).toBe("https://example.com/A");
    expect(dedupeKey("http://example.com:80/a/")).toBe("http://example.com/a");
  });

  it("leaves a path that names a file alone", () => {
    expect(dedupeKey("https://example.com/a.html")).toBe("https://example.com/a.html");
  });

  it("throws A11yError for an unparseable string", () => {
    expect(() => dedupeKey("not a url")).toThrow(A11yError);
  });
});

describe("normalizeUrl", () => {
  it("drops the fragment", () => {
    expect(normalizeUrl("https://example.com/a#top")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/a#")).toBe("https://example.com/a");
  });

  it("lowercases the scheme and hostname, not the path", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Docs/Page")).toBe(
      "https://example.com/Docs/Page",
    );
  });

  it("drops a default port and keeps a non-default one", () => {
    expect(normalizeUrl("http://example.com:80/")).toBe("http://example.com/");
    expect(normalizeUrl("https://example.com:443/")).toBe("https://example.com/");
    expect(normalizeUrl("http://example.com:8080/")).toBe("http://example.com:8080/");
    expect(normalizeUrl("https://example.com:80/")).toBe("https://example.com:80/");
  });

  it("keeps the query and the trailing slash exactly", () => {
    expect(normalizeUrl("https://example.com/a?b=1&c=2")).toBe(
      "https://example.com/a?b=1&c=2",
    );
    expect(normalizeUrl("https://example.com/a/")).toBe("https://example.com/a/");
    expect(normalizeUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  it("spells an empty path as /, the only spelling the URL parser has", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("throws A11yError for an unparseable string", () => {
    expect(() => normalizeUrl("not a url")).toThrow(A11yError);
    expect(() => normalizeUrl("")).toThrow(A11yError);
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isHttpUrl("http://example.com/")).toBe(true);
    expect(isHttpUrl("https://example.com/")).toBe(true);
    expect(isHttpUrl("HTTPS://example.com/")).toBe(true);
  });

  it("rejects other schemes and bare words", () => {
    expect(isHttpUrl("ftp://example.com/")).toBe(false);
    expect(isHttpUrl("mailto:someone@example.com")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
    expect(isHttpUrl("not-a-url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("sameHost", () => {
  it("treats http and https of one host as the same site", () => {
    expect(sameHost("http://example.com/a", "https://example.com/b")).toBe(true);
  });

  it("compares the hostname case-insensitively", () => {
    expect(sameHost("https://Example.COM/", "https://example.com/x")).toBe(true);
  });

  it("treats www. as a different host", () => {
    expect(sameHost("https://example.com/", "https://www.example.com/")).toBe(false);
  });

  it("treats a non-default port as a different site", () => {
    expect(sameHost("http://example.com/", "http://example.com:8080/")).toBe(false);
    expect(sameHost("http://example.com:8080/", "http://example.com:8080/x")).toBe(true);
  });

  it("treats an explicit default port and no port as equal", () => {
    expect(sameHost("http://example.com:80/", "http://example.com/")).toBe(true);
    expect(sameHost("https://example.com:443/", "https://example.com/")).toBe(true);
  });

  it("is false when either side does not parse", () => {
    expect(sameHost("nope", "https://example.com/")).toBe(false);
    expect(sameHost("https://example.com/", "")).toBe(false);
  });
});

describe("isPageLink", () => {
  it("accepts an http(s) page", () => {
    expect(isPageLink("https://example.com/")).toBe(true);
    expect(isPageLink("https://example.com/docs/")).toBe(true);
    expect(isPageLink("https://example.com/about.html")).toBe(true);
    expect(isPageLink("http://example.com/page?x=1")).toBe(true);
  });

  it.each(["mailto:someone@example.com", "tel:+15555550100", "javascript:void(0)", "data:text/html,hi"])(
    "rejects %s",
    (url) => {
      expect(isPageLink(url)).toBe(false);
    },
  );

  it("rejects an unparseable string", () => {
    expect(isPageLink("not a url")).toBe(false);
  });

  it.each([...ASSET_EXTENSIONS])("rejects a path ending in %s", (ext) => {
    expect(isPageLink(`https://example.com/dir/file${ext}`)).toBe(false);
  });

  it("matches the extension case-insensitively and ignores the query", () => {
    expect(isPageLink("https://example.com/file.PDF")).toBe(false);
    expect(isPageLink("https://example.com/file.pdf?download=1")).toBe(false);
  });

  it("looks only at the last path segment", () => {
    expect(isPageLink("https://example.com/v1.0/docs")).toBe(true);
    expect(isPageLink("https://example.com/assets.css/page")).toBe(true);
  });

  it("lists the asset extensions the plan names", () => {
    for (const ext of [".pdf", ".zip", ".gz", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico", ".css", ".js", ".mjs", ".map", ".json", ".xml", ".txt", ".mp3", ".mp4", ".webm", ".woff", ".woff2", ".ttf"]) {
      expect(ASSET_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});
