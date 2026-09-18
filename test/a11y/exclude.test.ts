/**
 * The exclusion matcher: globs matched against a URL's path alone, with any
 * trailing slash removed, so one pattern reads the same on a local preview
 * and on production. Proposal 0059 decision 4.
 */
import { describe, expect, it } from "vitest";
import {
  createExcludeFilter,
  excludePath,
  isUrlPathGlob,
} from "../../src/a11y/core/exclude.js";
import { configGlobs, flagGlobs } from "../helpers/exclude-globs.js";

const S = "https://site.example";

describe("excludePath", () => {
  it("is the path alone, with no scheme, host, port, query or fragment", () => {
    expect(excludePath(`${S}/proposals/0035`)).toBe("/proposals/0035");
    expect(excludePath("http://127.0.0.1:4321/proposals/0035")).toBe("/proposals/0035");
    expect(excludePath(`${S}/a?q=1#top`)).toBe("/a");
  });

  it("drops one trailing slash, and keeps the root path as /", () => {
    expect(excludePath(`${S}/proposals/`)).toBe("/proposals");
    expect(excludePath(`${S}/proposals`)).toBe("/proposals");
    expect(excludePath(`${S}/`)).toBe("/");
  });

  it("is null for a string that is not a URL", () => {
    expect(excludePath("proposals/")).toBeNull();
  });
});

describe("isUrlPathGlob", () => {
  it("is a leading slash and nothing else", () => {
    expect(isUrlPathGlob("/proposals/**")).toBe(true);
    expect(isUrlPathGlob("/")).toBe(true);
    expect(isUrlPathGlob("proposals/**")).toBe(false);
    expect(isUrlPathGlob("**/proposals")).toBe(false);
    expect(isUrlPathGlob("")).toBe(false);
  });
});

describe("createExcludeFilter", () => {
  it("excludes nothing when the list is empty", () => {
    const filter = createExcludeFilter(flagGlobs());
    expect(filter.patterns).toEqual([]);
    expect(filter.matches(`${S}/proposals/`)).toBe(false);
    expect(filter.match(`${S}/proposals/`)).toBeNull();
  });

  it("matches a prefix pattern against everything under it", () => {
    const filter = createExcludeFilter(flagGlobs("/reference/api/**"));
    expect(filter.matches(`${S}/reference/api/render`)).toBe(true);
    expect(filter.matches(`${S}/reference/api/deep/nested/page`)).toBe(true);
    expect(filter.matches(`${S}/reference/cli`)).toBe(false);
  });

  it("covers the directory itself for a pattern ending /**", () => {
    const filter = createExcludeFilter(flagGlobs("/proposals/**"));
    expect(filter.matches(`${S}/proposals/`)).toBe(true);
    expect(filter.matches(`${S}/proposals`)).toBe(true);
    expect(filter.matches(`${S}/proposals/0035/`)).toBe(true);
  });

  it("does not match a sibling whose name starts the same", () => {
    const filter = createExcludeFilter(flagGlobs("/proposals/**"));
    expect(filter.matches(`${S}/proposals-archive/`)).toBe(false);
    expect(filter.matches(`${S}/proposals-archive/0001/`)).toBe(false);
  });

  it("matches the same path whatever the host, scheme or port", () => {
    const filter = createExcludeFilter(flagGlobs("/manni/proposals/**"));
    for (const url of [
      "https://hawkeyexl.github.io/manni/proposals/0035/",
      "http://127.0.0.1:4321/manni/proposals/0035/",
    ]) {
      expect(filter.matches(url)).toBe(true);
    }
  });

  it("matches nothing when no pattern fits, and says which one did when one does", () => {
    const filter = createExcludeFilter(flagGlobs("/blog/**", "/proposals/**"));
    expect(filter.match(`${S}/install/`)).toBeNull();
    expect(filter.match(`${S}/proposals/0035/`)?.glob).toBe("/proposals/**");
    expect(filter.match(`${S}/blog/hello/`)?.glob).toBe("/blog/**");
  });

  it("hands back the name the pattern's own source gives it", () => {
    const flag = createExcludeFilter(flagGlobs("/proposals/**"));
    expect(flag.match(`${S}/proposals/`)?.source).toBe('--exclude "/proposals/**"');
    const file = createExcludeFilter(
      configGlobs("manni.config.yaml", "/blog/**", "/proposals/**"),
    );
    expect(file.match(`${S}/proposals/`)?.source).toBe('manni.config.yaml: "a11y.exclude[1]"');
  });

  it("reads a value containing a comma as one pattern", () => {
    const filter = createExcludeFilter(flagGlobs("/a,/b"));
    expect(filter.matches(`${S}/a`)).toBe(false);
    expect(filter.matches(`${S}/b`)).toBe(false);
    expect(filter.matches(`${S}/a,/b`)).toBe(true);
  });

  it("excludes nothing for a URL it cannot parse", () => {
    const filter = createExcludeFilter(flagGlobs("/**"));
    expect(filter.matches("not-a-url")).toBe(false);
  });
});
