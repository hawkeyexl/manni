import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  appendArtifactEvals,
  type NewEvalEntry,
} from "../../../src/tracevals/evals/write.js";
import { extractEvals } from "../../../src/tracevals/evals/extract.js";
import { TracevalsError } from "../../../src/tracevals/types.js";
import { makeArtifact } from "../helpers.js";

const ONE: NewEvalEntry[] = [
  {
    id: "reads-before-editing",
    assertion: "The session read a source file before editing it.",
    grader: "tool-usage",
    options: { tool: "Read", expect: "used" },
    examples: { pass: ["Read then Edit"], fail: ["Edit with no prior Read"] },
  },
];

/** The frontmatter block of a rendered artifact, parsed back into an object. */
function frontmatterOf(content: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)^(?:---|\.\.\.)\r?\n/m.exec(content);
  expect(match, "expected a YAML frontmatter block").not.toBeNull();
  return parseYaml(match![1]!) as Record<string, unknown>;
}

describe("appendArtifactEvals", () => {
  it("synthesizes a block for an artifact with no frontmatter", async () => {
    // The common case: 3 of 5 fixture artifacts carry no frontmatter at all.
    const body = "# Demo Project Rules\n\n- Run tests before declaring done.\n";
    const result = appendArtifactEvals(body, "CLAUDE.md", ONE);

    expect(result.startsWith("---\n")).toBe(true);
    expect(result.endsWith(body)).toBe(true);

    const data = frontmatterOf(result);
    // The list is the value of `evals`: the 0.2 `criteria` container is gone.
    expect(data).toEqual({
      metadata: {
        evals: [
          {
            id: "reads-before-editing",
            assertion: "The session read a source file before editing it.",
            grader: "tool-usage",
            options: { tool: "Read", expect: "used" },
            examples: {
              pass: ["Read then Edit"],
              fail: ["Edit with no prior Read"],
            },
          },
        ],
      },
    });
  });

  it("adds metadata.evals to frontmatter that has none, preserving key order", () => {
    const source = [
      "---",
      "name: doc-writer",
      "description: Writes documentation.",
      "---",
      "",
      "You write docs.",
      "",
    ].join("\n");
    const result = appendArtifactEvals(source, "doc-writer.md", ONE);

    expect(result.endsWith("\n\nYou write docs.\n")).toBe(true);
    const keys = Object.keys(frontmatterOf(result));
    expect(keys).toEqual(["name", "description", "metadata"]);
  });

  it("appends to existing evals without disturbing them or their comments", () => {
    const source = [
      "---",
      "name: fix-bug",
      "metadata:",
      "  evals:",
      "    # keep this comment",
      "    - id: used-read",
      "      assertion: The session read a file.",
      "      grader: tool-usage",
      "      options:",
      "        tool: Read",
      "---",
      "body text",
      "",
    ].join("\n");
    const result = appendArtifactEvals(source, "SKILL.md", [
      { id: "no-shell", assertion: "No shell commands were run." },
    ]);

    expect(result).toContain("# keep this comment");
    expect(result).toContain("used-read");
    expect(result).toContain("no-shell");
    expect(result.endsWith("body text\n")).toBe(true);

    const evals = (frontmatterOf(result).metadata as { evals: unknown[] })
      .evals;
    expect(evals).toHaveLength(2);
  });

  it("preserves a BOM and CRLF line endings", () => {
    // Built as a literal: this repo has no .gitattributes, so a fixture's
    // line endings would depend on the runner's core.autocrlf.
    const source = "﻿---\r\nname: fix-bug\r\n---\r\nbody\r\n";
    const result = appendArtifactEvals(source, "SKILL.md", ONE);

    expect(result.charCodeAt(0)).toBe(0xfeff);
    expect(result.endsWith("---\r\nbody\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(result)).toBe(false);
  });

  it("preserves a `...` closing fence and content after it", () => {
    const source = "---\nname: x\n...\ntail\n";
    const result = appendArtifactEvals(source, "x.md", ONE);
    expect(result.endsWith("...\ntail\n")).toBe(true);
  });

  it("refuses to write a criterion whose name already exists", () => {
    const source = [
      "---",
      "metadata:",
      "  evals:",
      "    criteria:",
      "      - name: reads-before-editing",
      "        assertion: Already here.",
      "---",
      "body",
      "",
    ].join("\n");
    expect(() => appendArtifactEvals(source, "SKILL.md", ONE)).toThrow(
      TracevalsError,
    );
  });

  it("refuses non-YAML frontmatter rather than adding a second block", () => {
    const toml = '+++\nname = "x"\n+++\nbody\n';
    expect(() => appendArtifactEvals(toml, "x.md", ONE)).toThrow(
      TracevalsError,
    );
  });

  it("rejects a string-shorthand collision too", () => {
    const source = [
      "---",
      "metadata:",
      "  evals:",
      "    - A plain shorthand assertion.",
      "---",
      "body",
      "",
    ].join("\n");
    // Shorthand entries are id-less, so appending an id'd eval is fine.
    const result = appendArtifactEvals(source, "SKILL.md", ONE);
    const evals = (frontmatterOf(result).metadata as { evals: unknown[] })
      .evals;
    expect(evals).toHaveLength(2);
  });

  it("produces output the real reader accepts", async () => {
    // The assertion that matters: round-trip through extractEvals, which
    // validates against the published schema.
    const result = appendArtifactEvals("# Rules\n", "CLAUDE.md", ONE);
    const extracted = await extractEvals(makeArtifact({ content: result }));

    expect(extracted.errors).toEqual([]);
    expect(extracted.declared).toBe(true);
    expect(extracted.evals.map((e) => e.id)).toEqual(["reads-before-editing"]);
    expect(extracted.evals[0]?.grader).toBe("tool-usage");
  });

  it("fills in a metadata key that is present but empty", () => {
    // `metadata:` with no value parses to null, not undefined. Discovery
    // reports such a file as healthy, so the writer must not refuse it.
    for (const head of ["metadata:", "metadata:\n  evals:"]) {
      const source = `---\nname: x\n${head}\n---\nbody\n`;
      const result = appendArtifactEvals(source, "SKILL.md", ONE);
      const evals = (frontmatterOf(result).metadata as { evals: unknown[] })
        .evals;
      expect(evals).toHaveLength(1);
      expect(result.endsWith("body\n")).toBe(true);
    }
  });

  it("does not reflow long values it was not asked to touch", () => {
    const description =
      "Use this skill when the user asks about provisioning infrastructure, databases, caching layers, or any third-party service credentials for their project.";
    const source = `---\nname: x\ndescription: ${description}\n---\nbody\n`;
    const result = appendArtifactEvals(source, "SKILL.md", ONE);

    expect(result).toContain(`description: ${description}`);
  });

  it("reports a non-mapping frontmatter block as an operational error", () => {
    // A leading `---` that is really a thematic break, so the "block" is a
    // sequence. The yaml library throws its own error type here.
    const source = "---\n- one\n- two\n---\nbody\n";
    expect(() => appendArtifactEvals(source, "x.md", ONE)).toThrow(
      TracevalsError,
    );
  });

  it("is idempotent in shape: appending nothing returns the source unchanged", () => {
    const source = "---\nname: x\n---\nbody\n";
    expect(appendArtifactEvals(source, "x.md", [])).toBe(source);
  });

  it("records provenance", () => {
    const result = appendArtifactEvals("# Rules\n", "CLAUDE.md", ONE, {
      generatedBy: "mock:mock-model",
      confidence: { "reads-before-editing": 0.9 },
    });
    const provenance = (frontmatterOf(result).metadata as {
      "eval-provenance": Array<Record<string, unknown>>;
    })["eval-provenance"];
    expect(provenance).toEqual([
      {
        "generated-by": "mock:mock-model",
        evals: ["reads-before-editing"],
        confidence: { "reads-before-editing": 0.9 },
      },
    ]);
  });

  it("fills in evals and confidence on a provenance entry that omits them", () => {
    // Both keys are optional on the vocabulary's provenance entry, so a
    // hand-written `- generated-by: x` is legal. Skipping the write there would
    // leave an entry claiming nothing — worse than no entry at all.
    const source = [
      "---",
      "name: a",
      "metadata:",
      "  eval-provenance:",
      "    - generated-by: mock:mock-model",
      "---",
      "body",
      "",
    ].join("\n");
    const result = appendArtifactEvals(source, "a.md", ONE, {
      generatedBy: "mock:mock-model",
      confidence: { "reads-before-editing": 0.9 },
    });
    const provenance = (frontmatterOf(result).metadata as {
      "eval-provenance": Array<Record<string, unknown>>;
    })["eval-provenance"];
    expect(provenance).toHaveLength(1);
    expect(provenance[0]).toEqual({
      "generated-by": "mock:mock-model",
      evals: ["reads-before-editing"],
      confidence: { "reads-before-editing": 0.9 },
    });
  });

  it("refuses a provenance entry whose evals is not a list", () => {
    const source = [
      "---",
      "metadata:",
      "  eval-provenance:",
      "    - generated-by: mock:mock-model",
      "      evals: not-a-list",
      "---",
      "body",
      "",
    ].join("\n");
    expect(() =>
      appendArtifactEvals(source, "a.md", ONE, {
        generatedBy: "mock:mock-model",
        confidence: { "reads-before-editing": 0.9 },
      }),
    ).toThrow(TracevalsError);
  });

  it("omits the assertion key entirely for a deterministic eval that has none", () => {
    // proposal.2 made `assertion` optional, and a deterministic grader says
    // everything in `options`. Serializing the absent field anyway writes
    // `assertion: null`, which the schema rejects on `type: string` — so the
    // page we just wrote would fail to validate on the next read.
    const body = "# Rules\n";
    const result = appendArtifactEvals(body, "CLAUDE.md", [
      {
        id: "read-before-write",
        grader: "tool-usage",
        options: { tool: "Read", expect: "used" },
      },
    ]);

    expect(result).not.toContain("assertion");
    const entry = (
      (frontmatterOf(result).metadata as Record<string, unknown>)
        .evals as Record<string, unknown>[]
    )[0]!;
    expect("assertion" in entry).toBe(false);
    // And it survives the round trip the schema ladder validates.
    expect(entry).toEqual({
      id: "read-before-write",
      grader: "tool-usage",
      options: { tool: "Read", expect: "used" },
    });
  });
});
