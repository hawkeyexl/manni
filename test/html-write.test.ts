/**
 * HTML write-back tests. `applyHtml` is pure — content in, content out — so
 * every case here passes fixture *text* and nothing on disk is mutated.
 *
 * The CRLF and BOM cases use inline strings rather than fixture files, for the
 * reason recorded in `frontmatter-write.test.ts`: git's `text=auto` normalizes a
 * committed CRLF file and can mangle a BOM, so a fixture would silently stop
 * testing what it claims.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { applyHtml } from "../src/meta/extractors/html-write.js";
import { htmlExtractor } from "../src/meta/extractors/html.js";
import { xmlParseError } from "../src/meta/extractors/xml-read.js";
import { DocmetaError } from "../src/meta/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string): string =>
  readFileSync(`${here}/fixtures/fill/${name}`, "utf8");

/** What the reader makes of a document — the only thing a write must agree with. */
const read = (s: string): Record<string, unknown> =>
  htmlExtractor.extract(s, "x.html").data;

describe("applyHtml — no-ops and refusals", () => {
  it("returns the input identically for an empty patch", () => {
    const content = fx("head-with-meta.html");
    expect(applyHtml(content, {})).toBe(content);
  });

  it("ignores keys explicitly set to undefined", () => {
    const content = fx("head-with-meta.html");
    expect(applyHtml(content, { type: undefined })).toBe(content);
  });

  it("refuses a document whose <head> is implied rather than present", () => {
    expect(() => applyHtml(fx("no-head.html"), { type: "concept" })).toThrow(
      DocmetaError,
    );
  });

  it("names the file in the refusal when the path is known", () => {
    expect(() =>
      applyHtml(fx("no-head.html"), { type: "concept" }, { filePath: "docs/frag.html" }),
    ).toThrow(
      "docs/frag.html has no <head> element; manni meta fill writes metadata into <head>. Add one, or set the field manually.",
    );
    expect(() => applyHtml(fx("no-head.html"), { type: "concept" })).toThrow(
      "This HTML document has no <head> element; manni meta fill writes metadata into <head>. Add one, or set the field manually.",
    );
  });

  it("refuses on an empty patch too, so fill's pre-flight probe is honest", () => {
    // fill.ts probes with {} before paying for inference; a false all-clear
    // there means the call is billed for a file that could never be written.
    expect(() => applyHtml(fx("no-head.html"), {})).toThrow(DocmetaError);
  });
});

describe("applyHtml — updating an existing value", () => {
  it("replaces a meta tag's content and leaves the rest byte-identical", () => {
    const content = fx("head-with-meta.html");
    const out = applyHtml(content, { type: "reference" });
    expect(read(out).type).toBe("reference");
    // Everything except the one value span is untouched.
    expect(out).toBe(content.replace('content="concept"', 'content="reference"'));
  });

  it("preserves single-quoted attribute style", () => {
    const src = "<html><head><meta name='type' content='concept'></head></html>";
    const out = applyHtml(src, { type: "reference" });
    expect(out).toContain("content='reference'");
    expect(read(out).type).toBe("reference");
  });

  it("quotes an unquoted attribute when the new value needs it", () => {
    // `content=hello world` would tokenize as content="hello" plus a boolean
    // `world` attribute, so replacing an unquoted value has to supply quotes.
    const src = "<html><head><meta name=type content=concept></head></html>";
    const out = applyHtml(src, { type: "hello world" });
    expect(read(out).type).toBe("hello world");
    expect(out).toContain('content="hello world"');
  });

  it("leaves a simple unquoted replacement readable", () => {
    const src = "<html><head><meta name=type content=concept></head></html>";
    expect(read(applyHtml(src, { type: "reference" })).type).toBe("reference");
  });

  it("writes title into the meta tag when one exists, not into <title>", () => {
    // The reader's precedence: a <meta name="title"> beats <title>, in either
    // order. Writing to <title> here would be silently ignored on read.
    const content = fx("title-and-meta.html");
    const out = applyHtml(content, { title: "Chosen" });
    expect(read(out).title).toBe("Chosen");
    expect(out).toContain("<title>From the title element</title>");
  });

  it("updates a tag keyed by property= as readily as name=", () => {
    // `readHtml` accepts either attribute for the key and records both the same
    // way in `sources`, so `metaEdit` treats them identically by construction.
    // This pins that, since OpenGraph-style tags are the reason `property` is
    // read at all and nothing else exercises the write path for them.
    const src =
      '<html><head><meta property="og:title" content="Old"></head></html>';
    const out = applyHtml(src, { "og:title": "New" });
    expect(read(out)["og:title"]).toBe("New");
    expect(out).toContain('property="og:title" content="New"');
  });

  it("falls back to the <title> text when the key has no meta tag", () => {
    const src = "<html><head><title>Old</title></head></html>";
    const out = applyHtml(src, { title: "New" });
    expect(out).toContain("<title>New</title>");
    expect(read(out).title).toBe("New");
  });
});

describe("applyHtml — inserting a new value", () => {
  it("escapes markup characters written into <title>", () => {
    const src = "<html><head><title>Old</title></head></html>";
    const out = applyHtml(src, { title: 'a & b < c > d' });
    expect(read(out).title).toBe("a & b < c > d");
    expect(out).toContain("<title>a &amp; b &lt; c &gt; d</title>");
  });

  it("inserts a meta tag after <head>, matching the existing indentation", () => {
    const content = fx("head-with-meta.html");
    const out = applyHtml(content, { audience: "developer" });
    expect(read(out).audience).toBe("developer");
    expect(out).toContain('    <meta name="audience" content="developer">');
    // The body is untouched.
    expect(out.slice(out.indexOf("<body>"))).toBe(
      content.slice(content.indexOf("<body>")),
    );
  });

  it("takes an empty head's line ending from above it, not from the body", () => {
    // No child inside <head> to copy the style from, so the fallback decides.
    // Scanning the whole document would let a CRLF body dictate the ending
    // used inside an LF head.
    const src =
      "<html>\n<head></head>\r\n<body>\r\n<p>x</p>\r\n</body>\r\n</html>";
    const out = applyHtml(src, { type: "concept" });
    expect(read(out).type).toBe("concept");
    const head = out.slice(0, out.indexOf("</head>"));
    expect(head).not.toContain("\r\n");
    expect(head).toContain('\n  <meta name="type" content="concept">');
  });

  it("escapes markup characters in a written value", () => {
    const src = '<html><head><meta name="type" content="a"></head></html>';
    const out = applyHtml(src, { type: 'x & y < z "q"' });
    expect(out).not.toContain('content="x & y < z "q""');
    expect(read(out).type).toBe('x & y < z "q"');
  });
});

describe("applyHtml — fidelity", () => {
  it("preserves CRLF throughout", () => {
    const src =
      '<html>\r\n<head>\r\n<meta name="type" content="concept">\r\n</head>\r\n</html>\r\n';
    const out = applyHtml(src, { audience: "developer" });
    expect(out.match(/(?<!\r)\n/g)).toBeNull();
    expect(read(out).audience).toBe("developer");
  });

  it("keeps exactly one BOM, still at offset 0", () => {
    const src =
      '\uFEFF<html><head><meta name="type" content="concept"></head></html>';
    const out = applyHtml(src, { audience: "developer" });
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.match(/\uFEFF/g)).toHaveLength(1);
    expect(read(out).audience).toBe("developer");
  });

  it("keeps an ambiguous scalar a string, because it emits YAML", () => {
    // Attribute values are read back as YAML scalars, so a bare 2 would return
    // as a number. Emitting YAML too means the quoting survives the round trip.
    const src = '<html><head><meta name="type" content="a"></head></html>';
    const out = applyHtml(src, { version: "2" });
    expect(read(out).version).toBe("2");
  });

  it("refuses a string that needs more than one line", () => {
    // Flow style puts a collection on one line, but a newline inside a string
    // survives into the output whatever the style. Refusing beats truncating.
    const src = '<html><head><meta name="type" content="a"></head></html>';
    expect(() => applyHtml(src, { summary: "one\ntwo" })).toThrow(
      'Refusing to write "summary": the value needs more than one line, which an HTML attribute cannot hold. Set it manually.',
    );
    expect(() => applyHtml(src, { graph: { label: "one\ntwo" } })).toThrow(
      "needs more than one line",
    );
  });
});

describe("applyHtml — collection values", () => {
  // `manni graph fill` writes a nested `graph:` block through this writer, so a
  // map or a list has to fit the one line a `content` attribute holds.
  const src = '<html><head><meta name="type" content="a"></head></html>';
  const graph = {
    label: "Install",
    "alt-labels": ["setup", "configure"],
    sections: { prereq: { label: "Prerequisites" } },
  };

  it("writes a nested map on one line, and reads it back", () => {
    const out = applyHtml(src, { graph });
    expect(read(out).graph).toEqual(graph);
    expect(out).toContain(
      '<meta name="graph" content="{ label: Install, alt-labels: [ setup, configure ], sections: { prereq: { label: Prerequisites } } }">',
    );
  });

  it("writes a list, and reads it back", () => {
    const out = applyHtml(src, { tags: ["a", "b"] });
    expect(read(out).tags).toEqual(["a", "b"]);
  });

  it("replaces an existing collection in place", () => {
    const out = applyHtml(applyHtml(src, { graph }), {
      graph: { ...graph, label: "Set up" },
    });
    expect(read(out).graph).toEqual({ ...graph, label: "Set up" });
    expect(out.match(/name="graph"/g)).toHaveLength(1);
  });

  it("escapes markup and quotes in nested strings", () => {
    const value = { label: 'Tom & "Jerry" <b>', alt: ["it's", "a > b"] };
    const out = applyHtml(src, { graph: value });
    expect(read(out).graph).toEqual(value);
    expect(out).toContain("Tom &amp; &quot;Jerry&quot; &lt;b&gt;");
  });

  it("writes a long string without folding it", () => {
    // The YAML stringifier folds at 80 columns by default, which made any long
    // value a "needs more than one line" refusal.
    const long = "word ".repeat(30).trim();
    expect(read(applyHtml(src, { description: long })).description).toBe(long);
    expect(read(applyHtml(src, { graph: { alt: [long] } })).graph).toEqual({
      alt: [long],
    });
  });

  it("emits a scalar exactly as before", () => {
    const scalars: unknown[] = [
      "plain", "2", "", "a: b", "#c", "true", "null", 42, 1.5, true, false,
      null, "2024-03-01", "2024-03-01T00:00:00Z",
    ];
    for (const value of scalars) {
      const out = applyHtml(src, { k: value });
      const before = stringifyYaml(value).replace(/\n$/, "");
      expect(out).toContain(`<meta name="k" content="${before.replace(/"/g, "&quot;")}">`);
    }
  });
});

describe("applyHtml — the write-to-source invariant", () => {
  // The one property that catches the whole failure class: whatever the writer
  // does, the reader must see the value afterwards. A write aimed at a tag the
  // reader ignores fails here and nowhere else.
  const cases: [string, string, string, unknown][] = [
    [
      "key already in a meta tag",
      '<html><head><meta name="k" content="old"></head></html>',
      "k",
      "new",
    ],
    [
      "key absent entirely",
      "<html><head><title>T</title></head></html>",
      "k",
      "fresh",
    ],
    [
      "title carried by a meta tag that outranks <title>",
      '<html><head><title>A</title><meta name="title" content="B"></head></html>',
      "title",
      "C",
    ],
    [
      "title carried only by <title>",
      "<html><head><title>A</title></head></html>",
      "title",
      "C",
    ],
    [
      "title carried by an empty <title>",
      "<html><head><title></title></head></html>",
      "title",
      "C",
    ],
  ];
  for (const [label, src, key, value] of cases) {
    it(`round-trips through the reader — ${label}`, () => {
      const out = applyHtml(src, { [key]: value });
      expect(read(out)[key]).toEqual(value);
    });
  }
});

describe("applyHtml — an XHTML page (0125)", () => {
  const flare = (name: string): string =>
    readFileSync(`${here}/fixtures/flare/meta/${name}`, "utf8");
  const FLARE_NS = "http://www.madcapsoftware.com/Schemas/MadCap.xsd";

  it("closes an inserted tag itself, and the page still parses as XML", () => {
    const content = flare("topic.htm");
    const out = applyHtml(content, { description: "Set the options." });
    expect(out).toContain(
      '        <meta name="description" content="Set the options." />\n',
    );
    expect(xmlParseError(out)).toBeUndefined();
    expect(read(out).description).toBe("Set the options.");
    // Only the one line is new.
    expect(out.replace(/ *<meta name="description"[^\n]*\n/, "")).toBe(content);
  });

  it("opens a self-closed <head /> around what it inserts", () => {
    const src =
      '<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head />\n<body><p>x</p></body>\n</html>\n';
    const out = applyHtml(src, { type: "concept" });
    expect(out).toBe(
      src.replace(
        "<head />",
        '<head>\n  <meta name="type" content="concept" />\n</head>',
      ),
    );
    expect(xmlParseError(out)).toBeUndefined();
    expect(read(out).type).toBe("concept");
  });

  it("indents an opened <head /> as the file indents it", () => {
    const src = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="${FLARE_NS}">\n    <head />\n    <body><p>x</p></body>\n</html>\n`;
    const out = applyHtml(src, { type: "concept" });
    expect(out).toBe(
      src.replace(
        "<head />",
        '<head>\n        <meta name="type" content="concept" />\n    </head>',
      ),
    );
    expect(xmlParseError(out)).toBeUndefined();
  });

  it("keeps the BOM, the XML declaration and CRLF byte for byte", () => {
    const decl = '﻿<?xml version="1.0" encoding="utf-8"?>\r\n';
    const src =
      decl +
      `<html xmlns:MadCap="${FLARE_NS}">\r\n  <head>\r\n    <title></title>\r\n  </head>\r\n  <body><h1>T</h1></body>\r\n</html>\r\n`;
    const out = applyHtml(src, { type: "concept" });
    expect(out.startsWith(decl)).toBe(true);
    expect(out.match(/﻿/g)).toHaveLength(1);
    expect(out.match(/(?<!\r)\n/g)).toBeNull();
    expect(out).toContain('\r\n    <meta name="type" content="concept" />\r\n');
    expect(xmlParseError(out.slice(1))).toBeUndefined();
  });

  it("fills a Flare topic's empty <title>, which reads as its heading", () => {
    const content = flare("topic.htm");
    expect(read(content).title).toBe("Configuring the widget");
    const out = applyHtml(
      content,
      { title: "Configure the widget" },
      { filePath: "Configure.htm" },
    );
    expect(out).toBe(
      content.replace("<title></title>", "<title>Configure the widget</title>"),
    );
    expect(read(out).title).toBe("Configure the widget");
    expect(xmlParseError(out)).toBeUndefined();
  });

  it("adds a <title> to a Flare topic that has none, which read as its heading", () => {
    const src = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="${FLARE_NS}">\n    <head>\n        <link href="a.css" rel="stylesheet" />\n    </head>\n    <body>\n        <h1>Configuring</h1>\n    </body>\n</html>\n`;
    expect(read(src).title).toBe("Configuring");
    const out = applyHtml(src, { title: "Tools & tips" }, { filePath: "Configure.htm" });
    expect(out).toBe(
      src.replace("<head>\n", "<head>\n        <title>Tools &amp; tips</title>\n"),
    );
    expect(read(out)).toMatchObject({ title: "Tools & tips", "head.title": "Tools & tips" });
    expect(xmlParseError(out)).toBeUndefined();
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ])("gives a snippet with no <head> one just inside <html> (%s)", (_, eol) => {
    const lines = [
      '<?xml version="1.0" encoding="utf-8"?>',
      `<html xmlns:MadCap="${FLARE_NS}">`,
      "    <body>",
      "        <h2>Before you start</h2>",
      "    </body>",
      "</html>",
      "",
    ];
    const src = lines.join(eol);
    const out = applyHtml(src, { description: "x" }, { filePath: "Snippets/Before.flsnp" });
    const head = [
      "    <head>",
      '        <meta name="description" content="x" />',
      "    </head>",
    ];
    expect(out).toBe([...lines.slice(0, 2), ...head, ...lines.slice(2)].join(eol));
    expect(xmlParseError(out)).toBeUndefined();
    expect(read(out)).toMatchObject({ description: "x", title: "Before you start" });
  });

  it("still refuses a page whose <head> parse5 could not locate", () => {
    // A stray <meta> before <head> makes parse5 imply a head and drop the real
    // one, so there is nowhere a splice can land.
    const src = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="${FLARE_NS}">\n<meta name="a" content="b" />\n<head>\n<title>T</title>\n</head>\n<body><p>x</p></body>\n</html>\n`;
    expect(() => applyHtml(src, { description: "x" }, { filePath: "Topics/Stray.htm" })).toThrow(
      "Topics/Stray.htm has no <head> element; manni meta fill writes metadata into <head>. Add one, or set the field manually.",
    );
  });

  it("refuses a write whose result would not be well-formed XML", () => {
    // parse5 reads <title> as RCDATA, so it ends at the first "</title>" even
    // inside a CDATA section an XML parser honours. Replacing that span leaves
    // the CDATA's tail and a stray end tag behind.
    const src =
      '<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title><![CDATA[a</title>b]]></title></head><body></body></html>\n';
    expect(xmlParseError(src)).toBeUndefined();
    expect(() =>
      applyHtml(src, { title: "New" }, { filePath: "docs/a.htm" }),
    ).toThrow(
      /^Refusing to write "title": the result would not be well-formed XML \(.+\)\. docs\/a\.htm is unchanged\.$/,
    );
    expect(() => applyHtml(src, { title: "New" })).toThrow(
      /\. the page is unchanged\.$/,
    );
  });

  it("does not hold a page that was already malformed XML to the check", () => {
    const src =
      '<?xml version="1.0"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>a</title></head><body><br></body></html>\n';
    expect(xmlParseError(src)).toBeDefined();
    const out = applyHtml(src, { type: "concept" });
    expect(read(out).type).toBe("concept");
  });

  describe("keywords read from index markers", () => {
    const page = (head: string): string =>
      `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="${FLARE_NS}">\n<head>\n<title>T</title>${head}\n</head>\n<body><p>Install <MadCap:keyword term="install;setup" /> it.</p><MadCap:concept term="Setup" /></body>\n</html>\n`;

    it("refuses a write to them, naming the file or the page", () => {
      const src = page("");
      expect(read(src).keywords).toEqual(["install", "setup", "Setup"]);
      for (const [filePath, file] of [
        ["Content/Topics/Install.htm", "Content/Topics/Install.htm"],
        [undefined, "the page"],
      ] as const) {
        let error: unknown;
        try {
          applyHtml(src, { keywords: ["x"] }, filePath === undefined ? {} : { filePath });
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(DocmetaError);
        expect((error as DocmetaError).message).toBe(
          `Refusing to write "keywords": ${file} reads them from its MadCap:keyword and MadCap:concept markers. Edit the markers in Flare.`,
        );
      }
    });

    it("writes another key and leaves the markers alone", () => {
      const src = page("");
      const out = applyHtml(src, { type: "concept" }, { filePath: "a.htm" });
      expect(out).toBe(src.replace("<head>", '<head>\n<meta name="type" content="concept" />'));
      expect(read(out)).toMatchObject({ type: "concept", keywords: ["install", "setup", "Setup"] });
    });

    it("writes keywords a meta tag holds, as on any page", () => {
      const src = page('\n<meta name="keywords" content="old" />');
      const out = applyHtml(src, { keywords: "new" }, { filePath: "a.htm" });
      expect(out).toBe(src.replace('content="old"', 'content="new"'));
      expect(read(out).keywords).toBe("new");
    });
  });

  describe("concepts read from glossary term markers", () => {
    const src = `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns:MadCap="${FLARE_NS}">\n<head>\n<title>T</title>\n</head>\n<body><p>Build the <MadCap:glossaryTerm glossTerm="Glossary.Term15">batch target</MadCap:glossaryTerm>.</p></body>\n</html>\n`;

    it("refuses a write to them, naming the file or the page", () => {
      expect(read(src).concepts).toEqual(["Glossary.Term15"]);
      for (const [filePath, file] of [
        ["Content/Topics/Build.htm", "Content/Topics/Build.htm"],
        [undefined, "the page"],
      ] as const) {
        let error: unknown;
        try {
          applyHtml(src, { concepts: ["x"] }, filePath === undefined ? {} : { filePath });
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(DocmetaError);
        expect((error as DocmetaError).message).toBe(
          `Refusing to write "concepts": ${file} reads them from its MadCap:glossaryTerm markers. Edit the markers in Flare.`,
        );
      }
    });

    it("writes another key and leaves the markers alone", () => {
      const out = applyHtml(src, { type: "concept" }, { filePath: "a.htm" });
      expect(out).toBe(src.replace("<head>", '<head>\n<meta name="type" content="concept" />'));
      expect(read(out)).toMatchObject({ type: "concept", concepts: ["Glossary.Term15"] });
    });
  });

  it("writes a plain HTML page exactly as before", () => {
    const content = fx("head-with-meta.html");
    const out = applyHtml(content, { audience: "developer" });
    expect(out).toBe(
      content.replace(
        "  <head>\n",
        '  <head>\n    <meta name="audience" content="developer">\n',
      ),
    );
  });
});

describe("xmlParseError", () => {
  it("names the first error, and passes an undeclared entity", () => {
    expect(xmlParseError("<a><b></a>")).toMatch(/mismatch/);
    expect(xmlParseError("<a>&nbsp;</a>")).toBeUndefined();
    expect(xmlParseError("")).toBeDefined();
  });
});
