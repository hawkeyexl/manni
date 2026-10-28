/**
 * A Flare topic read as its target builds it (proposal 0125, decisions 11,
 * 12, 14 and 15): snippets expanded, variables resolved, conditions applied,
 * while links stay what the file says.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { htmlParser } from "../../../src/lint/parsers/html.js";
import { flareRun } from "../../../src/shared/flare/index.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import type { DocumentTree, SectionNode } from "../../../src/lint/types.js";
import { defined } from "../helpers.js";

const FLARE = join(import.meta.dirname, "..", "fixtures", "flare");
const TOPICS = join(FLARE, "widget", "Content", "Topics");
const SNIPPETS = join(FLARE, "widget", "Content", "Resources", "Snippets");

let stderr: string[];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Parse `file` under `target`, or under no named target. */
function read(file: string, target?: string): DocumentTree {
  const flare = flareRun(target === undefined ? undefined : { flare: { target } });
  const label = file.replace(/^.*[\\/]/, "");
  return htmlParser.parse(readFileSync(file, "utf8"), label, { absPath: file, flare });
}

function find(sections: SectionNode[], title: string): SectionNode | undefined {
  for (const s of sections) {
    if (s.title === title) return s;
    const nested = find(s.sections, title);
    if (nested) return nested;
  }
  return undefined;
}

/** Every content node's text in a section, its own and its subsections'. */
function texts(section: SectionNode): string[] {
  return [...section.children.map((c) => c.text), ...section.sections.flatMap(texts)];
}

const all = (tree: DocumentTree): string[] => tree.sections.flatMap(texts);

describe("snippets", () => {
  it("makes a snippet's h2 a section of the topic, at the reference's line", () => {
    const tree = read(join(TOPICS, "Install.htm"), "HTML5");
    const section = defined(find(tree.sections, "Before you start"), "snippet section");
    expect(section.level).toBe(2);
    expect(section.position.start.line).toBe(8);
    expect(texts(section)).toContain("Install Widget first.");
  });

  it("expands a nested snippet, with its text variable resolved", () => {
    const tree = read(join(TOPICS, "Install.htm"), "HTML5");
    const section = defined(find(tree.sections, "Before you start"));
    expect(texts(section)).toContain("Version 4.3 needs Node 20.");
    // Nested content reports at the topic's reference too.
    const note = defined(section.children.find((c) => c.text.startsWith("Version")));
    expect(note.position.start.line).toBe(8);
  });

  it("expands a cycle once and warns once", () => {
    const tree = read(join(TOPICS, "Cycle.htm"), "HTML5");
    expect(all(tree)).toEqual(["Cycle A.", "Cycle B."]);
    const warnings = stderr.filter((l) => l.includes("includes itself"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Cycle.htm: snippet ");
    expect(warnings[0]).toContain("CycleA.flsnp");
  });

  it("filters a snippet by its reference's expression, else the root's", () => {
    const tree = read(join(TOPICS, "Snippets.htm"), "HTML5");
    expect(texts(defined(find(tree.sections, "Own")))).toEqual(["Beta only.", "Version 9.0."]);
    expect(texts(defined(find(tree.sections, "Root")))).toEqual(["Version 4.3."]);
  });

  it("inserts a text snippet's inline content", () => {
    const tree = read(join(TOPICS, "Snippets.htm"), "HTML5");
    expect(texts(defined(find(tree.sections, "Inline")))).toEqual(["Name: Widget."]);
  });

  it("reports a snippet parsed directly at its own lines", () => {
    const tree = read(join(SNIPPETS, "BeforeYouStart.flsnp"), "HTML5");
    const section = defined(find(tree.sections, "Before you start"));
    expect(section.position.start.line).toBe(5);
    const note = defined(section.children.find((c) => c.text.startsWith("Version")));
    expect(note.position.start.line).toBe(7);
  });
});

describe("variables", () => {
  it("resolves the target's override over the set, through nested variables", () => {
    const text = all(read(join(TOPICS, "Install.htm"), "HTML5"));
    expect(text).toContain("Install Widget 4.3 on Linux.");
    expect(text).toContain("Run version 4.3.");
  });

  it("takes the set's default with no target", () => {
    const text = all(read(join(TOPICS, "Install.htm")));
    expect(text).toContain("Run version 4.2.");
  });

  it("keeps date and time, undefined and build-time references, and warns once per undefined name", () => {
    const text = all(read(join(TOPICS, "Install.htm"), "HTML5"));
    expect(text).toContain("Missing [%=General.Missing%] and [%=General.Missing%], built [%=General.Year%].");
    expect(text).toContain("Topic Installing the widget in Install.htm, page [%=System.PageNumber%].");
    const warnings = stderr.filter((l) => l.includes("General.Missing"));
    expect(warnings).toEqual([
      "manni: Install.htm: variable General.Missing is not defined in Widget.flprj. The reference is kept as text.\n",
    ]);
    expect(stderr.join("")).not.toContain("General.Year");
  });
});

describe("conditions", () => {
  it("drops print-only content under HTML5", () => {
    const text = all(read(join(TOPICS, "Install.htm"), "HTML5"));
    expect(text.some((t) => t.includes("print guide"))).toBe(false);
  });

  it("keeps print-only content under Print and with no target", () => {
    expect(all(read(join(TOPICS, "Install.htm"), "Print"))).toContain("See the print guide.");
    expect(all(read(join(TOPICS, "Install.htm")))).toContain("See the print guide.");
  });

  it("keeps the links of excluded content", () => {
    const tree = read(join(TOPICS, "Install.htm"), "HTML5");
    expect(tree.links.map((l) => l.target)).toContain("PrintGuide.htm");
  });

  it("gives a topic its target excludes no sections, and marks it", () => {
    const tree = read(join(TOPICS, "PrintGuide.htm"), "HTML5");
    expect(tree.sections).toEqual([]);
    expect(tree.flare?.excluded).toBe(true);
    expect(tree.links.map((l) => l.target)).toEqual(["Install.htm"]);
    const print = read(join(TOPICS, "PrintGuide.htm"), "Print");
    expect(print.flare?.excluded).toBeUndefined();
    expect(print.sections).not.toEqual([]);
  });
});

describe("the project", () => {
  it("records the project and how its target was chosen", () => {
    expect((read(join(TOPICS, "Install.htm"), "HTML5")).flare).toEqual({
      project: "Widget.flprj",
      target: { name: "HTML5", from: "tools.flare.target" },
    });
    expect((read(join(TOPICS, "Install.htm"))).flare).toEqual({ project: "Widget.flprj" });
    expect((read(join(FLARE, "solo", "Content", "Topic.htm"))).flare).toEqual({
      project: "Solo.flprj",
      target: { name: "Online", from: "the only target" },
    });
  });

  it("with no project, notices once, expands snippets and leaves variables", () => {
    const tree = read(join(FLARE, "orphan", "Topic.htm"));
    expect(tree.flare).toBeUndefined();
    expect(all(tree)).toEqual(["Name .", "Orphan snippet with ."]);
    expect(stderr.filter((l) => l.includes("No Flare project"))).toHaveLength(1);
  });

  it("reads a Flare page with no context as it always did", () => {
    const file = join(TOPICS, "Install.htm");
    const tree = htmlParser.parse(readFileSync(file, "utf8"), "Install.htm");
    expect(tree.flare).toBeUndefined();
    expect(find(tree.sections, "Before you start")).toBeUndefined();
  });
});

describe("a link target naming a variable", () => {
  // The graph fixture's project: Links.Setup is Old.htm, which the one target
  // overrides to Setup.htm; Links.Built is a date; Links.Undefined is no one's.
  const INSTALL = join(
    import.meta.dirname, "..", "..", "graph", "fixtures", "flare-project", "Content", "Topics", "Install.htm",
  );
  const links = (tree: DocumentTree): string[] => tree.links.map((l) => l.target);

  it("resolves through the project's variables, with the target's override", () => {
    expect(links(read(INSTALL))).toEqual([
      "../Resources/Snippets/Note.flsnp",
      "Setup.htm",
      "Gone.htm",
      "/Content/Topics/Setup.htm",
      "/Content/Missing.htm",
    ]);
  });

  it("is skipped when the variable is undefined or a date, and with no context", () => {
    const skipped = [
      "../Resources/Snippets/Note.flsnp",
      "/Content/Topics/Setup.htm",
      "/Content/Missing.htm",
    ];
    const content = readFileSync(INSTALL, "utf8");
    expect(links(htmlParser.parse(content, "Install.htm"))).toEqual(skipped);
    // The same bytes in a folder no project holds.
    const orphan = { absPath: join(FLARE, "orphan", "Install.htm"), flare: flareRun(undefined) };
    expect(links(htmlParser.parse(content, "Install.htm", orphan))).toEqual(skipped);
  });
});
