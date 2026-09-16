/**
 * The localization manifest contract (ADR 01038).
 *
 * `parseLocalizations` is the boundary between a file anyone can edit and code
 * that reaches straight for `entry.search.path`, so the ladder is both halves:
 * what it accepts, and every shape it must refuse rather than hand on.
 */
import { describe, expect, it } from "vitest";
import {
  emitLocalizations,
  isLanguageTag,
  parseLocalizations,
  searchIndexFilename,
  vectorIndexFilename,
  type LocalizationsDoc,
} from "../../../src/kg/core/localizations.js";

const entry = (language: string) => ({
  language,
  documents: 1,
  search: { path: `search.${language}.json`, entries: 2, digest: "sha256:ab" },
});

describe("emitLocalizations", () => {
  it("sorts by language and ends with a newline", () => {
    const out = emitLocalizations({
      version: 1,
      languages: [entry("und"), entry("de"), entry("de-AT")],
    });
    const parsed = JSON.parse(out) as LocalizationsDoc;
    expect(parsed.languages.map((l) => l.language)).toEqual([
      "de",
      "de-AT",
      "und",
    ]);
    expect(out.endsWith("}\n")).toBe(true);
  });

  it("is byte-stable for the same input in a different order", () => {
    const a = emitLocalizations({
      version: 1,
      languages: [entry("de"), entry("fr")],
    });
    const b = emitLocalizations({
      version: 1,
      languages: [entry("fr"), entry("de")],
    });
    expect(a).toBe(b);
  });
});

describe("parseLocalizations", () => {
  it("round-trips what emitLocalizations wrote", () => {
    const doc: LocalizationsDoc = { version: 1, languages: [entry("de")] };
    expect(parseLocalizations(emitLocalizations(doc))).toEqual(doc);
  });

  const rejected: Array<[string, string]> = [
    ["not JSON at all", "{oops"],
    ["a JSON scalar", '"nope"'],
    ["null", "null"],
    ["a future version", '{"version":2,"languages":[]}'],
    ["a missing languages array", '{"version":1}'],
    ["languages as an object", '{"version":1,"languages":{}}'],
    // The shape that crashed the CLI before the review fix: the envelope is
    // fine, so callers dereferenced `entry.search.path` on undefined and got a
    // raw TypeError with exit 1 instead of an operational error with exit 2.
    [
      "an entry with no search block",
      '{"version":1,"languages":[{"language":"de","documents":1}]}',
    ],
    [
      "an entry whose search.path is not a string",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":7,"entries":1,"digest":"x"}}]}',
    ],
    [
      "an entry with no language",
      '{"version":1,"languages":[{"documents":1,"search":{"path":"a","entries":1,"digest":"x"}}]}',
    ],
    [
      "a vectors block whose path is not a string",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"a","entries":1,"digest":"x"},"vectors":{"path":null}}]}',
    ],
    ["a null entry", '{"version":1,"languages":[null]}'],
    // The read side of the filename hole `export` closes on the write side: a
    // manifest path is joined onto a directory and opened, so it is checked
    // like any other untrusted path segment.
    [
      "a language that is not a tag",
      '{"version":1,"languages":[{"language":"../escaped","documents":1,"search":{"path":"search.json","entries":1,"digest":"x"}}]}',
    ],
    [
      "a search path that escapes the index directory",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"a/../../etc/passwd","entries":1,"digest":"x"}}]}',
    ],
    [
      "a search path that is absolute",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"/etc/passwd","entries":1,"digest":"x"}}]}',
    ],
    [
      "a search path naming another language's file",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"search.fr.json","entries":1,"digest":"x"}}]}',
    ],
    [
      "a search block with no entries count",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"search.de.json","digest":"x"}}]}',
    ],
    [
      "a vectors block missing its model",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"search.de.json","entries":1,"digest":"x"},"vectors":{"path":"vectors.de.bin","dtype":"q8","dims":8,"count":1}}]}',
    ],
    [
      "a vectors path that escapes",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"search.de.json","entries":1,"digest":"x"},"vectors":{"path":"a/../../x.bin","model":"m","dtype":"q8","dims":8,"count":1}}]}',
    ],
    // However far a path climbs, the filename is the bound: it can only ever
    // name this language's own artifact. (A climb on its own is legal —
    // `embed -o` records one — and has its own accepting cases below.)
    [
      "a vectors path climbing to something that is not this sidecar",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"search.de.json","entries":1,"digest":"x"},"vectors":{"path":"../../../../../../etc/passwd","model":"m","dtype":"q8","dims":8,"count":1}}]}',
    ],
    [
      "a search path climbing to something that is not this index",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"../../../../etc/passwd","entries":1,"digest":"x"}}]}',
    ],
    // `vectors.path` gets the same filename constraint `search.path` does, so
    // a sidecar cannot be pointed at some other file in a reachable directory.
    [
      "a vectors path naming another language's sidecar",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"search.de.json","entries":1,"digest":"x"},"vectors":{"path":"vectors.fr.bin","model":"m","dtype":"q8","dims":8,"count":1}}]}',
    ],
    [
      "a vectors path naming an arbitrary file next door",
      '{"version":1,"languages":[{"language":"de","documents":1,"search":{"path":"search.de.json","entries":1,"digest":"x"},"vectors":{"path":"../secrets.env","model":"m","dtype":"q8","dims":8,"count":1}}]}',
    ],
  ];

  for (const [name, text] of rejected) {
    it(`refuses ${name}`, () => {
      expect(parseLocalizations(text)).toBeUndefined();
    });
  }

  it("accepts a sidecar written outside the index directory", () => {
    // `embed -o` records a manifest-relative path, so a leading `../` is a
    // real layout rather than an escape — each segment is checked instead.
    const doc = parseLocalizations(
      JSON.stringify({
        version: 1,
        languages: [
          {
            ...entry("de"),
            vectors: {
              path: "../vecs/vectors.de.bin",
              model: "m",
              dtype: "q8",
              dims: 8,
              count: 1,
            },
          },
        ],
      }),
    );
    expect(doc?.languages[0]?.vectors?.path).toBe("../vecs/vectors.de.bin");
  });

  it("accepts an entry with no vectors block, which just means unembedded", () => {
    const doc = parseLocalizations(
      emitLocalizations({ version: 1, languages: [entry("de")] }),
    );
    expect(doc?.languages[0]?.vectors).toBeUndefined();
  });
});

describe("isLanguageTag", () => {
  it.each(["de", "en", "de-DE", "pt-BR", "zh-Hans", "zh-Hans-CN", "und"])(
    "accepts %s",
    (tag) => { expect(isLanguageTag(tag)).toBe(true); },
  );

  // Each of these would otherwise become a filename segment.
  it.each(["English", "de_DE", "d", "de-", "../escaped", "a/b", ".", ""])(
    "rejects %s",
    (tag) => { expect(isLanguageTag(tag)).toBe(false); },
  );
});

describe("artifact filenames", () => {
  it("names one file per language, per kind", () => {
    expect(searchIndexFilename("de-AT")).toBe("search.de-AT.json");
    expect(vectorIndexFilename("und")).toBe("vectors.und.bin");
  });
});

describe("manifest paths — what embed -o can legitimately record", () => {
  const withVectors = (path: string) =>
    JSON.stringify({
      version: 1,
      languages: [
        {
          ...entry("de"),
          vectors: { path, model: "m", dtype: "q8", dims: 8, count: 1 },
        },
      ],
    });

  // `embed -o` records a manifest-relative path, and a deploy directory can sit
  // any number of levels from the index directory. Capping the climb rejected
  // manifests dockg itself had just written.
  it.each([
    "vectors.de.bin",
    "../vecs/vectors.de.bin",
    "../../deploy/vecs/vectors.de.bin",
    "../../../../a/b/c/vectors.de.bin",
  ])("accepts %s, which embed -o can produce", (path) => {
    expect(
      parseLocalizations(withVectors(path))?.languages[0]?.vectors?.path,
    ).toBe(path);
  });

  // The filename is the bound that matters: however far up a path climbs, it
  // can only ever name this language's own artifact.
  it.each([
    "../../../../etc/passwd",
    "../../secrets.env",
    "a/../../vectors.de.bin",
    "vectors.fr.bin",
  ])("still refuses %s", (path) => {
    expect(parseLocalizations(withVectors(path))).toBeUndefined();
  });
});
