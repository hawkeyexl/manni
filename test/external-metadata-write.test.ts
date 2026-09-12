/**
 * The manifest splice writer: rewrite one owned value for one document entry
 * of an external-metadata manifest, and change no other byte.
 *
 * It is text in, text out. The rules under test:
 *
 *  - A present value is replaced in place, as block YAML at the key's
 *    indentation. Comments inside the old value go with it; a comment on the
 *    key's own line stays.
 *  - An absent key is added under its entry, after the entry's last line.
 *  - An absent entry is appended after the last one, keyed by path or by the
 *    join value, spaced the way the other entries are.
 *  - Comments, key order, quoting, blank lines and line endings everywhere
 *    else survive byte for byte.
 *  - The result is read back, and a value that does not survive the trip is a
 *    refusal, never a changed manifest.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { spliceManifestValue } from "../src/meta/core/external-metadata-write.js";
import { DocmetaError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "fixtures", "external-metadata-write");
// Normalized to LF, so a checkout that converts line endings cannot change
// what the CRLF test starts from.
const read = (name: string): string =>
  readFileSync(resolve(fixtures, name), "utf8").replace(/\r\n/g, "\n");
const golden = read("golden.yaml");

const LIMITS = [
  {
    id: "fetch-timeout",
    claim: { lines: 4, integrity: "sha256-abc" },
    source: { file: "lib/limits.ts", lines: 2 },
  },
  { id: "retries", claim: { lines: 9 } },
];

describe("spliceManifestValue: replacing a value", () => {
  it("rewrites one list and leaves every other byte alone (golden)", () => {
    const out = spliceManifestValue(golden, {
      entry: "docs/limits.md",
      key: "citations",
      value: LIMITS,
    });
    expect(out.text).toBe(read("golden.replaced.yaml"));
    // The first item's line: the value starts under the key.
    expect(out.line).toBe(13);
  });

  it("replaces a flow-style value with a block one", () => {
    const out = spliceManifestValue(golden, {
      entry: "docs/zeta.md",
      key: "citations",
      value: [{ id: "z", source: { file: "lib/z2.ts" } }],
    });
    expect(out.text).toBe(
      golden.replace(
        "  citations: [ { id: z, source: { file: lib/z.ts } } ]",
        "  citations:\n    - id: z\n      source:\n        file: lib/z2.ts",
      ),
    );
    expect(out.line).toBe(24);
  });

  it("replaces a scalar in place, keeping the comment after it", () => {
    const out = spliceManifestValue(golden, {
      entry: "docs/quoted.md",
      key: "jira",
      value: "PLAT-33",
    });
    expect(out.text).toBe(
      golden.replace("  jira: PLAT-3  # no citations yet", "  jira: PLAT-33  # no citations yet"),
    );
    expect(out.line).toBe(20);
  });

  it("replaces a value inside a flow-mapping entry in flow style", () => {
    const out = spliceManifestValue("docs/a.md: { jira: A, owner: x }\n", {
      entry: "docs/a.md",
      key: "jira",
      value: ["B", "C"],
    });
    expect(out.text).toBe("docs/a.md: { jira: [ B, C ], owner: x }\n");
    expect(out.line).toBe(1);
  });

  it("preserves CRLF line endings, and adds no bare LF", () => {
    const crlf = golden.replace(/\n/g, "\r\n");
    const out = spliceManifestValue(crlf, {
      entry: "docs/limits.md",
      key: "citations",
      value: LIMITS,
    });
    expect(out.text).toBe(read("golden.replaced.yaml").replace(/\n/g, "\r\n"));
    expect(/(?<!\r)\n/.test(out.text)).toBe(false);
    expect(out.line).toBe(13);
  });
});

describe("spliceManifestValue: an absent key or entry", () => {
  it("inserts a key under an entry keyed by a quoted path, keeping the quotes", () => {
    const out = spliceManifestValue(golden, {
      entry: "docs/quoted.md",
      key: "citations",
      value: [{ id: "new" }],
    });
    expect(out.text).toBe(
      golden.replace(
        "  jira: PLAT-3  # no citations yet\n",
        "  jira: PLAT-3  # no citations yet\n  citations:\n    - id: new\n",
      ),
    );
    expect(out.text).toContain('"docs/quoted.md":\n');
    expect(out.line).toBe(22);
  });

  it("matches a path entry however it is spelled", () => {
    const out = spliceManifestValue(golden, {
      entry: "./docs/quoted.md",
      key: "jira",
      value: "PLAT-33",
    });
    expect(parse(out.text)).toMatchObject({ "docs/quoted.md": { jira: "PLAT-33" } });
    expect(Object.keys(parse(out.text) as object)).not.toContain("./docs/quoted.md");
  });

  it("appends an entry after the last one, spaced like the others", () => {
    const out = spliceManifestValue(golden, {
      entry: "docs/new.md",
      key: "citations",
      value: [{ id: "n" }],
    });
    expect(out.text).toBe(`${golden}\ndocs/new.md:\n  citations:\n    - id: n\n`);
    expect(out.line).toBe(27);
  });

  it("appends an entry keyed by the join value when the manifest joins on a field", () => {
    const out = spliceManifestValue("guide-1:\n  jira: PLAT-1\n", {
      entry: "guide-2",
      key: "citations",
      value: [{ id: "a" }],
      join: "id",
    });
    expect(out.text).toBe(
      "guide-1:\n  jira: PLAT-1\nguide-2:\n  citations:\n    - id: a\n",
    );
  });

  it("does not normalize a join value as a path", () => {
    const out = spliceManifestValue("./guide-1:\n  jira: PLAT-1\n", {
      entry: "guide-1",
      key: "jira",
      value: "PLAT-2",
      join: "id",
    });
    expect(parse(out.text)).toEqual({
      "./guide-1": { jira: "PLAT-1" },
      "guide-1": { jira: "PLAT-2" },
    });
  });

  it("starts an empty manifest", () => {
    const out = spliceManifestValue("", {
      entry: "docs/a.md",
      key: "citations",
      value: [{ id: "a" }],
    });
    expect(out.text).toBe("docs/a.md:\n  citations:\n    - id: a\n");
    expect(out.line).toBe(3);
  });

  it("fills an empty flow-mapping entry in block style", () => {
    const out = spliceManifestValue("# head\ndocs/a.md: {}\n", {
      entry: "docs/a.md",
      key: "citations",
      value: [{ id: "a" }],
    });
    expect(out.text).toBe("# head\ndocs/a.md:\n  citations:\n    - id: a\n");
  });
});

describe("spliceManifestValue: refusals", () => {
  const splice = (text: string, over: Partial<Parameters<typeof spliceManifestValue>[1]> = {}) =>
    () =>
      spliceManifestValue(text, {
        entry: "docs/a.md",
        key: "citations",
        value: [{ id: "a" }],
        file: "cites.yaml",
        ...over,
      });

  it("refuses a value that does not read back as written, and names why", () => {
    const run = () =>
      spliceManifestValue(golden, {
        entry: "docs/limits.md",
        key: "citations",
        // A Date is written as a timestamp string and reads back as a string.
        value: [{ id: "a", at: new Date(0) }],
        file: "cites.yaml",
      });
    expect(run).toThrow(DocmetaError);
    expect(run).toThrow(
      /^Manifest cites\.yaml: writing "citations" for "docs\/limits\.md" did not read back as written/,
    );
  });

  it("refuses a manifest that is not valid YAML", () => {
    expect(splice("docs/a.md: [\n")).toThrow(/^Manifest cites\.yaml is not valid YAML/);
  });

  it("refuses a manifest whose top level is not a mapping", () => {
    expect(splice("- docs/a.md\n")).toThrow(/must be a mapping from document path/);
  });

  it("refuses an entry named twice, however it is spelled", () => {
    expect(splice("docs/a.md:\n  jira: A\n./docs/a.md:\n  jira: B\n")).toThrow(
      /^Manifest cites\.yaml:3: "\.\/docs\/a\.md" is named twice \(first at line 1\)/,
    );
  });

  it("refuses an entry that is not a mapping", () => {
    expect(splice("docs/a.md: PLAT-1\n")).toThrow(
      /^Manifest cites\.yaml:1: "docs\/a\.md" must be a mapping of owned keys to values/,
    );
  });

  it("refuses a key set twice in the entry", () => {
    expect(splice("docs/a.md:\n  citations: []\n  citations: []\n")).toThrow(
      /^Manifest cites\.yaml:3: "docs\/a\.md" sets "citations" twice \(first at line 2\)/,
    );
  });

  it("refuses to add a key to a flow mapping that has members", () => {
    expect(splice("docs/a.md: { jira: A }\n")).toThrow(
      /^Manifest cites\.yaml:1: "docs\/a\.md" is a flow mapping/,
    );
  });

  it("refuses to add an entry to a flow-mapping manifest that has members", () => {
    expect(splice('{ "docs/b.md": { jira: A } }\n')).toThrow(
      /^Manifest cites\.yaml: the manifest is a flow mapping/,
    );
  });

  it("refuses $schema, which a manifest never sets", () => {
    expect(splice("docs/a.md:\n  jira: A\n", { key: "$schema", value: "x" })).toThrow(
      /never chooses the schema/,
    );
  });

  it("refuses an undefined value", () => {
    expect(splice("docs/a.md:\n  jira: A\n", { value: undefined })).toThrow(/no value/);
  });
});
