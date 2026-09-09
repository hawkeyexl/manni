import { describe, it, expect } from "vitest";
import { parseConfig, parseConfigValue } from "../src/meta/core/config.js";
import {
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  isDerivableField,
  isDeriveSource,
} from "../src/meta/core/derive/types.js";

const parse = (lines: string[]) =>
  parseConfig(lines.join("\n"), "manni.config.yaml");

describe("derive: config parsing", () => {
  it("parses the full shape", () => {
    const cfg = parse([
      "derive:",
      "  fields: [created, last-updated, authors, owner]",
      "  sources: [git, codeowners, github, gitlab]",
      "  codeowners: .github/CODEOWNERS",
    ]);
    expect(cfg.derive).toEqual({
      fields: ["created", "last-updated", "authors", "owner"],
      sources: ["git", "codeowners", "github", "gitlab"],
      codeowners: ".github/CODEOWNERS",
    });
  });

  it("leaves sources and codeowners absent when not written", () => {
    const cfg = parse(["derive:", "  fields: [created]"]);
    expect(cfg.derive).toEqual({ fields: ["created"] });
    expect(cfg.derive).not.toHaveProperty("sources");
    expect(cfg.derive).not.toHaveProperty("codeowners");
  });

  it("rejects a derive value that is not a mapping", () => {
    expect(() => parse(["derive: [created]"])).toThrow(
      /"derive" must be a mapping/,
    );
    expect(() => parse(["derive: created"])).toThrow(
      /"derive" must be a mapping/,
    );
  });

  it("rejects an unknown key inside derive", () => {
    expect(() =>
      parse(["derive:", "  fields: [created]", "  field: [owner]"]),
    ).toThrow(
      /"derive" has unknown key "field"\. Supported keys: fields, sources, codeowners/,
    );
  });

  it("refuses a derive: that sets nothing", () => {
    expect(() => parse(["derive: {}"])).toThrow(/"derive" sets nothing/);
  });

  it("lets sources or codeowners carry the block with no managed fields", () => {
    // A repository without gh narrows its reads without inventing a managed
    // field; `fields` then defaults to none and validate compares nothing.
    expect(parse(["derive:", "  sources: [git]"]).derive).toEqual({
      fields: [],
      sources: ["git"],
    });
    expect(parse(["derive:", "  codeowners: OWNERS"]).derive).toEqual({
      fields: [],
      codeowners: "OWNERS",
    });
  });

  it("rejects an empty fields list", () => {
    expect(() => parse(["derive:", "  fields: []"])).toThrow(
      /derive\.fields must be a non-empty list of field names/,
    );
  });

  it("rejects a fields value that is not a list of strings", () => {
    expect(() => parse(["derive:", "  fields: created"])).toThrow(
      /derive\.fields must be a non-empty list of field names/,
    );
    expect(() => parse(["derive:", "  fields: [1]"])).toThrow(
      /derive\.fields must be a non-empty list of field names/,
    );
  });

  it("rejects a repeated field", () => {
    expect(() => parse(["derive:", "  fields: [created, created]"])).toThrow(
      /derive\.fields lists "created" twice/,
    );
  });

  it("rejects a field that is not derivable, naming the derivable ones", () => {
    expect(() => parse(["derive:", "  fields: [created, title]"])).toThrow(
      /derive\.fields\[1\] "title" is not derivable\. Derivable fields: created, last-updated, authors, owner, reviewed-by, last-reviewed\./,
    );
  });

  it("rejects $schema as a managed field", () => {
    expect(() => parse(["derive:", "  fields: ['$schema']"])).toThrow(
      /derive\.fields\[0\] "\$schema" is not derivable/,
    );
  });

  it("rejects a field a sidecar entry owns, naming the manifest", () => {
    expect(() =>
      parse([
        "sidecars:",
        "  - file: ./a.yaml",
        "    keys: [jira]",
        "  - file: ./owners.yaml",
        "    keys: [owner]",
        "derive:",
        "  fields: [created, owner]",
      ]),
    ).toThrow(
      /derive\.fields\[1\] "owner" is owned by sidecars\[1\] \(\.\/owners\.yaml\)/,
    );
  });

  it("rejects a source that is not one of the four", () => {
    expect(() =>
      parse(["derive:", "  fields: [created]", "  sources: [git, svn]"]),
    ).toThrow(
      /derive\.sources\[1\] "svn" is not a source\. Sources: git, codeowners, github, gitlab./,
    );
  });

  it("rejects an empty sources list", () => {
    expect(() =>
      parse(["derive:", "  fields: [created]", "  sources: []"]),
    ).toThrow(/derive\.sources must be a non-empty list of source names/);
  });

  it("rejects a sources value that is not a list", () => {
    expect(() =>
      parse(["derive:", "  fields: [created]", "  sources: git"]),
    ).toThrow(/derive\.sources must be a non-empty list of source names/);
  });

  it("rejects a repeated source", () => {
    expect(() =>
      parse(["derive:", "  fields: [created]", "  sources: [git, git]"]),
    ).toThrow(/derive\.sources lists "git" twice/);
  });

  it("rejects an empty codeowners path", () => {
    expect(() =>
      parse(["derive:", "  fields: [created]", "  codeowners: ''"]),
    ).toThrow(/derive\.codeowners must be a non-empty path/);
    expect(() =>
      parse(["derive:", "  fields: [created]", "  codeowners: 3"]),
    ).toThrow(/derive\.codeowners must be a non-empty path/);
  });

  it("names the section when the config came from the family file", () => {
    expect(() =>
      parseConfigValue(
        { derive: { fields: ["title"] } },
        "manni.config.yaml",
        "meta",
      ),
    ).toThrow(/manni\.config\.yaml: meta\.derive\.fields\[0\] "title"/);
    expect(() =>
      parseConfigValue({ derive: "created" }, "manni.config.yaml", "meta"),
    ).toThrow(/manni\.config\.yaml: "meta\.derive" must be a mapping/);
  });
});

describe("derive: reserved collection names", () => {
  it.each(["derived", "Derived", "_derived_rows", "_DERIVED_ROWS"])(
    'rejects an override named "%s", which the derived table uses',
    (name) => {
      expect(() =>
        parse([
          "overrides:",
          `  - name: ${name}`,
          '    files: ["docs/**"]',
          "    schemas: [./s.json]",
        ]),
      ).toThrow(
        new RegExp(
          `overrides\\[0\\]\\.name "${name}" collides with the derived table`,
        ),
      );
    },
  );
});

describe("derive: reserved check name", () => {
  it('rejects a check named "derive" at parse time', () => {
    expect(() =>
      parse(["checks:", "  - name: derive", "    query: SELECT 1"]),
    ).toThrow(/checks\[0\]\.name "derive" is reserved/);
  });
});

describe("derive: field and source vocabularies", () => {
  it("lists the six derivable fields in order", () => {
    expect([...DERIVABLE_FIELDS]).toEqual([
      "created",
      "last-updated",
      "authors",
      "owner",
      "reviewed-by",
      "last-reviewed",
    ]);
    expect([...DERIVE_SOURCES]).toEqual(["git", "codeowners", "github", "gitlab"]);
  });

  it("guards a user-supplied name", () => {
    expect(isDerivableField("owner")).toBe(true);
    expect(isDerivableField("title")).toBe(false);
    expect(isDeriveSource("github")).toBe(true);
    expect(isDeriveSource("gitlab")).toBe(true);
    expect(isDeriveSource("svn")).toBe(false);
  });
});
