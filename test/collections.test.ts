/**
 * The shared `collections:` layer (proposal 0041).
 *
 * `collections:` is a top-level key of the family config file, parsed once in
 * `src/shared/` and handed to every tool beside its own section. This suite
 * covers the parser, the `--collection` selection, and membership, which is
 * path arithmetic over an already-relative posix label and never touches the
 * filesystem.
 */
import { describe, expect, it } from "vitest";
import {
  isMember,
  parseCollections,
  selectCollections,
  type CollectionConfig,
} from "../src/shared/collections.js";

const SOURCE = "manni.config.yaml";
const toError = (message: string): Error => new Error(message);

/** The message `parseCollections` refused with. Fails if it did not refuse. */
function refusal(raw: unknown): string {
  try {
    parseCollections(raw, SOURCE, toError);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected parseCollections to throw, but it returned");
}

/** The message a `toError`-throwing call refused with. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the call to throw, but it returned");
}

/** A collection with the defaults `parseCollections` would have filled in. */
function collection(over: Partial<CollectionConfig>): CollectionConfig {
  return {
    name: "guides",
    paths: ["docs/guides"],
    exclude: [],
    externalMetadata: [],
    ...over,
  };
}

describe("parseCollections (0041)", () => {
  it("refuses a value that is not a list", () => {
    expect(refusal({ guides: { paths: ["docs"] } })).toBe(
      'manni.config.yaml: "collections" must be a list.',
    );
  });

  it("refuses an empty list", () => {
    expect(refusal([])).toBe(
      'manni.config.yaml: "collections" must name at least one collection; remove the key if there are none.',
    );
  });

  it("refuses an entry that is not a mapping", () => {
    expect(refusal(["guides"])).toBe(
      "manni.config.yaml: collections[0] must be a mapping.",
    );
  });

  it("refuses an unknown key in an entry", () => {
    expect(refusal([{ name: "guides", path: "docs" }])).toBe(
      'manni.config.yaml: collections[0] has unknown key "path". Supported keys: name, paths, exclude, url, externalMetadata.',
    );
  });

  it("refuses a missing or blank name", () => {
    const expected =
      "manni.config.yaml: collections[0].name must be a non-empty string.";
    expect(refusal([{ paths: ["docs"] }])).toBe(expected);
    expect(refusal([{ name: 7, paths: ["docs"] }])).toBe(expected);
    expect(refusal([{ name: "  ", paths: ["docs"] }])).toBe(expected);
  });

  it("refuses a duplicate name, compared case-insensitively", () => {
    expect(
      refusal([
        { name: "guides", paths: ["docs/guides"] },
        { name: "Guides", paths: ["docs/more"] },
      ]),
    ).toBe(
      'manni.config.yaml: collections[1].name "Guides" is already taken by collections[0]; names are compared case-insensitively because they become SQL views.',
    );
  });

  it('refuses the name "docs" in any casing', () => {
    expect(refusal([{ name: "docs", paths: ["docs"] }])).toBe(
      'manni.config.yaml: collections[0].name "docs" collides with the docs table every query reads. Pick another name, such as "site" or "pages".',
    );
    expect(refusal([{ name: "DOCS", paths: ["docs"] }])).toBe(
      'manni.config.yaml: collections[0].name "DOCS" collides with the docs table every query reads. Pick another name, such as "site" or "pages".',
    );
  });

  // The derived table (proposal 0040) is a view named `derived` over a table
  // named `_derived_rows`, built beside `docs` when a statement reads it.
  it.each(["derived", "Derived", "_derived_rows", "_DERIVED_ROWS"])(
    'refuses the name "%s", which the derived table uses',
    (name) => {
      expect(refusal([{ name, paths: ["docs"] }])).toBe(
        `manni.config.yaml: collections[0].name "${name}" collides with the derived table a query builds beside docs (the derived view and its _derived_rows table). Pick another name.`,
      );
    },
  );

  it('refuses a name starting "sqlite_" in any casing', () => {
    expect(refusal([{ name: "sqlite_x", paths: ["docs"] }])).toBe(
      'manni.config.yaml: collections[0].name "sqlite_x" starts with "sqlite_", which SQLite reserves for its own objects. Pick another name.',
    );
    expect(refusal([{ name: "SQLite_x", paths: ["docs"] }])).toBe(
      'manni.config.yaml: collections[0].name "SQLite_x" starts with "sqlite_", which SQLite reserves for its own objects. Pick another name.',
    );
  });

  it("refuses paths that are missing, not a list, empty, or hold a blank", () => {
    const expected =
      "manni.config.yaml: collections[0].paths must be a non-empty list of files, directories or globs.";
    expect(refusal([{ name: "guides" }])).toBe(expected);
    expect(refusal([{ name: "guides", paths: "docs" }])).toBe(expected);
    expect(refusal([{ name: "guides", paths: [] }])).toBe(expected);
    expect(refusal([{ name: "guides", paths: ["docs", 3] }])).toBe(expected);
    expect(refusal([{ name: "guides", paths: ["docs", " "] }])).toBe(expected);
  });

  it("refuses an exclude that is not a list of globs, but accepts an empty one", () => {
    const expected =
      "manni.config.yaml: collections[0].exclude must be a list of globs.";
    expect(
      refusal([{ name: "guides", paths: ["docs"], exclude: "draft" }]),
    ).toBe(expected);
    expect(refusal([{ name: "guides", paths: ["docs"], exclude: [7] }])).toBe(
      expected,
    );
    expect(
      parseCollections(
        [{ name: "guides", paths: ["docs"], exclude: [] }],
        SOURCE,
        toError,
      )[0]?.exclude,
    ).toEqual([]);
  });

  it("refuses a url that is not an http(s) URL", () => {
    const expected =
      "manni.config.yaml: collections[0].url must be an http(s) URL.";
    expect(refusal([{ name: "guides", paths: ["docs"], url: 7 }])).toBe(
      expected,
    );
    expect(
      refusal([{ name: "guides", paths: ["docs"], url: "docs/guides" }]),
    ).toBe(expected);
    expect(
      refusal([{ name: "guides", paths: ["docs"], url: "ftp://example.com" }]),
    ).toBe(expected);
  });

  it("refuses an externalMetadata that is not a list, but accepts an empty one", () => {
    expect(
      refusal([{ name: "guides", paths: ["docs"], externalMetadata: {} }]),
    ).toBe("manni.config.yaml: collections[0].externalMetadata must be a list.");
    expect(
      parseCollections(
        [{ name: "guides", paths: ["docs"], externalMetadata: [] }],
        SOURCE,
        toError,
      )[0]?.externalMetadata,
    ).toEqual([]);
  });

  describe("externalMetadata entries (0037)", () => {
    const base = (externalMetadata: unknown[]): unknown[] => [
      { name: "guides", paths: ["docs"], externalMetadata },
    ];

    it("refuses an entry that is not a mapping", () => {
      expect(refusal(base(["jira.yaml"]))).toBe(
        "manni.config.yaml: collections[0].externalMetadata[0] must be a mapping.",
      );
    });

    it("refuses an unknown key", () => {
      expect(
        refusal(base([{ file: "j.yaml", keys: ["jira"], on: "slug" }])),
      ).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0] has unknown key "on". Supported keys: file, keys, tokenEnv, join.',
      );
    });

    it("refuses a missing file", () => {
      expect(refusal(base([{ keys: ["jira"] }]))).toBe(
        "manni.config.yaml: collections[0].externalMetadata[0].file must be a non-empty string naming the manifest, relative to the config file.",
      );
    });

    it("refuses keys that are missing or empty", () => {
      const expected =
        "manni.config.yaml: collections[0].externalMetadata[0].keys must be a non-empty list of key names.";
      expect(refusal(base([{ file: "j.yaml" }]))).toBe(expected);
      expect(refusal(base([{ file: "j.yaml", keys: [] }]))).toBe(expected);
      expect(refusal(base([{ file: "j.yaml", keys: ["jira", ""] }]))).toBe(
        expected,
      );
    });

    it("refuses a URL file that carries a credential", () => {
      expect(
        refusal(
          base([{ file: "https://u:p@example.com/m.yaml", keys: ["jira"] }]),
        ),
      ).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0].file carries a credential in the URL; put the token in an environment variable and name it with "tokenEnv".',
      );
    });

    it("refuses a plain http URL off loopback", () => {
      expect(
        refusal(base([{ file: "http://example.com/m.yaml", keys: ["jira"] }])),
      ).toBe(
        "manni.config.yaml: collections[0].externalMetadata[0].file is plain http://; a bearer token over plaintext is a leak, and a public manifest is served over https too.",
      );
    });

    it("refuses a blank tokenEnv, and one paired with a path", () => {
      expect(
        refusal(
          base([
            {
              file: "https://example.com/m.yaml",
              keys: ["jira"],
              tokenEnv: " ",
            },
          ]),
        ),
      ).toBe(
        "manni.config.yaml: collections[0].externalMetadata[0].tokenEnv must be the name of an environment variable.",
      );
      expect(
        refusal(base([{ file: "j.yaml", keys: ["jira"], tokenEnv: "TOKEN" }])),
      ).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0].tokenEnv is set, but "file" is a path, so no request is made and the token would go nowhere. Remove it, or make "file" a URL.',
      );
    });

    it("refuses a blank join, $schema as join, and a join the entry owns", () => {
      expect(refusal(base([{ file: "j.yaml", keys: ["jira"], join: "" }]))).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0].join must be "path" or the name of a top-level frontmatter field.',
      );
      expect(
        refusal(base([{ file: "j.yaml", keys: ["jira"], join: "$schema" }])),
      ).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0].join may not be "$schema".',
      );
      expect(
        refusal(base([{ file: "j.yaml", keys: ["jira"], join: "jira" }])),
      ).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0].join names "jira", which the same entry owns — the value that selects an entry cannot come from the entry.',
      );
    });

    it("refuses $schema among the keys", () => {
      expect(refusal(base([{ file: "j.yaml", keys: ["$schema"] }]))).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0].keys may not include "$schema" — a manifest never chooses the schema a document is judged by; use "overrides".',
      );
    });

    it("refuses a key listed twice in one entry", () => {
      expect(refusal(base([{ file: "j.yaml", keys: ["jira", "jira"] }]))).toBe(
        'manni.config.yaml: collections[0].externalMetadata[0].keys lists "jira" twice.',
      );
    });

    it("refuses two manifests of one collection owning the same key", () => {
      expect(
        refusal(
          base([
            { file: "a.yaml", keys: ["jira"] },
            { file: "b.yaml", keys: ["jira"] },
          ]),
        ),
      ).toBe(
        'manni.config.yaml: collections[0].externalMetadata[1].keys claims "jira", which externalMetadata[0] already owns — a key has exactly one manifest in a collection.',
      );
    });

    it("allows two different collections to own the same key", () => {
      const parsed = parseCollections(
        [
          {
            name: "guides",
            paths: ["docs/guides"],
            externalMetadata: [{ file: "a.yaml", keys: ["owner"] }],
          },
          {
            name: "blog",
            paths: ["blog"],
            externalMetadata: [{ file: "b.yaml", keys: ["owner"] }],
          },
        ],
        SOURCE,
        toError,
      );
      expect(parsed.map((c) => c.name)).toEqual(["guides", "blog"]);
    });
  });

  it("parses a full collection and fills the defaults", () => {
    expect(
      parseCollections(
        [
          {
            name: "guides",
            paths: ["docs/guides", "**/*.mdx"],
            exclude: ["docs/guides/draft/**"],
            url: "https://example.com/guides/",
            externalMetadata: [
              { file: "meta/jira.yaml", keys: ["jira", "epic"] },
              {
                file: "https://example.com/owners.yaml",
                keys: ["owner"],
                tokenEnv: "OWNERS_TOKEN",
                join: "slug",
              },
            ],
          },
          { name: "blog", paths: ["blog"] },
        ],
        SOURCE,
        toError,
      ),
    ).toEqual([
      {
        name: "guides",
        paths: ["docs/guides", "**/*.mdx"],
        exclude: ["docs/guides/draft/**"],
        url: "https://example.com/guides/",
        externalMetadata: [
          { file: "meta/jira.yaml", keys: ["jira", "epic"] },
          {
            file: "https://example.com/owners.yaml",
            keys: ["owner"],
            tokenEnv: "OWNERS_TOKEN",
            join: "slug",
          },
        ],
      },
      { name: "blog", paths: ["blog"], exclude: [], externalMetadata: [] },
    ]);
  });
});

describe("selectCollections (0041)", () => {
  const guides = collection({ name: "guides" });
  const blog = collection({ name: "blog", paths: ["blog"] });
  const api = collection({ name: "api", paths: ["api"] });
  const all = [guides, blog, api];

  it("returns every collection when no names are given", () => {
    expect(selectCollections(all, undefined, SOURCE, toError)).toEqual(all);
  });

  it("returns the named ones in declaration order, not the order named", () => {
    expect(
      selectCollections(all, ["api", "guides"], SOURCE, toError).map(
        (c) => c.name,
      ),
    ).toEqual(["guides", "api"]);
  });

  it("dedupes a repeated name silently", () => {
    expect(
      selectCollections(all, ["blog", "blog"], SOURCE, toError).map(
        (c) => c.name,
      ),
    ).toEqual(["blog"]);
  });

  // Commander's repeatable-option collector defaults to `[]`, so an empty list
  // is what "no --collection" looks like from a CLI call site. Selecting
  // nothing here would validate zero files and exit 0.
  it("treats an empty name list as every collection", () => {
    expect(selectCollections(all, [], SOURCE, toError)).toEqual(all);
  });

  it("matches names case-sensitively, and says so when that is the whole miss", () => {
    // Names are unique case-insensitively (they become SQL views) but are
    // selected by their one spelling. "Configured: guides" beside "Guides"
    // would read as a contradiction without the hint.
    expect(messageOf(() => selectCollections(all, ["Guides"], SOURCE, toError))).toBe(
      'no collection named "Guides" in manni.config.yaml. Configured: guides, blog, api. Names are case-sensitive; did you mean "guides"?',
    );
  });

  it("gives no casing hint when no name is a casing away", () => {
    expect(messageOf(() => selectCollections(all, ["gides"], SOURCE, toError))).toBe(
      'no collection named "gides" in manni.config.yaml. Configured: guides, blog, api.',
    );
  });

  it("names the configured collections when one is unknown", () => {
    expect(
      messageOf(() =>
        selectCollections([guides, blog], ["gides"], SOURCE, toError),
      ),
    ).toBe(
      'no collection named "gides" in manni.config.yaml. Configured: guides, blog.',
    );
  });

  it("says (none) when nothing is configured", () => {
    expect(
      messageOf(() => selectCollections([], ["guides"], SOURCE, toError)),
    ).toBe(
      'no collection named "guides" in manni.config.yaml. Configured: (none).',
    );
  });
});

describe("isMember (0041)", () => {
  it("matches a glob entry", () => {
    const c = collection({ paths: ["docs/**/*.md"] });
    expect(isMember(c, "docs/guides/intro.md")).toBe(true);
    expect(isMember(c, "docs/guides/intro.mdx")).toBe(false);
  });

  // An extended glob has no `*`, `?`, `[` or `{` of its own, so a hand-rolled
  // character test read it as a literal path and it matched nothing, silently.
  // picomatch decides what a glob is.
  it("treats an extended glob as a glob, not a literal path", () => {
    const c = collection({ paths: ["docs/!(drafts)/**"] });
    expect(isMember(c, "docs/guides/intro.md")).toBe(true);
    expect(isMember(c, "docs/drafts/wip.md")).toBe(false);
    const alt = collection({ paths: ["docs/@(guides|howto)/*.md"] });
    expect(isMember(alt, "docs/howto/x.md")).toBe(true);
    expect(isMember(alt, "docs/ref/x.md")).toBe(false);
  });

  it("matches everything beneath a bare directory", () => {
    const c = collection({ paths: ["docs/guides"] });
    expect(isMember(c, "docs/guides/intro.md")).toBe(true);
    expect(isMember(c, "docs/guides")).toBe(true);
    expect(isMember(c, "docs/guidelines/intro.md")).toBe(false);
  });

  it("matches an exact filename", () => {
    const c = collection({ paths: ["README.md"] });
    expect(isMember(c, "README.md")).toBe(true);
    expect(isMember(c, "docs/README.md")).toBe(false);
  });

  it("normalises a ./ prefix, a trailing slash, and backslashes", () => {
    expect(
      isMember(collection({ paths: ["./docs/guides"] }), "docs/guides/a.md"),
    ).toBe(true);
    expect(
      isMember(collection({ paths: ["docs/guides/"] }), "docs/guides/a.md"),
    ).toBe(true);
    expect(
      isMember(collection({ paths: ["docs\\guides"] }), "docs/guides/a.md"),
    ).toBe(true);
  });

  it("lets exclude win over paths", () => {
    const c = collection({
      paths: ["docs/guides"],
      exclude: ["docs/guides/draft/**"],
    });
    expect(isMember(c, "docs/guides/intro.md")).toBe(true);
    expect(isMember(c, "docs/guides/draft/wip.md")).toBe(false);
  });

  it("is false for a path outside the config directory", () => {
    const c = collection({ paths: ["docs/guides", "**/*.md"] });
    expect(isMember(c, "../elsewhere/docs/guides/a.md")).toBe(false);
  });

  it("is false for stdin", () => {
    expect(isMember(collection({ paths: ["**"] }), "<stdin>")).toBe(false);
  });

  it("is false for a path no entry matches", () => {
    expect(
      isMember(collection({ paths: ["docs/guides"] }), "blog/post.md"),
    ).toBe(false);
  });
});
