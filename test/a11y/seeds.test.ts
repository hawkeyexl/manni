/**
 * Seed resolution: the one place that decides what `manni a11y check` starts
 * from (proposal 0041, rule 12). Four sources, first non-empty winning, and
 * three refusals. Pure, so every rung of the order is a unit test rather than
 * a spawned bin with a browser behind it.
 */
import { describe, expect, it } from "vitest";
import { NO_SEEDS_MESSAGE, resolveSeeds } from "../../src/a11y/core/seeds.js";
import { A11yError } from "../../src/a11y/types.js";
import type { CollectionConfig } from "../../src/shared/collections.js";

/** A declared collection; only `name` and `url` matter to seeds. */
function collection(name: string, url?: string): CollectionConfig {
  return {
    name,
    paths: [`${name}/`],
    exclude: [],
    externalMetadata: [],
    ...(url === undefined ? {} : { url }),
  };
}

const GUIDES = collection("guides", "https://docs.example.com/guides/");
const BLOG = collection("blog");
const API = collection("api", "https://docs.example.com/api/");

describe("resolveSeeds", () => {
  it("takes the positional URLs first, over both config and collections", () => {
    expect(
      resolveSeeds({
        urls: ["https://staging.example.com/"],
        collections: [],
        configUrls: ["https://docs.example.com/"],
        declared: [GUIDES, API],
      }),
    ).toEqual(["https://staging.example.com/"]);
  });

  it("takes the named collections' url next, over a11y.urls", () => {
    expect(
      resolveSeeds({
        urls: [],
        collections: ["guides"],
        configUrls: ["https://docs.example.com/"],
        declared: [GUIDES, BLOG, API],
      }),
    ).toEqual(["https://docs.example.com/guides/"]);
  });

  it("takes a11y.urls next, over every declared collection's url", () => {
    expect(
      resolveSeeds({
        urls: [],
        collections: [],
        configUrls: ["https://www.example.com/", "https://blog.example.com/"],
        declared: [GUIDES, API],
      }),
    ).toEqual(["https://www.example.com/", "https://blog.example.com/"]);
  });

  it("falls back to every declared collection that has a url", () => {
    expect(
      resolveSeeds({ urls: [], collections: [], declared: [GUIDES, BLOG, API] }),
    ).toEqual(["https://docs.example.com/guides/", "https://docs.example.com/api/"]);
  });

  it("treats an empty a11y.urls as no urls and falls through to the collections", () => {
    expect(
      resolveSeeds({ urls: [], collections: [], configUrls: [], declared: [GUIDES] }),
    ).toEqual(["https://docs.example.com/guides/"]);
  });

  it("returns the named collections in declaration order, however they were named", () => {
    expect(
      resolveSeeds({
        urls: [],
        collections: ["api", "guides"],
        declared: [GUIDES, BLOG, API],
      }),
    ).toEqual(["https://docs.example.com/guides/", "https://docs.example.com/api/"]);
  });

  it("collapses a repeated --collection", () => {
    expect(
      resolveSeeds({
        urls: [],
        collections: ["guides", "guides"],
        declared: [GUIDES, BLOG],
      }),
    ).toEqual(["https://docs.example.com/guides/"]);
  });

  it("collapses two collections published at the same url", () => {
    const twin = collection("twin", GUIDES.url);
    expect(resolveSeeds({ urls: [], collections: [], declared: [GUIDES, twin] })).toEqual([
      "https://docs.example.com/guides/",
    ]);
    expect(
      resolveSeeds({ urls: [], collections: ["twin", "guides"], declared: [GUIDES, twin] }),
    ).toEqual(["https://docs.example.com/guides/"]);
  });

  it("is an error when nothing comes from any of the four sources", () => {
    expect(() => resolveSeeds({ urls: [], collections: [], declared: [] })).toThrow(A11yError);
    expect(() => resolveSeeds({ urls: [], collections: [], declared: [] })).toThrow(
      new A11yError(
        "No URLs to check. Pass one or more, set url: on a collection, or set a11y.urls in manni.config.yaml.",
      ),
    );
    expect(NO_SEEDS_MESSAGE).toBe(
      "No URLs to check. Pass one or more, set url: on a collection, or set a11y.urls in manni.config.yaml.",
    );
  });

  it("is an error when every declared collection lacks a url and nothing else is set", () => {
    expect(() => resolveSeeds({ urls: [], collections: [], declared: [BLOG] })).toThrow(
      new A11yError(NO_SEEDS_MESSAGE),
    );
  });

  it("refuses a named collection with no url:", () => {
    expect(() => resolveSeeds({ urls: [], collections: ["blog"], declared: [GUIDES, BLOG] })).toThrow(
      new A11yError('collection "blog" has no url: to check.'),
    );
  });

  it("names the first url-less collection in declaration order", () => {
    const draft = collection("draft");
    expect(() =>
      resolveSeeds({
        urls: [],
        collections: ["draft", "blog"],
        declared: [GUIDES, BLOG, draft],
      }),
    ).toThrow(new A11yError('collection "blog" has no url: to check.'));
  });

  it("names a url-less collection even when another named one has a url", () => {
    expect(() =>
      resolveSeeds({ urls: [], collections: ["guides", "blog"], declared: [GUIDES, BLOG] }),
    ).toThrow(new A11yError('collection "blog" has no url: to check.'));
  });

  it("refuses --collection together with positional URLs", () => {
    expect(() =>
      resolveSeeds({
        urls: ["https://x.example/"],
        collections: ["guides"],
        declared: [GUIDES],
      }),
    ).toThrow(
      new A11yError(
        "--collection selects a configured collection; it cannot be combined with URLs.",
      ),
    );
  });

  it("prefers the combination error over an unknown name", () => {
    expect(() =>
      resolveSeeds({ urls: ["https://x.example/"], collections: ["gides"], declared: [GUIDES] }),
    ).toThrow(
      new A11yError(
        "--collection selects a configured collection; it cannot be combined with URLs.",
      ),
    );
  });

  it("raises an unknown --collection name as an A11yError, listing what is configured", () => {
    expect(() =>
      resolveSeeds({
        urls: [],
        collections: ["gides"],
        declared: [GUIDES, BLOG],
        source: "manni.config.yaml",
      }),
    ).toThrow(
      new A11yError(
        'no collection named "gides" in manni.config.yaml. Configured: guides, blog.',
      ),
    );
  });

  it("names the config file the run actually loaded", () => {
    expect(() =>
      resolveSeeds({
        urls: [],
        collections: ["gides"],
        declared: [GUIDES],
        source: "ci/manni.config.yaml",
      }),
    ).toThrow(/in ci\/manni\.config\.yaml\. Configured: guides\./);
  });

  // The absence of a config file is not an unknown name. `manni meta` refuses
  // the same combination with the same sentence.
  it("says a config file is needed when there is none to select from", () => {
    for (const source of [undefined, null]) {
      expect(() =>
        resolveSeeds({ urls: [], collections: ["guides"], declared: [], source }),
      ).toThrow(new A11yError("--collection needs a config file to select from."));
    }
  });

  // A programmatic caller may hold collections without naming a file. That is
  // still a config, so an unknown name there is an unknown name.
  it("names the family file for an unknown name when collections came without a source", () => {
    expect(() =>
      resolveSeeds({ urls: [], collections: ["gides"], declared: [GUIDES] }),
    ).toThrow(
      new A11yError(
        'no collection named "gides" in manni.config.yaml. Configured: guides.',
      ),
    );
  });

  /**
   * The asymmetry rule 12 states: naming a collection with no `url` is an
   * error, while a collection with no `url` merely contributing nothing to the
   * default set is not. Someone who typed `--collection blog` asked for
   * something specific; someone who typed nothing gets whatever is publishable.
   */
  it("errors on a url-less collection when named and skips it when not", () => {
    expect(() =>
      resolveSeeds({ urls: [], collections: ["blog"], declared: [GUIDES, BLOG] }),
    ).toThrow(new A11yError('collection "blog" has no url: to check.'));
    expect(resolveSeeds({ urls: [], collections: [], declared: [GUIDES, BLOG] })).toEqual([
      "https://docs.example.com/guides/",
    ]);
  });
});
