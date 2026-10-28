/**
 * A Flare topic's glossary term reference is a `concepts:` reference (proposal
 * 0125, decision 19), so `term check` holds it to the termbase like any page's.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/term/commands/check.js";

const FLARE_NS = "http://www.madcapsoftware.com/Schemas/MadCap.xsd";

let tmp: string | undefined;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function tree(spec: Record<string, string>): Promise<string> {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-term-flare-")));
  for (const [rel, content] of Object.entries(spec)) {
    const p = join(tmp, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }
  return tmp;
}

describe("term check over a Flare topic's glossaryTerm markers", () => {
  it("resolves a glossTerm id the termbase holds, and reports one it lacks at the marker's line", async () => {
    const cwd = await tree({
      "manni.config.yaml": [
        "collections:",
        "  - name: site",
        "    paths:",
        '      - "Content/**/*.htm"',
        '      - "terms/**/*.md"',
        "",
      ].join("\n"),
      "terms/term15.md": ["---", "type: term", "id: Glossary.Term15", "label: batch target", "definition: A target built from the command line.", "---", ""].join("\n"),
      "Content/Build.htm": [
        '<?xml version="1.0" encoding="utf-8"?>',
        `<html xmlns:MadCap="${FLARE_NS}">`,
        "<head><title>Build</title></head>",
        "<body>",
        '<p>Build the <MadCap:glossaryTerm glossTerm="Glossary.Term15">batch target</MadCap:glossaryTerm>,',
        'then the <MadCap:glossaryTerm glossTerm="Glossary.Term99">output</MadCap:glossaryTerm>.</p>',
        "</body>",
        "</html>",
        "",
      ].join("\n"),
    });
    const report = await runCheck({ cwd, inputs: [] });
    expect(report.findings.map((f) => [f.rule, f.file, f.line, f.message])).toEqual([
      [
        "undefined-term",
        "Content/Build.htm",
        5,
        'concepts: "Glossary.Term99" names no entry. Correct the value, or run manni term fill to add the term.',
      ],
    ]);
  });
});
