/**
 * `manni lint templates infer`: a first template, written from a page that
 * already has the shape its author wants.
 *
 * The acceptance test is the round trip. The format is strict by default -
 * every rule is one occurrence, and an undescribed section is a finding - so a
 * template inferred from a page that does not then lint that page clean is
 * worse than no template at all: it hands a new author a screen of findings
 * about the very document they pointed at. Proposal 0061's stress test 5 is the
 * record.
 *
 * So every one of the seven vendored TGDP pages is inferred from, reloaded
 * through the real template loader, and validated against its own source. In
 * both output formats, because `--format json` is the same template written
 * differently and must behave identically.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { buildProgram } from "../../../src/lint/cli.js";
import { markdownParser } from "../../../src/lint/parsers/markdown.js";
import { validateDocument } from "../../../src/lint/core/validator.js";
import { loadTemplateFile } from "../../../src/lint/core/template-registry.js";
import {
  inferTemplate,
  inferTemplateFile,
  renderTemplateFile,
  type InferFormat,
} from "../../../src/lint/core/infer.js";
import { runTemplatesInfer } from "../../../src/lint/commands/templates.js";
import { LintError } from "../../../src/lint/types.js";
import type { DocumentTree } from "../../../src/lint/types.js";
import { defined } from "../helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
const vendored = join(here, "..", "fixtures", "tgdp");

/** The seven vendored TGDP pages: one per doctype, and the corpus 0061 cites. */
const TGDP_PAGES = [
  "template_concept.md",
  "template_how-to.md",
  "template_readme.md",
  "template_reference.md",
  "template_release-notes.md",
  "template_troubleshooting.md",
  "template_tutorial.md",
];

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "manni-infer-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function parse(content: string, filePath = "page.md"): DocumentTree {
  return markdownParser.parse(content, filePath);
}

/**
 * Infer, serialize, load through the real loader, and lint the page it came
 * from. Returns the findings, which must be none.
 */
async function roundTrip(
  tree: DocumentTree,
  format: InferFormat,
  label: string,
): Promise<string[]> {
  const text = renderTemplateFile(inferTemplateFile(tree, "page"), format);
  const path = join(tmp, `${label}.${format}`);
  await writeFile(path, text, "utf8");

  const loaded = await loadTemplateFile(path);
  const template = defined(loaded.templates?.["page"], `template in ${path}`);
  return validateDocument(tree, template, { kinds: markdownParser.kinds }).map(
    (f) => `${f.position.start.line}: [${f.type}] ${f.message}`,
  );
}

describe("inferTemplate", () => {
  it("makes the page's own title the template's heading", () => {
    const tree = parse("# Title\n\nProse.\n\n## Overview\n\nMore prose.\n");
    const template = inferTemplate(tree);
    expect(template.heading).toBe("Title");
    expect(template.contains).toEqual({ paragraphs: { min: 1 } });
    expect(template.sections).toEqual([
      { heading: "Overview", contains: { paragraphs: { min: 1 } } },
    ]);
  });

  it("gives a page with no heading of its own `heading: false`", () => {
    const tree = parse("## One\n\nProse.\n\n## Two\n\nProse.\n");
    const template = inferTemplate(tree);
    expect(template.heading).toBe(false);
    expect(template.sections).toHaveLength(2);
  });

  it("keeps a title synthesized from frontmatter as a heading", () => {
    const tree = parse("---\ntitle: From metadata\n---\n\n## One\n\nProse.\n");
    expect(inferTemplate(tree).heading).toBe("From metadata");
  });

  it("nests a rule per heading, by depth", () => {
    const tree = parse("# T\n\n## A\n\n### A1\n\nProse.\n\n## B\n");
    const sections = defined(inferTemplate(tree).sections);
    expect(sections.map((r) => r.heading)).toEqual(["A", "B"]);
    expect(defined(sections[0]?.sections).map((r) => r.heading)).toEqual(["A1"]);
    // A leaf carries no `sections:` key at all. An empty list would mean "no
    // subsections are permitted", which is a different claim.
    expect(sections[1]).not.toHaveProperty("sections");
  });

  it("lists every content kind present, each at min 1", () => {
    const tree = parse(
      "# T\n\nProse.\n\n- one\n- two\n\n> quoted\n\n![alt](a.png)\n",
    );
    expect(inferTemplate(tree).contains).toEqual({
      paragraphs: { min: 1 },
      lists: { min: 1 },
      images: { min: 1 },
      blockquotes: { min: 1 },
    });
  });

  it("takes a table's columns from its header row", () => {
    const tree = parse("# T\n\n| Name | Type |\n| --- | --- |\n| a | b |\n");
    expect(inferTemplate(tree).contains?.tables).toEqual({
      min: 1,
      columns: ["Name", "Type"],
    });
  });

  it("does not claim columns when two tables disagree about them", () => {
    const tree = parse(
      "# T\n\n| Name |\n| --- |\n| a |\n\n| Other |\n| --- |\n| b |\n",
    );
    expect(inferTemplate(tree).contains?.tables).toEqual({ min: 1 });
  });

  it("takes a fenced code block's language where it declares one", () => {
    const tree = parse("# T\n\n```bash\nls\n```\n");
    expect(inferTemplate(tree).contains?.codeBlocks).toEqual({
      min: 1,
      language: "bash",
    });
  });

  it("claims no language when a block in the same section declares none", () => {
    const tree = parse("# T\n\n```bash\nls\n```\n\n```\nraw\n```\n");
    expect(inferTemplate(tree).contains?.codeBlocks).toEqual({ min: 1 });
  });

  it("guesses nothing about what varies", () => {
    const yaml = renderTemplateFile(
      inferTemplateFile(parse("# T\n\n## A\n\n## A\n"), "page"),
      "yaml",
    );
    // One page cannot show what repeats or what is optional, so neither is
    // invented: two `A` sections are two rules, not one with `min: 2`.
    expect(yaml).not.toContain("min: 0");
    expect(yaml).not.toContain("repeat");
    expect(yaml).not.toContain("pattern");
  });
});

describe("the round trip", () => {
  describe.each(TGDP_PAGES)("%s", (page) => {
    it.each<InferFormat>(["yaml", "json"])(
      "lints its own source clean as %s",
      async (format) => {
        const source = join(vendored, page);
        const tree = parse(await readFile(source, "utf8"), source);
        expect(await roundTrip(tree, format, basename(page, ".md"))).toEqual([]);
      },
    );
  });

  it("emits the same template in both formats", async () => {
    const source = join(vendored, "template_how-to.md");
    const tree = parse(await readFile(source, "utf8"), source);
    const file = inferTemplateFile(tree, "page");
    expect(parseYaml(renderTemplateFile(file, "yaml"))).toEqual(
      JSON.parse(renderTemplateFile(file, "json")),
    );
  });
});

describe("runTemplatesInfer", () => {
  it("writes the page's `type` as the template name", async () => {
    const page = join(tmp, "typed.md");
    await writeFile(page, "---\ntype: how-to\n---\n\n# T\n\nProse.\n", "utf8");
    const result = await runTemplatesInfer({ page, noConfig: true });
    expect(result.name).toBe("how-to");
    expect(result.text).toContain("how-to:");
  });

  it("falls back to the file's stem", async () => {
    const page = join(tmp, "release-notes.md");
    await writeFile(page, "# T\n\nProse.\n", "utf8");
    const result = await runTemplatesInfer({ page, noConfig: true });
    expect(result.name).toBe("release-notes");
  });

  it("takes --name over both", async () => {
    const page = join(tmp, "typed.md");
    const result = await runTemplatesInfer({ page, name: "house", noConfig: true });
    expect(result.name).toBe("house");
  });

  it("reads stdin with --as", async () => {
    const result = await runTemplatesInfer({
      page: "-",
      as: "markdown",
      stdinContent: "# T\n\nProse.\n",
      noConfig: true,
    });
    expect(result.text).toContain("heading: T");
  });

  it("refuses stdin without --as", async () => {
    await expect(
      runTemplatesInfer({ page: "-", stdinContent: "# T\n", noConfig: true }),
    ).rejects.toThrow(
      "Reading from stdin (-) requires --as <format> to choose a parser.",
    );
  });

  it("refuses an unknown --format", async () => {
    const page = join(tmp, "typed.md");
    await expect(
      runTemplatesInfer({
        page,
        format: "xml" as InferFormat,
        noConfig: true,
      }),
    ).rejects.toThrow('Unknown --format "xml". Use yaml or json.');
  });

  it("refuses to overwrite --out without --force", async () => {
    const page = join(tmp, "typed.md");
    const out = join(tmp, "exists.yaml");
    await writeFile(out, "templates: {}\n", "utf8");
    await expect(
      runTemplatesInfer({ page, out, noConfig: true }),
    ).rejects.toThrow(`${out} exists. Pass --force to overwrite it.`);
  });

  it("overwrites --out with --force", async () => {
    const page = join(tmp, "typed.md");
    const out = join(tmp, "exists.yaml");
    const result = await runTemplatesInfer({
      page,
      out,
      force: true,
      noConfig: true,
    });
    expect(result.written).toBe(out);
    expect(await readFile(out, "utf8")).toBe(result.text);
  });

  it("writes a new --out path", async () => {
    const page = join(tmp, "typed.md");
    const out = join(tmp, "nested", "new.yaml");
    await runTemplatesInfer({ page, out, noConfig: true });
    const loaded = await loadTemplateFile(out);
    expect(Object.keys(loaded.templates ?? {})).toEqual(["how-to"]);
  });

  it("refuses a name the template schema cannot hold", async () => {
    const page = join(tmp, "typed.md");
    await expect(
      runTemplatesInfer({ page, name: "2024 notes", noConfig: true }),
    ).rejects.toBeInstanceOf(LintError);
  });

  it("refuses a page no parser claims", async () => {
    const page = join(tmp, "page.xyz");
    await writeFile(page, "nothing\n", "utf8");
    await expect(runTemplatesInfer({ page, noConfig: true })).rejects.toThrow(
      /no parser is registered/i,
    );
  });

  it("refuses an unknown --as", async () => {
    const page = join(tmp, "typed.md");
    await expect(
      runTemplatesInfer({ page, as: "wordperfect", noConfig: true }),
    ).rejects.toThrow(/Unknown format "wordperfect"/);
  });
});

/**
 * The command surface, against the real commander program.
 *
 * "Commands must have parallel behaviors" is a rule about spellings, and a
 * spelling is only real once commander has it: `--as <format>` declared one way
 * here and another way on `structure` is a defect no type checker sees.
 */
describe("the command surface", () => {
  /** `manni lint templates infer`'s own command object. */
  function inferCommand(): Command {
    const lint = buildProgram();
    const templates = defined(
      lint.commands.find((c) => c.name() === "templates"),
      "the templates command",
    );
    return defined(
      templates.commands.find((c) => c.name() === "infer"),
      "the infer command",
    );
  }

  it("lives under `templates`, which still lists", async () => {
    expect(inferCommand().usage()).toContain("<page>");

    // Gaining a subcommand must not turn the noun into a dispatcher: `manni
    // lint templates` is a verb of its own and still prints the listing.
    const written: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(String(chunk));
        return true;
      });
    try {
      await buildProgram().parseAsync([
        "node",
        "lint",
        "templates",
        "--no-config",
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(written.join("")).toContain("tgdp:how-to:1.6");
  });

  it("takes exactly one page", async () => {
    const help = inferCommand().helpInformation();
    // Not `[pages...]`: a template is inferred from one exemplar, and a second
    // page would mean deciding which of their differences is variation.
    expect(help).toContain("<page>");
    expect(help).not.toContain("<page...>");

    // Commander's own refusals, which only exist once the program is built.
    const parse = (...pages: string[]): Promise<unknown> =>
      buildProgram().parseAsync(["node", "lint", "templates", "infer", ...pages]);
    await expect(parse()).rejects.toThrow("missing required argument 'page'");
    await expect(parse("a.md", "b.md")).rejects.toThrow("too many arguments");
  });

  it("spells its shared options the way every other lint verb does", () => {
    const help = inferCommand().helpInformation();
    const structure = defined(
      buildProgram().commands.find((c) => c.name() === "structure"),
      "the structure command",
    ).helpInformation();
    for (const flag of [
      "--as <format>",
      "-c, --config <path>",
      "--no-config",
      "-f, --format <format>",
    ]) {
      expect(help, `infer declares ${flag}`).toContain(flag);
      expect(structure, `structure declares ${flag}`).toContain(flag);
    }
    expect(help).toContain("--name <name>");
    expect(help).toContain("-o, --out <path>");
    expect(help).toContain("--force");
    expect(help).toContain("yaml | json");
  });

  it("writes the template through the real program", async () => {
    const page = join(tmp, "cli-page.md");
    await writeFile(page, "---\ntype: how-to\n---\n\n# T\n\nProse.\n", "utf8");
    const out = join(tmp, "from-cli.yaml");
    await buildProgram().parseAsync([
      "node",
      "lint",
      "templates",
      "infer",
      page,
      "-o",
      out,
      "--no-config",
    ]);
    const loaded = await loadTemplateFile(out);
    expect(Object.keys(loaded.templates ?? {})).toEqual(["how-to"]);
  });

  /**
   * Commander lets `templates` swallow a `-f` or `-c` typed after `infer`,
   * because both commands declare them and positional options are off. The
   * flags must still mean what the line says, so each is exercised through the
   * real program rather than through the core alone.
   */
  it("honours -f and --no-config typed after the subcommand", async () => {
    const page = join(tmp, "cli-page.md");
    const out = join(tmp, "from-cli.json");
    await buildProgram().parseAsync([
      "node",
      "lint",
      "templates",
      "infer",
      page,
      "-f",
      "json",
      "-o",
      out,
      "--no-config",
    ]);
    const text = await readFile(out, "utf8");
    expect(JSON.parse(text)).toHaveProperty("templates.how-to");
  });
});
