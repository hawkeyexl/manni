/**
 * `manni lint templates show`: the core resolves a ref exactly as
 * `--template` does, and the renderers print what the template asks for.
 */
import { describe, expect, it } from "vitest";
import { runTemplateShow } from "../../../src/lint/commands/templates.js";
import {
  occurrenceWords,
  renderTemplateShow,
} from "../../../src/lint/reporters/template-show.js";
import { LintError } from "../../../src/lint/types.js";

const SHOW = "test/lint/fixtures/templates/show.yaml";
const EXTENDS = "test/lint/fixtures/templates/extends.yaml";
const MULTI = "test/lint/fixtures/templates/multi.yaml";

describe("runTemplateShow", () => {
  it("resolves a built-in with its manifest title", async () => {
    const show = await runTemplateShow({ ref: "tgdp:reference:1.6" });
    expect(show.id).toBe("tgdp:reference:1.6");
    expect(show.source).toBe("builtin");
    expect(show.title).toBe("Reference (The Good Docs Project)");
    expect(show.sections?.map((s) => s.id)).toContain("structured-entry");
  });

  it("names a file template by its fragment, and its file as the source", async () => {
    const show = await runTemplateShow({ ref: `${SHOW}#sample` });
    expect(show.id).toBe("sample");
    expect(show.source).toBe(SHOW);
  });

  it("names a single-template file by its only template", async () => {
    const show = await runTemplateShow({
      ref: "test/lint/fixtures/templates/single.yaml",
    });
    expect(show.source).toBe("test/lint/fixtures/templates/single.yaml");
    expect(show.id).not.toBe("");
  });

  it("resolves extends, and leaves no extends key", async () => {
    const show = await runTemplateShow({ ref: `${EXTENDS}#child` });
    expect(show).not.toHaveProperty("extends");
    expect(show.types).toEqual(["how-to"]);
    expect(show.sections?.map((s) => s.id)).toEqual(["overview", "see-also", "task"]);
  });

  it("refuses what --template refuses, with the same messages", async () => {
    await expect(runTemplateShow({ ref: "tgdp:nope:1.6" })).rejects.toThrow(
      /^Unknown built-in template "tgdp:nope:1\.6"\. Available: /,
    );
    await expect(runTemplateShow({ ref: "./nope.yaml" })).rejects.toThrow(
      'Template file not found: "./nope.yaml".',
    );
    await expect(runTemplateShow({ ref: MULTI })).rejects.toThrow(
      /defines 2 templates; name one with a "#" fragment/,
    );
    await expect(runTemplateShow({ ref: "./nope.yaml" })).rejects.toBeInstanceOf(
      LintError,
    );
  });
});

describe("occurrenceWords", () => {
  it.each([
    [{}, "required, repeats"],
    [{ max: 1 }, "required"],
    [{ min: 1, max: 1 }, "required"],
    [{ min: 0, max: 1 }, "optional"],
    [{ min: 1 }, "required, repeats"],
    [{ min: 0 }, "optional, repeats"],
    [{ min: 3 }, "at least 3"],
    [{ min: 1, max: 3 }, "1 to 3"],
    [{ max: 0 }, "forbidden"],
  ])("%j -> %s", (rule, words) => {
    expect(occurrenceWords(rule)).toBe(words);
  });
});

describe("renderTemplateShow pretty", () => {
  it("prints every heading form and occurrence", async () => {
    const show = await runTemplateShow({ ref: `${SHOW}#sample` });
    expect(renderTemplateShow(show, "pretty")).toBe(
      [
        "sample  —  Sample page",
        "  types: sample, example",
        "  Show every form the renderer prints.",
        "  Contains at least 1 paragraph.",
        "  Guide: https://example.com/guide",
        "",
        "  ## (no heading)  intro · required",
        "     Open with one sentence.",
        "  ## Overview  overview · required",
        "     Contains at least 2 code blocks, in sh or bash.",
        '     Contains at least 1 table, with columns "Field", "Type".',
        "  ## Setup | Installation  setup · optional",
        "     In order: paragraph, numbered list.",
        "  ## /^Step \\d+$/  step · at least 2",
        "    ### (any heading)  detail · optional, repeats",
        "       Explain the step.",
        "  ## Examples  examples · 1 to 3",
        "  ## (group pair)  optional, repeats",
        "    ## /\\?$/  question · required, repeats",
        "    ## Answer  answer · required, repeats",
        "  ## Legacy  legacy · forbidden",
        "  ## (any heading)  optional, repeats",
        "     Anything else.",
      ].join("\n"),
    );
  });

  it("prints the built-in reference template's rules and descriptions", async () => {
    const out = renderTemplateShow(
      await runTemplateShow({ ref: "tgdp:reference:1.6" }),
      "pretty",
    );
    expect(out.split("\n")[0]).toBe(
      "tgdp:reference:1.6  —  Reference (The Good Docs Project)",
    );
    expect(out).toContain("  ## (any heading)  structured-entry · optional, repeats\n");
    expect(out).toContain("     Contains at least 1 table.\n");
    expect(out).toContain(
      "     Present the reference information in a table the reader can scan.",
    );
    expect(out).toContain(
      "  Guide: https://gitlab.com/tgdp/templates/-/blob/v1.6.0/reference/guide_reference.md",
    );
  });

  it("colours only when asked", async () => {
    const show = await runTemplateShow({ ref: "tgdp:reference:1.6" });
    const esc = String.fromCharCode(27);
    expect(renderTemplateShow(show, "pretty")).not.toContain(esc);
    expect(renderTemplateShow(show, "pretty", { color: true })).toContain(esc);
  });
});

describe("renderTemplateShow json", () => {
  it("prints the resolved template with id and source", async () => {
    const show = await runTemplateShow({ ref: `${EXTENDS}#child` });
    const parsed = JSON.parse(renderTemplateShow(show, "json")) as Record<string, unknown>;
    expect(parsed["id"]).toBe("child");
    expect(parsed["source"]).toBe(EXTENDS);
    expect(Array.isArray(parsed["sections"])).toBe(true);
    expect(parsed).not.toHaveProperty("extends");
    expect(parsed).not.toHaveProperty("guide");
  });
});

describe("renderTemplateShow markdown", () => {
  it("writes a page skeleton for tgdp:how-to:1.6", async () => {
    const out = renderTemplateShow(
      await runTemplateShow({ ref: "tgdp:how-to:1.6" }),
      "markdown",
    );
    expect(out.startsWith("---\ntype: how-to\n---\n\n# {Title}\n")).toBe(true);
    expect(out).toContain(
      "<!-- tgdp:how-to:1.6. Walk a reader who already knows the product",
    );
    expect(out).toContain("\n## Overview\n\n<!-- Required. Contains at least 1 paragraph. Say what task");
    expect(out).toContain("\n## {task}\n\n<!-- Required, repeats. Name the task");
    expect(out).toContain("\n### {sub-task}\n\n<!-- Optional, repeats.");
    expect(out).toContain("\n## See also\n");
  });

  it("leaves out the catch-all and forbidden rules, and writes groups once", async () => {
    const out = renderTemplateShow(
      await runTemplateShow({ ref: `${SHOW}#sample` }),
      "markdown",
    );
    expect(out).toBe(
      [
        "---",
        "type: sample",
        "---",
        "",
        "# {Title}",
        "",
        "<!-- sample. Contains at least 1 paragraph. Show every form the renderer prints. Guide: https://example.com/guide -->",
        "",
        "<!-- Required. Open with one sentence. -->",
        "",
        "## Overview",
        "",
        '<!-- Required. Contains at least 2 code blocks, in sh or bash. Contains at least 1 table, with columns "Field", "Type". -->',
        "",
        "## Setup",
        "",
        "<!-- Optional. In order: paragraph, numbered list. -->",
        "",
        "## {step}",
        "",
        "<!-- At least 2. -->",
        "",
        "### {detail}",
        "",
        "<!-- Optional, repeats. Explain the step. -->",
        "",
        "## Examples",
        "",
        "<!-- 1 to 3. -->",
        "",
        "## {question}",
        "",
        "<!-- Required, repeats. -->",
        "",
        "## Answer",
        "",
        "<!-- Required, repeats. -->",
      ].join("\n"),
    );
  });

  it("never puts -- inside a comment", () => {
    const out = renderTemplateShow(
      {
        id: "x",
        source: "builtin",
        sections: [{ id: "a", heading: "A", description: "Use --force -- or not---" }],
      },
      "markdown",
    );
    const comments = out.match(/<!--([\s\S]*?)-->/g) ?? [];
    for (const comment of comments) {
      expect(comment.slice(4, -3)).not.toContain("--");
    }
  });
});
