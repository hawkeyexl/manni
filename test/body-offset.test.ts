/**
 * `bodyOffset` (proposal 0125, decision 21): where an HTML or XML page's
 * metadata ends, so `manni docevals` can hand a grader the source from there
 * to the end and its line numbers stay the file's. Inline strings throughout,
 * for the BOM and the exact offsets.
 */
import { describe, expect, it } from "vitest";
import { bodyOffset } from "../src/meta/internal.js";

/** The text after the offset, which is what a docevals page's `body` is. */
const bodyOf = (content: string, file: string): string | undefined => {
  const at = bodyOffset(content, file);
  return at === undefined ? undefined : content.slice(at);
};

describe("bodyOffset", () => {
  it("starts an HTML body after </head>", () => {
    const page = "<html>\n<head><title>T</title></head>\n<body>\n<p>x</p>\n</body></html>\n";
    expect(bodyOf(page, "page.html")).toBe("\n<body>\n<p>x</p>\n</body></html>\n");
  });

  it("starts at <body> when the page has no </head>", () => {
    const page = "<html>\n<body><p>x</p></body></html>";
    expect(bodyOf(page, "page.htm")).toBe("<body><p>x</p></body></html>");
  });

  it("starts at 0 for a fragment with neither", () => {
    expect(bodyOffset("<p>x</p>\n", "snippet.flsnp")).toBe(0);
  });

  it("counts a leading BOM, so the slice is of the file as read", () => {
    const page = "﻿<html><head><title>T</title></head><body>B</body></html>";
    expect(bodyOf(page, "page.html")).toBe("<body>B</body></html>");
  });

  it("reads a Flare XHTML topic past its head", () => {
    const page = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<html xmlns:MadCap="http://www.madcapsoftware.com/Schemas/MadCap.xsd">',
      "    <head>",
      "        <title />",
      "    </head>",
      "    <body>",
      "        <h1>Topic</h1>",
      "    </body>",
      "</html>",
      "",
    ].join("\n");
    expect(bodyOf(page, "Content/topic.htm")).toBe(
      "\n    <body>\n        <h1>Topic</h1>\n    </body>\n</html>\n",
    );
  });

  it("starts an XML body after the root start tag", () => {
    const page = '<?xml version="1.0"?>\n<doc type="a>b">\n<p>x</p>\n</doc>\n';
    expect(bodyOf(page, "page.xml")).toBe("\n<p>x</p>\n</doc>\n");
  });

  it("counts a leading BOM on an XML page", () => {
    const page = '﻿<?xml version="1.0"?>\n<doc>\n<p>x</p>\n</doc>\n';
    expect(bodyOf(page, "page.xml")).toBe("\n<p>x</p>\n</doc>\n");
  });

  it("starts a DITA topic's body after </prolog>", () => {
    const page = [
      '<?xml version="1.0"?>',
      '<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">',
      '<topic id="t">',
      "  <title>T</title>",
      "  <prolog><metadata><keywords><keyword>k</keyword></keywords></metadata></prolog>",
      "  <body><p>x</p></body>",
      "</topic>",
    ].join("\n");
    expect(bodyOf(page, "t.dita")).toBe("\n  <body><p>x</p></body>\n</topic>");
  });

  it("starts a DITA topic with no prolog after its root start tag", () => {
    const page = '<topic id="t">\n<title>T</title>\n<body/>\n</topic>';
    expect(bodyOf(page, "t.dita")).toBe("\n<title>T</title>\n<body/>\n</topic>");
  });

  it("leaves a fenced format to its own rule", () => {
    expect(bodyOffset("---\ntitle: T\n---\nBody\n", "page.md")).toBeUndefined();
    expect(bodyOffset("= T\n:a: b\n\nBody\n", "page.adoc")).toBeUndefined();
    expect(bodyOffset("Body\n", "page.rst")).toBeUndefined();
  });
});
