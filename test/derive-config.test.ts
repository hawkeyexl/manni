import { describe, it, expect } from "vitest";
import { parseConfig, parseConfigValue } from "../src/meta/core/config.js";
import {
  DERIVABLE_FIELDS,
  DERIVE_SOURCES,
  isBuiltinField,
  isDerivableField,
  isDeriveSource,
} from "../src/meta/core/derive/types.js";

const parse = (lines: string[]) =>
  parseConfig(lines.join("\n"), "manni.config.yaml");

describe("derive: config parsing", () => {
  it("parses the full shape", () => {
    const cfg = parse([
      "derive:",
      "  fields: [created, last-updated, authors, owner, verified-against]",
      "  sources: [git, codeowners, github, gitlab, command]",
      "  codeowners: .github/CODEOWNERS",
      "  commands:",
      "    verified-against:",
      "      run: [node, scripts/verified-against.mjs]",
      "      timeout: 5",
    ]);
    expect(cfg.derive).toEqual({
      fields: ["created", "last-updated", "authors", "owner", "verified-against"],
      sources: ["git", "codeowners", "github", "gitlab", "command"],
      codeowners: ".github/CODEOWNERS",
      commands: {
        "verified-against": { run: ["node", "scripts/verified-against.mjs"], timeout: 5 },
      },
    });
  });

  it("leaves commands absent when not written, and timeout absent inside a command", () => {
    const cfg = parse([
      "derive:",
      "  commands:",
      "    verified-against:",
      "      run: [./bin/version]",
    ]);
    expect(cfg.derive).toEqual({
      fields: [],
      commands: { "verified-against": { run: ["./bin/version"] } },
    });
    expect(cfg.derive?.commands?.["verified-against"]).not.toHaveProperty("timeout");
    expect(parse(["derive:", "  fields: [created]"]).derive).not.toHaveProperty("commands");
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
      /"derive" has unknown key "field"\. Supported keys: fields, sources, codeowners, commands/,
    );
  });

  it("refuses a derive: that sets nothing, naming commands: among the ways to set something", () => {
    expect(() => parse(["derive: {}"])).toThrow(
      /"derive" sets nothing\. Give it `fields:` to manage, `commands:` to derive from a command, or `sources:` or `codeowners:` to shape the reads\./,
    );
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

  it("rejects a field that is not derivable, naming the derivable ones and the commands way in", () => {
    expect(() => parse(["derive:", "  fields: [created, title]"])).toThrow(
      /derive\.fields\[1\] "title" is not derivable\. Derivable fields: created, last-updated, authors, owner, reviewed-by, last-reviewed, or any key with an entry in derive\.commands\./,
    );
  });

  it("accepts a field a command derives, and refuses the same name without the command", () => {
    const cfg = parse([
      "derive:",
      "  fields: [verified-against]",
      "  commands:",
      "    verified-against:",
      "      run: [./bin/version]",
    ]);
    expect(cfg.derive?.fields).toEqual(["verified-against"]);
    expect(() => parse(["derive:", "  fields: [verified-against]"])).toThrow(
      /derive\.fields\[0\] "verified-against" is not derivable\. Derivable fields: created, last-updated, authors, owner, reviewed-by, last-reviewed, or any key with an entry in derive\.commands\./,
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

  it("rejects a source that is not one of the five", () => {
    expect(() =>
      parse(["derive:", "  fields: [created]", "  sources: [git, svn]"]),
    ).toThrow(
      /derive\.sources\[1\] "svn" is not a source\. Sources: git, codeowners, github, gitlab, command\./,
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

describe("derive: commands", () => {
  const command = (...body: string[]) => [
    "derive:",
    "  commands:",
    ...body,
  ];

  it("rejects a commands value that is not a mapping", () => {
    expect(() => parse(command("    - verified-against"))).toThrow(
      /derive\.commands must be a mapping of field name to command/,
    );
    expect(() => parse(["derive:", "  commands: verified-against"])).toThrow(
      /derive\.commands must be a mapping of field name to command/,
    );
  });

  it("rejects an empty field name", () => {
    expect(() => parse(command('    " ":', "      run: [./bin/version]"))).toThrow(
      /derive\.commands has an empty field name/,
    );
  });

  it("rejects $schema as a command-derived field", () => {
    expect(() => parse(command('    "$schema":', "      run: [./bin/schema]"))).toThrow(
      /derive\.commands may not derive "\$schema"/,
    );
  });

  it.each([
    ["created", "git"],
    ["last-updated", "git"],
    ["authors", "git"],
    ["owner", "codeowners"],
    ["reviewed-by", "GitHub or GitLab"],
    ["last-reviewed", "GitHub or GitLab"],
  ])('rejects a command targeting built-in "%s", naming %s as its source', (field, from) => {
    expect(() => parse(command(`    ${field}:`, "      run: [./bin/x]"))).toThrow(
      new RegExp(
        `derive\\.commands\\.${field} targets a field ${from} already derives; a command may only derive a field no built-in source claims`,
      ),
    );
  });

  it("rejects a command targeting a key a sidecar owns, naming the manifest", () => {
    expect(() =>
      parse([
        "sidecars:",
        "  - file: ./a.yaml",
        "    keys: [jira]",
        "  - file: ./versions.yaml",
        "    keys: [verified-against]",
        "derive:",
        "  commands:",
        "    verified-against:",
        "      run: [./bin/version]",
      ]),
    ).toThrow(
      /derive\.commands\.verified-against is owned by sidecars\[1\] \(\.\/versions\.yaml\) — a managed field has one authority, and a sidecar key already has one\./,
    );
  });

  it("rejects a command that is not a mapping", () => {
    expect(() => parse(command("    verified-against: ./bin/version"))).toThrow(
      /derive\.commands\.verified-against must be a mapping/,
    );
    expect(() => parse(command("    verified-against: [./bin/version]"))).toThrow(
      /derive\.commands\.verified-against must be a mapping/,
    );
  });

  it("rejects an unknown key inside a command", () => {
    expect(() =>
      parse(command("    verified-against:", "      run: [./bin/version]", "      cwd: .")),
    ).toThrow(
      /derive\.commands\.verified-against has unknown key "cwd"\. Supported keys: run, timeout\./,
    );
  });

  it("rejects a missing, empty or non-list run", () => {
    const tail =
      /derive\.commands\.verified-against\.run must be a non-empty list of strings, the program first/;
    expect(() => parse(command("    verified-against: {}"))).toThrow(tail);
    expect(() => parse(command("    verified-against:", "      run: []"))).toThrow(tail);
    expect(() =>
      parse(command("    verified-against:", "      run: ./bin/version")),
    ).toThrow(tail);
  });

  it("rejects a blank or non-string run element, by index", () => {
    expect(() =>
      parse(command("    verified-against:", "      run: [./bin/version, '']")),
    ).toThrow(/derive\.commands\.verified-against\.run\[1\] must be a non-empty string/);
    expect(() =>
      parse(command("    verified-against:", "      run: [./bin/version, 3]")),
    ).toThrow(/derive\.commands\.verified-against\.run\[1\] must be a non-empty string/);
  });

  it.each(["0", "-1", "abc", "'5'", ".inf", ".nan", "0.5", "0.001"])(
    "rejects timeout %s",
    (timeout) => {
      expect(() =>
        parse(
          command("    verified-against:", "      run: [./bin/version]", `      timeout: ${timeout}`),
        ),
      ).toThrow(
        /derive\.commands\.verified-against\.timeout must be a whole number of seconds, greater than zero/,
      );
    },
  );

  it("accepts a whole number of seconds", () => {
    // Fractions are refused because they read as a budget and act as a kill
    // switch: `timeout: 0.001` allows one millisecond, so nothing ever
    // answers. The reference has always said seconds, as an integer.
    const cfg = parse(
      command("    verified-against:", "      run: [./bin/version]", "      timeout: 30"),
    );
    expect(cfg.derive?.commands?.["verified-against"]?.timeout).toBe(30);
  });

  it("names the section when the config came from the family file", () => {
    expect(() =>
      parseConfigValue(
        { derive: { commands: { created: { run: ["x"] } } } },
        "manni.config.yaml",
        "meta",
      ),
    ).toThrow(/manni\.config\.yaml: meta\.derive\.commands\.created targets a field git already derives/);
  });

  it.each(["_path", "_sources"])(
    'refuses a command named "%s", a column of the derived table',
    (name) => {
      // Every command key is a column beside `_path` and `_sources`, so one
      // spelled like either declares the column twice and SQLite refuses the
      // table with a raw error in the middle of a query.
      expect(() =>
        parse([
          "derive:",
          "  commands:",
          `    ${name}:`,
          '      run: ["node", "-p", "1"]',
        ]),
      ).toThrow(
        new RegExp(
          `derive\\.commands\\.${name} collides with a column of the derived table`,
        ),
      );
    },
  );
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
    expect([...DERIVE_SOURCES]).toEqual(["git", "codeowners", "github", "gitlab", "command"]);
  });

  it("guards a user-supplied name", () => {
    expect(isBuiltinField("owner")).toBe(true);
    expect(isBuiltinField("verified-against")).toBe(false);
    expect(isBuiltinField("title")).toBe(false);
    // The old name stays as an alias for the same guard.
    expect(isDerivableField).toBe(isBuiltinField);
    expect(isDerivableField("owner")).toBe(true);
    expect(isDerivableField("title")).toBe(false);
    expect(isDeriveSource("command")).toBe(true);
    expect(isDeriveSource("github")).toBe(true);
    expect(isDeriveSource("gitlab")).toBe(true);
    expect(isDeriveSource("svn")).toBe(false);
  });
});
